/**
 * BhuRakshak scenario simulation core — the manual control plane.
 *
 * Everything a judge (or operator) injects through the Simulation tab flows
 * through here:
 *   - injectConditions(): write real RainfallObs rows from MANUAL numbers,
 *     then run the production evaluateAllZones() pass — same thresholds,
 *     same hysteresis, same alert + SMS fan-out as live telemetry.
 *   - decayConditions(): rainfall decays to drizzle, engine de-escalates.
 *   - predictDry(): pure model console — any numbers in, fused level,
 *     probability and driver contributions out. Zero DB writes, so you can
 *     prove live that the model reacts to arbitrary input (not hardcoded).
 */
import { db } from '@/lib/db';
import { evaluateAllZones, EvalResult } from '@/lib/engine';
import { buildDrivers, physicalProb, thresholdTier, mlTier, fuseLevel, suscBand, THRESHOLDS_BY_SUSC_BAND } from '@/lib/risk-engine';

export interface InjectInput {
  district?: string | null;
  zoneCode?: string | null;
  rain1h: number;
  rain24h: number;
  rain72h?: number | null;
  rain7d?: number | null;
  soilMoisture?: number | null;
  hours?: number; // spread the injection over N hourly rows (default 1)
  label?: string | null;
}

export interface ZoneChange {
  zoneCode: string;
  name: string;
  district: string;
  before: number;
  after: number;
  probability: number;
  escalated: boolean;
  deescalated: boolean;
}

export interface InjectReport {
  ok: boolean;
  scope: string;
  zonesInjected: number;
  changes: ZoneChange[];
  escalated: number;
  deescalated: number;
  maxLevel: number;
  alertsFired: number;
  notifications: number;
  sms: number;
  levelCounts: Record<string, number>;
  ranAt: string;
}

function clampNum(v: number | null | undefined, min: number, max: number, fallback: number): number {
  if (v == null || Number.isNaN(v)) return fallback;
  return Math.min(Math.max(v, min), max);
}

/** Snapshot of current hazard levels per zone (for before→after diffs). */
async function levelsByZone(district?: string | null, zoneCode?: string | null): Promise<Map<string, number>> {
  const zones = await db.zone.findMany({
    where: zoneCode ? { zoneCode } : district ? { district } : undefined,
    select: { id: true, riskCell: { select: { hazardLevel: true } } },
  });
  return new Map(zones.map((z) => [z.id, z.riskCell?.hazardLevel ?? 0]));
}

/**
 * Inject manually-specified weather conditions as real observation rows and
 * run the production risk engine over them.
 */
export async function injectConditions(input: InjectInput): Promise<InjectReport> {
  const hours = Math.round(clampNum(input.hours, 1, 12, 1));
  const rain1h = clampNum(input.rain1h, 0, 120, 0);
  const rain24h = clampNum(input.rain24h, 0, 400, 0);
  const rain72h = input.rain72h == null ? null : clampNum(input.rain72h, 0, 600, 0);
  const rain7d = input.rain7d == null ? null : clampNum(input.rain7d, 0, 1000, 0);
  const soil = input.soilMoisture == null ? null : clampNum(input.soilMoisture, 0, 100, 0);

  const zones = await db.zone.findMany({
    where: input.zoneCode ? { zoneCode: input.zoneCode.toUpperCase() } : input.district ? { district: input.district } : undefined,
    select: { id: true, zoneCode: true, name: true, district: true },
  });
  if (!zones.length) throw new Error(input.zoneCode ? `Unknown zone ${input.zoneCode}` : `No zones in scope`);

  const before = await levelsByZone(input.district ?? null, input.zoneCode ?? null);

  // latest obs per zone (to ramp from when hours > 1)
  const now = Date.now();
  for (const z of zones) {
    const recent = await db.rainfallObs.findFirst({ where: { zoneId: z.id }, orderBy: { ts: 'desc' } });
    const start1h = recent?.rain1h ?? 0;
    const start24 = recent?.rain24h ?? 0;
    const start72 = rain72h ?? recent?.rain72h ?? rain24h * 1.4;
    const start7d = rain7d ?? recent?.rain7d ?? rain24h * 1.9;
    const startSoil = soil ?? recent?.soilMoisture ?? 55;

    for (let h = hours; h >= 1; h--) {
      const k = (hours - h + 1) / hours; // 1/n → 1 (ramp to target, newest last)
      const r1h = Math.round((start1h + (rain1h - start1h) * k) * 10) / 10;
      const r24 = Math.round((start24 + (rain24h - start24) * k) * 10) / 10;
      await db.rainfallObs.create({
        data: {
          zoneId: z.id,
          ts: new Date(now - (h - 1) * 1800_000),
          rain1h: r1h,
          rain24h: r24,
          rain48h: Math.round(r24 * 1.22 * 10) / 10,
          rain72h: rain72h != null ? Math.round((start72 + (rain72h - start72) * k) * 10) / 10 : Math.round(Math.max(start72 * 0.97 + r1h, r24 * 1.4) * 10) / 10,
          rain7d: rain7d != null ? Math.round((start7d + (rain7d - start7d) * k) * 10) / 10 : Math.round(Math.max(start7d * 0.985 + r1h, r24 * 1.9) * 10) / 10,
          effRain: Math.round(r24 * 0.62 * 10) / 10,
          soilMoisture: soil != null ? Math.round((startSoil + (soil - startSoil) * k) * 10) / 10 : Math.round(Math.min(96, startSoil * 0.97 + r1h * 0.45 + 1) * 10) / 10,
          source: 'sim',
        },
      });
    }
  }

  const t0 = new Date();
  const results: EvalResult[] = await evaluateAllZones({ tickCount: 2 });
  const inScope = new Set(zones.map((z) => z.id));
  const scoped = results.filter((r) => inScope.has(r.zoneId));

  const [alertsFired, notifications, sms] = await Promise.all([
    db.alert.count({ where: { createdAt: { gte: t0 } } }),
    db.notificationEvent.count({ where: { createdAt: { gte: t0 } } }),
    db.smsMessage.count({ where: { queuedAt: { gte: t0 } } }),
  ]);

  const nameById = new Map(zones.map((z) => [z.id, z]));
  const changes: ZoneChange[] = scoped
    .map((r) => ({
      zoneCode: r.zoneCode,
      name: nameById.get(r.zoneId)?.name ?? r.zoneCode,
      district: nameById.get(r.zoneId)?.district ?? '',
      before: before.get(r.zoneId) ?? r.prevLevel,
      after: r.newLevel,
      probability: r.probability,
      escalated: r.escalated,
      deescalated: r.deescalated,
    }))
    .filter((c) => c.before !== c.after || c.escalated || c.deescalated)
    .sort((a, b) => b.after - a.after || (b.after - b.before) - (a.after - a.before));

  const levelCounts: Record<string, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const r of scoped) levelCounts[`L${r.newLevel}`] = (levelCounts[`L${r.newLevel}`] ?? 0) + 1;

  return {
    ok: true,
    scope: input.zoneCode ? `zone ${input.zoneCode.toUpperCase()}` : input.district ? `district ${input.district}` : 'all districts',
    zonesInjected: zones.length,
    changes: changes.slice(0, 40),
    escalated: scoped.filter((r) => r.escalated).length,
    deescalated: scoped.filter((r) => r.deescalated).length,
    maxLevel: scoped.reduce((m, r) => Math.max(m, r.newLevel), 0),
    alertsFired,
    notifications,
    sms,
    levelCounts,
    ranAt: new Date().toISOString(),
  };
}

/**
 * Rainfall decays to drizzle over 3 steps — the engine's 3-tick
 * de-escalation hysteresis then steps zones down and fires all-clears.
 */
export async function decayConditions(district?: string | null): Promise<{ deescalated: number; levelsAfter: Record<string, number>; zones: number }> {
  const zones = await db.zone.findMany({
    where: district ? { district } : undefined,
    select: { id: true },
  });
  if (!zones.length) throw new Error(`No zones for scope "${district ?? 'all'}"`);

  const now = Date.now();
  for (const z of zones) {
    const recent = await db.rainfallObs.findFirst({ where: { zoneId: z.id }, orderBy: { ts: 'desc' } });
    const prev24 = recent?.rain24h ?? 40;
    const prev72 = recent?.rain72h ?? prev24 * 1.42;
    const prev7d = recent?.rain7d ?? prev24 * 1.9;
    const prevEff = recent?.effRain ?? prev24 * 0.62;
    const prevSoil = recent?.soilMoisture ?? 60;

    for (let h = 3; h >= 1; h--) {
      const decay = h === 3 ? 0.55 : h === 2 ? 0.28 : 0.08;
      await db.rainfallObs.create({
        data: {
          zoneId: z.id,
          ts: new Date(now - (h - 1) * 1500_000),
          rain1h: Math.round(prev24 * 0.02 * decay * 10) / 10,
          rain24h: Math.round(prev24 * decay * 10) / 10,
          rain48h: Math.round(prev24 * decay * 1.2 * 10) / 10,
          rain72h: Math.round(prev72 * decay * 10) / 10,
          rain7d: Math.round(Math.max(prev7d * 0.9, prev24 * decay) * 10) / 10,
          effRain: Math.round(prevEff * decay * 10) / 10,
          soilMoisture: Math.round(Math.max(35, prevSoil * (0.8 + 0.06 * h)) * 10) / 10,
          source: 'sim',
        },
      });
    }
  }

  const results = await evaluateAllZones({ tickCount: 3 });
  const levelsAfter: Record<string, number> = { L0: 0, L1: 0, L2: 0, L3: 0, L4: 0 };
  for (const r of results) levelsAfter[`L${r.newLevel}`] = (levelsAfter[`L${r.newLevel}`] ?? 0) + 1;
  return {
    deescalated: results.filter((r) => r.deescalated).length,
    levelsAfter,
    zones: zones.length,
  };
}

/* ── pure model console (no writes) ────────────────────────────────── */

export interface PredictInput {
  zoneCode?: string | null;
  suscMean?: number | null;
  suscP90?: number | null;
  rain1h: number;
  rain24h: number;
  rain72h?: number | null;
  rain7d?: number | null;
  soilMoisture?: number | null;
  seismic?: boolean;
}

export interface PredictOutput {
  ok: boolean;
  zone: { zoneCode: string; name: string; district: string; suscMean: number; suscP90: number; currentLevel: number } | null;
  currentObs: { rain1h: number; rain24h: number; rain72h: number | null; rain7d: number | null; soilMoisture: number | null; ts: string } | null;
  inputs: { rain1h: number; rain24h: number; rain72h: number | null; rain7d: number | null; soilMoisture: number | null; suscMean: number; suscP90: number; seismic: boolean };
  probability: number;
  thresholdTier: number;
  mlPriorTier: number;
  fusedLevel: number;
  suscBand: string;
  idThresholds: Array<{ level: number; rain24h: number; rain1h: number; breached24h: boolean; breachedIntensity: boolean }>;
  drivers: Array<{ feature: string; name: string; value: string; contribution: number; description: string }>;
  formula: string;
}

/**
 * Dry-run the fused model on ANY numbers. Uses exactly the functions the
 * production engine uses — physicalProb, thresholdTier, fuseLevel, buildDrivers.
 */
export async function predictDry(input: PredictInput): Promise<PredictOutput> {
  const rain1h = clampNum(input.rain1h, 0, 120, 0);
  const rain24h = clampNum(input.rain24h, 0, 400, 0);

  let zone: PredictOutput['zone'] = null;
  let currentObs: PredictOutput['currentObs'] = null;
  let suscMean = input.suscMean ?? 55;
  let suscP90 = input.suscP90 ?? 70;

  if (input.zoneCode) {
    const z = await db.zone.findUnique({
      where: { zoneCode: input.zoneCode.toUpperCase() },
      include: { riskCell: true },
    });
    if (!z) throw new Error(`Unknown zone ${input.zoneCode}`);
    zone = { zoneCode: z.zoneCode, name: z.name, district: z.district, suscMean: z.suscMean, suscP90: z.suscP90, currentLevel: z.riskCell?.hazardLevel ?? 0 };
    suscMean = input.suscMean ?? z.suscMean;
    suscP90 = input.suscP90 ?? z.suscP90;
    const obs = await db.rainfallObs.findFirst({ where: { zoneId: z.id }, orderBy: { ts: 'desc' } });
    if (obs) {
      currentObs = {
        rain1h: obs.rain1h, rain24h: obs.rain24h, rain72h: obs.rain72h, rain7d: obs.rain7d,
        soilMoisture: obs.soilMoisture, ts: obs.ts.toISOString(),
      };
    }
  }

  const rain72h = input.rain72h ?? currentObs?.rain72h ?? Math.round(rain24h * 1.4 * 10) / 10;
  const rain7d = input.rain7d ?? currentObs?.rain7d ?? Math.round(rain24h * 1.9 * 10) / 10;
  const soil = input.soilMoisture ?? currentObs?.soilMoisture ?? 55;
  const seismic = !!input.seismic;

  const prob = physicalProb(rain1h, rain24h, suscP90, seismic);
  const tier = thresholdTier(rain1h, rain24h, suscMean);
  const prior = mlTier(prob);
  const fused = fuseLevel(rain1h, rain24h, suscMean, prob);
  const band = suscBand(suscMean);
  const thresholds = THRESHOLDS_BY_SUSC_BAND[band];

  const drivers = buildDrivers(rain1h, rain24h, rain72h, rain7d, soil, suscP90, seismic, input.zoneCode ?? 'manual').map((d) => ({
    feature: d.feature,
    name: d.name,
    value: d.value,
    contribution: d.contribution,
    description: d.description,
  }));

  const formula =
    `P = sigmoid(−6.5 + 0.035×${Math.round(rain24h)} + 0.045×${Math.round(rain1h * 10) / 10} + 0.04×${Math.round(suscP90)}${seismic ? ' + 2.5 (seismic)' : ''}) = ${(Math.round(prob * 1000) / 10).toFixed(1)}%`;

  return {
    ok: true,
    zone,
    currentObs,
    inputs: { rain1h, rain24h, rain72h, rain7d, soilMoisture: soil, suscMean, suscP90, seismic },
    probability: Math.round(prob * 10000) / 10000,
    thresholdTier: tier,
    mlPriorTier: prior,
    fusedLevel: fused,
    suscBand: band,
    idThresholds: thresholds.map(([t24, t1h, lvl]) => ({
      level: lvl,
      rain24h: t24,
      rain1h: t1h,
      breached24h: rain24h >= t24,
      breachedIntensity: rain24h >= t24 * 0.6 && rain1h >= t1h,
    })),
    drivers,
    formula,
  };
}
