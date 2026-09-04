import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { enrichRoadsWithDetours } from '@/lib/roads';

/**
 * GET /api/analytics → model + response analytics, computed live from real
 * state on every call (no cached/hardcoded metric chips):
 * - priority queue (hazard × exposure × vulnerability, ranked)
 * - district hazard summary
 * - alert timeline (6 h buckets over 72 h)
 * - engine live telemetry (last recompute, levels now, comms volume)
 * - model registry: live-computed capability cards + recent engine passes
 */
export async function GET() {
  try {
    await requireSession();
    const [zones, alerts, runs, snapshots, reports, sms, checkins, roads] = await Promise.all([
      db.zone.findMany({ include: { riskCell: true } }),
      db.alert.findMany({ orderBy: { createdAt: 'desc' }, take: 800 }),
      db.modelRun.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
      db.riskSnapshot.findMany({ orderBy: { ts: 'desc' }, take: 1500 }),
      db.citizenReport.findMany({ select: { id: true, status: true, aiPreScreen: true, aiSource: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 400 }),
      db.smsMessage.findMany({ select: { id: true, queuedAt: true }, orderBy: { queuedAt: 'desc' }, take: 800 }),
      db.safeCheckin.findMany({ select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 400 }),
      enrichRoadsWithDetours(),
    ]);

    const dayAgo = Date.now() - 24 * 3600_000;

    // latest rain per zone for the queue (7-day window — engine reads newest only)
    const obs = await db.rainfallObs.findMany({
      where: { ts: { gte: new Date(Date.now() - 7 * 86400_000) } },
      orderBy: { ts: 'desc' },
      select: { zoneId: true, rain24h: true },
    });
    const rainByZone = new Map<string, number>();
    for (const o of obs) {
      if (!rainByZone.has(o.zoneId)) rainByZone.set(o.zoneId, o.rain24h);
    }

    // priority queue — same formula as reference Model D
    const queue = zones
      .map((z) => {
        const level = z.riskCell?.hazardLevel ?? 0;
        const rain24 = rainByZone.get(z.id) ?? 0;
        const isoHash = (str: string) => {
          let h = 0;
          for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
          return h % 8;
        };
        const pop = Math.max(z.population ?? 800, 200);
        const rk = Math.max(z.roadKm ?? 3, 0.5);
        const access = Math.min(rk / 20, 1);
        const remoteness = Math.min(3000 / pop, 1);
        const iso = Math.round(Math.min(96, remoteness * 55 + (1 - access) * 45 + isoHash(z.zoneCode)));
        const exposure = (z.population / 15000) * 0.6 + Math.min(z.roadKm / 40, 1) * 0.4;
        const vulnerability = 0.5 + iso / 200;
        const score = Math.round((level * 22 + z.suscMean * 0.18) * exposure * vulnerability * 10) / 10;

        const reasons: string[] = [];
        if (level >= 3) reasons.push('L3+ landslide warning');
        if (rain24 >= 150) reasons.push(`extreme rainfall ${Math.round(rain24)}mm/24h`);
        else if (rain24 >= 90) reasons.push(`heavy rainfall ${Math.round(rain24)}mm/24h`);
        if (z.suscMean >= 75) reasons.push('very high susceptibility');
        if (iso >= 65) reasons.push('isolated community risk');
        if (z.population >= 9000) reasons.push(`${z.population.toLocaleString('en-IN')} people exposed`);
        const infra = JSON.parse(z.criticalInfra || '{}');
        if (infra.schools) reasons.push('school in zone');

        const action =
          level >= 4 ? (iso >= 60 ? 'Evacuate now; deploy SDRF to choke points' : 'Evacuate via marked routes')
          : level === 3 ? (iso >= 60 ? 'Pre-position JCB + rescue boat' : 'Pre-position JCB; brief DC control room')
          : level === 2 ? 'Alert ward volunteers; inspect crack zones'
          : level === 1 ? 'Field teams on standby'
          : 'Routine monitoring';

        return {
          zoneCode: z.zoneCode,
          name: z.name,
          district: z.district,
          hazardLevel: level,
          probability: z.riskCell?.probability ?? 0,
          rain24h: Math.round(rain24),
          suscMean: z.suscMean,
          population: z.population,
          isolation: iso,
          score,
          reasons: reasons.slice(0, 4).length ? reasons.slice(0, 4) : ['routine monitoring'],
          recommendedAction: action,
        };
      })
      .sort((a, b) => b.score - a.score || b.hazardLevel - a.hazardLevel)
      .slice(0, 25);

    // district summary
    const districtMap = new Map<string, { district: string; zones: number; l2: number; l3: number; l4: number; population: number; maxLevel: number }>();
    for (const z of zones) {
      const lvl = z.riskCell?.hazardLevel ?? 0;
      const d = districtMap.get(z.district) ?? { district: z.district, zones: 0, l2: 0, l3: 0, l4: 0, population: 0, maxLevel: 0 };
      d.zones++;
      if (lvl >= 2) d.l2++;
      if (lvl >= 3) d.l3++;
      if (lvl >= 4) d.l4++;
      d.population += z.population;
      d.maxLevel = Math.max(d.maxLevel, lvl);
      districtMap.set(z.district, d);
    }

    // alert timeline (6-hour buckets over 72 h)
    const buckets: Array<{ bucket: string; count: number; maxLevel: number }> = [];
    const nowBucket = Math.floor(Date.now() / (6 * 3600_000)) * 6 * 3600_000;
    for (let i = 11; i >= 0; i--) {
      const start = nowBucket - i * 6 * 3600_000;
      const end = start + 6 * 3600_000;
      const inBucket = alerts.filter((a) => a.createdAt.getTime() >= start && a.createdAt.getTime() < end);
      buckets.push({
        bucket: new Date(start).toISOString(),
        count: inBucket.length,
        maxLevel: inBucket.reduce((m, a) => Math.max(m, a.level), 0),
      });
    }

    // escalation stats from snapshots (last 24 h)
    const recentSnaps = snapshots.filter((s) => s.ts.getTime() >= dayAgo);
    const levelDist: Record<string, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
    for (const s of recentSnaps) levelDist[`L${s.hazardLevel}`] = (levelDist[`L${s.hazardLevel}`] ?? 0) + 1;

    /* ── live engine telemetry (computed, never seeded) ─────────────────── */
    const lastRecompute = zones.reduce<Date | null>((m, z) => {
      const t = z.riskCell?.updatedAt ?? null;
      return !m || (t && t > m) ? t : m;
    }, null);
    const levelsNow: Record<string, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
    for (const z of zones) levelsNow[`L${z.riskCell?.hazardLevel ?? 0}`]++;
    const alerts24h = alerts.filter((a) => a.createdAt.getTime() >= dayAgo);
    const sms24h = sms.filter((s) => s.queuedAt.getTime() >= dayAgo).length;
    const reports24h = reports.filter((r) => r.createdAt.getTime() >= dayAgo);
    const checkins24h = checkins.filter((c) => c.createdAt.getTime() >= dayAgo).length;
    const engineRuns = runs.filter((r) => r.name.startsWith('Engine pass'));
    const passes24h = engineRuns.filter((r) => r.createdAt.getTime() >= dayAgo).length;

    // average lead time: first alert → first L3+ alert per zone (last 24 h)
    const firstByZone = new Map<string, { first: number; firstL3: number | null }>();
    for (const a of alerts24h) {
      const cur = firstByZone.get(a.zoneId) ?? { first: a.createdAt.getTime(), firstL3: null };
      if (a.createdAt.getTime() < cur.first) cur.first = a.createdAt.getTime();
      if (a.level >= 3 && (cur.firstL3 == null || a.createdAt.getTime() < cur.firstL3)) cur.firstL3 = a.createdAt.getTime();
      firstByZone.set(a.zoneId, cur);
    }
    const leads = [...firstByZone.values()].filter((v) => v.firstL3 != null && v.firstL3 > v.first);
    const avgLeadTimeMin = leads.length
      ? Math.round(leads.reduce((s, v) => s + (v.firstL3! - v.first) / 60000, 0) / leads.length)
      : null;

    // vision pre-screen stats
    const screened = reports.filter((r) => r.aiPreScreen && r.aiPreScreen !== 'pending');
    const flagged = screened.filter((r) => r.aiPreScreen === 'flagged');
    const visionHits = screened.filter((r) => r.aiSource === 'vision+heuristic').length;

    const registry = [
      {
        id: 'layer-a',
        name: 'Layer A — Susceptibility index',
        version: 'terrain-stats-v2',
        metrics: {
          zones: zones.length,
          avgSusc: Math.round(zones.reduce((s, z) => s + z.suscMean, 0) / Math.max(1, zones.length)),
          suscRange: `${Math.round(Math.min(...zones.map((z) => z.suscMean)))}–${Math.round(Math.max(...zones.map((z) => z.suscMean)))}`,
          factors: 4,
        },
        notes: 'Per-zone terrain decomposition: slope, lithology, land-cover, cut/stream proximity (feeds driver percentages everywhere).',
      },
      {
        id: 'layer-b',
        name: 'Layer B — Hazard nowcast (fused)',
        version: 'physical-prior-v1',
        metrics: {
          zonesEvaluated: zones.length,
          lastRecompute: lastRecompute ? new Date(lastRecompute).toLocaleTimeString() : '—',
          enginePasses24h: passes24h,
          alerts24h: alerts24h.length,
          avgLeadTimeMin: avgLeadTimeMin ?? 'n/a',
        },
        notes: 'I-D thresholds × calibrated probability prior, fused with 2-up/3-down hysteresis; every pass logs a ModelRun row (see below).',
      },
      {
        id: 'layer-d',
        name: 'Layer D — Corridor & routing',
        version: 'corridor-hazard-v1',
        metrics: {
          roadsMonitored: roads.length,
          roadsBlocked: roads.filter((r) => r.status === 'blocked').length,
          detoursActive: roads.filter((r) => r.detour?.available).length,
        },
        notes: 'Per-road corridor hazard + ML blockage prediction + bypass synthesis; 3-option routing with turn-by-turn steps.',
      },
      {
        id: 'model-v',
        name: 'Model V — Vision pre-screen',
        version: 'glm-4.6v + heuristic',
        metrics: {
          screened: screened.length,
          flagged: flagged.length,
          flaggedPct: screened.length ? `${Math.round((flagged.length / screened.length) * 100)}%` : 'n/a',
          vlmRouted: visionHits,
        },
        notes: 'Citizen crack photos analysed server-side (VLM), merged with a text heuristic; flagged photos fan out SMS to officials.',
      },
    ];

    return NextResponse.json({
      priorityQueue: queue,
      districts: [...districtMap.values()].sort((a, b) => b.maxLevel - a.maxLevel || b.l3 - a.l3),
      alertTimeline: buckets,
      levelDistribution: levelDist,
      totalAlerts: alerts.length,
      activeAlerts: alerts.filter((a) => a.status === 'active').length,
      ackedAlerts: alerts.filter((a) => a.status === 'acked').length,
      engineLive: {
        zones: zones.length,
        lastRecompute: lastRecompute ? lastRecompute.toISOString() : null,
        levelsNow,
        escalations24h: alerts24h.filter((a) => a.level > 0 && a.status !== 'allclear').length,
        allclears24h: alerts24h.filter((a) => a.status === 'allclear').length,
        alerts24h: alerts24h.length,
        sms24h,
        notifications24h: alerts24h.length, // one notification event per alert
        reports24h: reports24h.length,
        checkins24h,
        passes24h,
        ackRate: alerts.length ? Math.round((alerts.filter((a) => a.status === 'acked').length / alerts.length) * 100) : 0,
        avgLeadTimeMin,
      },
      registry,
      recentRuns: engineRuns.slice(0, 10).map((r) => ({
        id: r.id,
        at: r.createdAt,
        metrics: JSON.parse(r.metrics || '{}'),
        notes: r.notes,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
