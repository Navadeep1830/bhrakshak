/**
 * Zone evaluation engine — runs the risk engine over the DB fleet.
 * Writes risk cells (latest state), risk snapshots (history), alerts
 * (with 8-language i18n + channel policy), and de-escalation all-clears.
 */
import { db } from '@/lib/db';
import { fanOutAlerts } from '@/lib/notify';
import {
  LEVEL_NAMES,
  ALERT_CHANNEL_POLICY,
  buildDrivers,
  applyHysteresis,
  fuseLevel,
  physicalProb,
  renderI18n,
} from '@/lib/risk-engine';

export interface EvalResult {
  zoneCode: string;
  zoneId: string;
  prevLevel: number;
  newLevel: number;
  probability: number;
  escalated: boolean;
  deescalated: boolean;
}

interface ZoneCtx {
  obs: {
    rain1h: number;
    rain24h: number;
    rain48h: number | null;
    rain72h: number | null;
    rain7d: number | null;
    effRain: number | null;
    soilMoisture: number | null;
  } | null;
}

/** Evaluate every zone: one pass, alert on real transitions. */
export async function evaluateAllZones(opts: { tickCount?: number } = {}): Promise<EvalResult[]> {
  const ticks = Math.max(opts.tickCount ?? 1, 1);
  const zones = await db.zone.findMany({
    include: { riskCell: true, escalations: true },
  });

  // latest rainfall per zone — windowed to the last 7 days (the engine only
  // reads the newest row per zone; this keeps the query bounded as history grows)
  const zoneIds = zones.map((z) => z.id);
  const obsRows = await db.rainfallObs.findMany({
    where: { zoneId: { in: zoneIds }, ts: { gte: new Date(Date.now() - 7 * 86400_000) } },
    orderBy: { ts: 'desc' },
    select: {
      zoneId: true, rain1h: true, rain24h: true, rain48h: true, rain72h: true,
      rain7d: true, effRain: true, soilMoisture: true,
    },
  });

  const obsByZone = new Map<string, (typeof obsRows)[number]>();
  for (const o of obsRows) {
    if (!obsByZone.has(o.zoneId)) obsByZone.set(o.zoneId, o);
  }

  const results: EvalResult[] = [];
  const createdAlerts: Array<{ zoneCode: string; level: number; title: string; message: string; probability: number; languages: Record<string, string>; channels: string[]; zoneId: string }> = [];
  const updates: Array<Promise<unknown>> = [];

  for (const zone of zones) {
    const obs = obsByZone.get(zone.id);
    const ctx: ZoneCtx = {
      obs: obs
        ? {
            rain1h: obs.rain1h,
            rain24h: obs.rain24h,
            rain48h: obs.rain48h,
            rain72h: obs.rain72h,
            rain7d: obs.rain7d,
            effRain: obs.effRain,
            soilMoisture: obs.soilMoisture,
          }
        : null,
    };

    let level = zone.riskCell?.hazardLevel ?? 0;
    const prevLevel = level;
    let esc = zone.escalations ?? { candidate: 0, aboveStreak: 0, belowStreak: 0 };

    for (let t = 0; t < ticks; t++) {
      const rain1h = ctx.obs?.rain1h ?? 0;
      const rain24h = ctx.obs?.rain24h ?? 0;
      const prob = physicalProb(rain1h, rain24h, zone.suscP90);
      const fused = fuseLevel(rain1h, rain24h, zone.suscMean, prob);
      const [nl, above, below] = applyHysteresis(level, fused, esc.aboveStreak, esc.belowStreak);
      level = nl;
      esc = { candidate: fused, aboveStreak: above, belowStreak: below };
    }

    const rain1h = ctx.obs?.rain1h ?? 0;
    const rain24h = ctx.obs?.rain24h ?? 0;
    const prob = physicalProb(rain1h, rain24h, zone.suscP90);
    const drivers = buildDrivers(
      rain1h,
      rain24h,
      ctx.obs?.rain72h ?? null,
      ctx.obs?.rain7d ?? null,
      ctx.obs?.soilMoisture ?? null,
      zone.suscP90,
      false,
      zone.zoneCode
    );

    const escalated = level > prevLevel;
    const deescalated = level < prevLevel;

    updates.push(
      db.riskCell.upsert({
        where: { zoneId: zone.id },
        create: {
          zoneId: zone.id,
          hazardLevel: level,
          probability: Math.round(prob * 10000) / 10000,
          modelVersion: 'physical-prior-v1',
          drivers: JSON.stringify(drivers),
        },
        update: {
          hazardLevel: level,
          probability: Math.round(prob * 10000) / 10000,
          modelVersion: 'physical-prior-v1',
          drivers: JSON.stringify(drivers),
        },
      }),
      db.escalationState.upsert({
        where: { zoneId: zone.id },
        create: { zoneId: zone.id, ...esc },
        update: { ...esc },
      }),
      db.riskSnapshot.create({
        data: {
          zoneId: zone.id,
          hazardLevel: level,
          probability: Math.round(prob * 10000) / 10000,
          modelVersion: 'physical-prior-v1',
          rain1h,
          rain24h,
        },
      })
    );

    if (escalated && level >= 1) {
      const key = `alert.l${level}`;
      const village = zone.name;
      const levelName = `L${level} ${LEVEL_NAMES[level]}`;
      const languages = renderI18n(key, village, levelName);
      createdAlerts.push({
        zoneId: zone.id,
        zoneCode: zone.zoneCode,
        level,
        title: `${LEVEL_NAMES[level]} — ${zone.name} (${zone.zoneCode})`,
        message: languages['en'] ?? '',
        probability: Math.round(prob * 10000) / 10000,
        languages,
        channels: ALERT_CHANNEL_POLICY[level] ?? ['push'],
      });
    } else if (deescalated) {
      // all-clear when dropping to L0, or a downgrade notice for L1+
      const key = level === 0 ? 'alert.allclear' : `alert.l${level}`;
      const village = zone.name;
      const levelName = level === 0 ? 'All Clear' : `L${level} ${LEVEL_NAMES[level]}`;
      const languages = renderI18n(key, village, levelName);
      createdAlerts.push({
        zoneId: zone.id,
        zoneCode: zone.zoneCode,
        level,
        title: `${level === 0 ? 'All Clear' : LEVEL_NAMES[level]} — ${zone.name} (${zone.zoneCode})`,
        message: languages['en'] ?? '',
        probability: Math.round(prob * 10000) / 10000,
        languages,
        channels: ['push'],
      });
      // auto-resolve prior active alerts for this zone
      updates.push(
        db.alert.updateMany({
          where: { zoneId: zone.id, status: 'active' },
          data: { status: 'allclear' },
        })
      );
    }

    results.push({
      zoneId: zone.id,
      zoneCode: zone.zoneCode,
      prevLevel,
      newLevel: level,
      probability: Math.round(prob * 10000) / 10000,
      escalated,
      deescalated,
    });
  }

  // persist alerts after loops, then fan out notifications + SMS
  for (const a of createdAlerts) {
    updates.push(
      db.alert.create({
        data: {
          zoneId: a.zoneId,
          level: a.level,
          title: a.title,
          message: a.message,
          probability: a.probability,
          languages: JSON.stringify(a.languages),
          channels: JSON.stringify(a.channels),
          status: 'active',
        },
      })
    );
  }

  // ── comms fan-out: every alert becomes an in-app notification; L3+ also
  //    triggers SMS to every registered device in the district's scope.
  if (createdAlerts.length) {
    try {
      const zoneDistrict = new Map(zones.map((z) => [z.id, z.district]));
      await fanOutAlerts(
        createdAlerts.map((a) => ({
          zoneId: a.zoneId,
          zoneCode: a.zoneCode,
          district: zoneDistrict.get(a.zoneId) ?? null,
          level: a.level,
          title: a.title,
          message: a.message,
          probability: a.probability,
          kind: a.level === 0 ? ('allclear' as const) : ('landslide_alert' as const),
        }))
      );
    } catch (e) {
      console.error('[notify] fan-out failed', e);
    }
  }

  await Promise.all(updates);

  // ── engine pass log: a ModelRun row whenever zones actually changed level.
  //    This is what the Analytics "recent engine passes" table reads — every
  //    row is a real pass over live state, never a seeded number.
  const escalatedN = results.filter((r) => r.escalated).length;
  const deescalatedN = results.filter((r) => r.deescalated).length;
  if (escalatedN + deescalatedN > 0) {
    try {
      await db.modelRun.create({
        data: {
          name: 'Engine pass — hazard nowcast',
          version: 'physical-prior-v1',
          metrics: JSON.stringify({
            zones: zones.length,
            escalated: escalatedN,
            deescalated: deescalatedN,
            alerts: createdAlerts.length,
            maxLevel: results.reduce((m, r) => Math.max(m, r.newLevel), 0),
          }),
          notes: `live engine pass · ${createdAlerts.length} alert(s) fanned out`,
        },
      });
    } catch { /* non-fatal */ }
  }

  return results;
}
