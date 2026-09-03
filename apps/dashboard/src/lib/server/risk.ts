// Risk fusion + alert engine — faithful TS port of
// apps/api/app/services/risk_engine.py (thresholds, hysteresis, driver
// breakdown, forecast projection, alert channel policy, event fan-out).
import type { LiveEvent, Store, Zone } from "./store";
import type { Driver } from "../types";
import { renderMessage, LEVEL_NAMES } from "./i18n";

// Interpretable I-D thresholds (mm) per susceptibility class band.
// [duration_min, mean_intensity_mm_h, level] — escalate at the highest row
// whose duration AND intensity are both met.
export const THRESHOLDS_BY_SUSC_BAND: Record<
  string,
  [number, number, number][]
> = {
  low: [[60, 20, 1], [110, 30, 2], [160, 40, 3], [230, 55, 4]],
  moderate: [[50, 15, 1], [95, 25, 2], [140, 35, 3], [200, 48, 4]],
  high: [[40, 12, 1], [80, 20, 2], [120, 28, 3], [170, 40, 4]],
  very_high: [[32, 10, 1], [65, 16, 2], [100, 24, 3], [150, 34, 4]],
};

// 72h forecast multiplier per horizon (drop-off after peak).
export const FORECAST_MULT = [1.0, 1.15, 0.92, 0.7];

export function suscBand(mean: number): string {
  if (mean < 30) return "low";
  if (mean < 50) return "moderate";
  if (mean < 70) return "high";
  return "very_high";
}

/** Physical intensity-duration threshold tier for a zone. */
export function thresholdTier(
  durMin: number,
  meanIntensity: number,
  band: string,
): number {
  let tier = 0;
  for (const [d, i, lvl] of THRESHOLDS_BY_SUSC_BAND[band] ?? []) {
    if (durMin >= d && meanIntensity >= i) tier = Math.max(tier, lvl);
  }
  return tier;
}

/** Model B physical logistic prior → probability of hazard in 24h. */
export function logisticPrior(z: Zone): number {
  const x =
    -6.1 +
    0.048 * z.rainIntensity +
    0.011 * z.antecedent +
    0.045 * (z.suscMean - 50) +
    0.02 * (z.soilMoisture - 50) +
    0.06 * Math.min(3, z.creepMmYear / 10) +
    (z.stormRamp - 1) * 1.4;
  return 1 / (1 + Math.exp(-x));
}

export function mlTierFromProb(p: number): number {
  if (p < 0.25) return 0;
  if (p < 0.45) return 1;
  if (p < 0.65) return 2;
  if (p < 0.85) return 3;
  return 4;
}

/** Model C: active creep clusters get +1 tier upgrade (capped at 4). */
export function creepUpgrade(z: Zone): number {
  return z.creepMmYear > 20 ? 1 : 0;
}

export function alertChannels(level: number): string[] {
  if (level >= 4) return ["sms", "app", "ivr", "siren"];
  if (level === 3) return ["sms", "app", "ivr"];
  if (level === 2) return ["sms", "app"];
  if (level === 1) return ["app"];
  return [];
}

/** Driver breakdown for the dossier (contributions normalise to 1). */
export function drivers(z: Zone): Driver[] {
  const rows: Omit<Driver, "contribution">[] = [
    {
      feature: "Slope & Susceptibility",
      name: "Terrain Susceptibility Index",
      value: `${z.suscMean.toFixed(1)} / 100`,
      val_num: z.suscMean,
      description:
        "Model A static score — slope, geology, land-cover, historical inventory (LODO CV).",
    },
    {
      feature: "Rainfall Intensity",
      name: "I-D Threshold Position",
      value: `${z.rainIntensity.toFixed(1)} mm/h · ${z.rain24h} mm/24h`,
      val_num: z.rainIntensity,
      description:
        "GSI-style intensity-duration check against the zone's susceptibility band.",
    },
    {
      feature: "Antecedent Moisture",
      name: "7-Day Antecedent Index",
      value: `${z.antecedent} mm`,
      val_num: z.antecedent,
      description: " exponentially-weighted rainfall memory (48h half-life).",
    },
    {
      feature: "Soil Saturation",
      name: "In-Situ Soil Moisture",
      value: `${z.soilMoisture.toFixed(0)} % VWC`,
      val_num: z.soilMoisture,
      description: "ESP32 IoT sensors — saturated slopes lose shear strength.",
    },
    {
      feature: "Deformation (Model C)",
      name: "PSInSAR Creep Velocity",
      value: `${z.creepMmYear.toFixed(1)} mm/yr`,
      val_num: z.creepMmYear,
      description:
        "Sentinel-1 LOS velocity — >20 mm/yr flags an active creep cluster (+1 tier).",
    },
    {
      feature: "Forecast (72h)",
      name: "Projected Rainfall Loading",
      value: `${(z.rainIntensity * FORECAST_MULT[1]).toFixed(1)} mm/h +24h`,
      val_num: z.rainIntensity * FORECAST_MULT[1],
      description: "IMD/Open-Meteo ensemble horizon feeding the projection.",
    },
  ];
  // softmax-ish weighting over normalised magnitudes
  const w = rows.map((r) => Math.max(0.05, (r.val_num ?? 0) / 100));
  const sum = w.reduce((a, b) => a + b, 0);
  return rows.map((r, i) => ({ ...r, contribution: +(w[i] / sum).toFixed(3) }));
}

// ---------------------------------------------------------------- tick
function emit(store: Store, ev: Omit<LiveEvent, "id" | "ts">) {
  store.events.unshift({ ...ev, id: ++store.eventSeq, ts: Date.now() });
  if (store.events.length > 120) store.events.length = 120;
}

function fireAlert(store: Store, z: Zone, level: number, lang = "en") {
  const message = renderMessage(level, z.name, lang);
  store.alerts.unshift({
    id: ++store.alertSeq,
    zone_id: z.id,
    zone_code: z.zone_code,
    zone_name: z.name,
    district: z.district,
    level,
    lang,
    message,
    channels: alertChannels(level),
    created_at: Date.now(),
    ack: false,
  });
  if (store.alerts.length > 200) store.alerts.length = 200;
  emit(store, {
    kind: "alert",
    text: `L${level} ${LEVEL_NAMES[level]} → ${z.name} (${z.zone_code}): ${message}`,
    level,
    zone_code: z.zone_code,
  });
}

/**
 * One engine tick: drift sensors, recompute fused tiers, apply
 * anti-flapping hysteresis (escalate after 2 consecutive ticks, de-escalate
 * after 3 below current-1), fan alerts out on escalation.
 */
export function tick(store: Store, opts: { force?: boolean } = {}): void {
  const now = Date.now();
  if (!opts.force && now - store.lastTick < 15_000) return;
  store.lastTick = now;

  for (const z of store.zones) {
    // natural sensor drift (live gauges)
    if (!store.stormActive) {
      z.rainIntensity = Math.max(
        0,
        +(z.rainIntensity + (Math.random() - 0.5) * 2.4).toFixed(1),
      );
      z.soilMoisture = Math.max(
        30,
        Math.min(96, z.soilMoisture + (Math.random() - 0.48) * 1.6),
      );
    }
    z.rain24h = Math.max(
      0,
      +(z.rain24h * 0.995 + z.rainIntensity * 0.25).toFixed(0),
    );

    const band = suscBand(z.suscMean);
    const durMin = Math.min(480, Math.round((z.rain24h / Math.max(1, z.rainIntensity)) * 60));
    const tTier = thresholdTier(durMin, z.rainIntensity, band);
    const prob = logisticPrior(z);
    const mTier = Math.min(4, mlTierFromProb(prob) + creepUpgrade(z));
    z.thresholdTier = tTier;
    z.mlTier = mTier;
    z.prob24h = +prob.toFixed(3);
    const fused = Math.max(tTier, mTier);

    // --- hysteresis ladder
    if (fused > z.hazardLevel) {
      z.escVotes += 1;
      z.descVotes = 0;
      if (z.escVotes >= 2) {
        const prev = z.hazardLevel;
        z.hazardLevel = fused;
        z.escVotes = 0;
        if (fused >= 1) fireAlert(store, z, fused);
        else emit(store, {
          kind: "risk_diff",
          text: `${z.zone_code} ${z.name}: L${prev} → L${fused}`,
          level: fused,
          zone_code: z.zone_code,
        });
      }
    } else if (fused < z.hazardLevel - 1) {
      z.descVotes += 1;
      z.escVotes = 0;
      if (z.descVotes >= 3) {
        const prev = z.hazardLevel;
        z.hazardLevel = Math.max(fused, z.hazardLevel - 2);
        z.descVotes = 0;
        if (prev >= 2 && z.hazardLevel < 2) {
          emit(store, {
            kind: "allclear",
            text: `All clear: ${z.zone_code} ${z.name} — risk receded to L${z.hazardLevel}`,
            level: z.hazardLevel,
            zone_code: z.zone_code,
          });
        } else {
          emit(store, {
            kind: "risk_diff",
            text: `${z.zone_code} ${z.name}: L${prev} → L${z.hazardLevel}`,
            level: z.hazardLevel,
            zone_code: z.zone_code,
          });
        }
      }
    } else {
      z.escVotes = 0;
      z.descVotes = 0;
    }

    z.history.push({
      t: now,
      level: z.hazardLevel,
      rain: Math.round(z.rainIntensity),
      prob: z.prob24h,
    });
    if (z.history.length > 72) z.history.shift();
  }

  // sensor mirror
  for (const s of store.sensors) {
    const z = store.zones.find((x) => x.id === s.zone_id);
    if (z) {
      s.soil = Math.round(z.soilMoisture);
      s.rain_mm_h = z.rainIntensity;
    }
  }
}

/** Demo storm: 9 East Khasi Hills zones get a 55 mm/h ramp, engine ticks x2. */
export function injectStorm(store: Store) {
  const ekh = store.zones.filter((z) => z.district === "East Khasi Hills");
  const targets = ekh.slice(0, 9);
  for (const z of targets) {
    z.stormRamp = 2.6 + Math.random() * 0.9;
    z.rainIntensity = +(z.rainIntensity + 55 * z.stormRamp * 0.35).toFixed(1);
    z.rain24h = +(z.rain24h + 190).toFixed(0);
    z.soilMoisture = Math.min(97, z.soilMoisture + 22);
    z.escVotes = 1; // pre-arm: storm inject escalates in a single force-tick
  }
  store.stormActive = true;
  tick(store, { force: true });
  tick(store, { force: true });
  const l2 = store.zones.filter((z) => z.hazardLevel >= 2).length;
  emit(store, {
    kind: "demo",
    text: `Storm injected over East Khasi Hills — 9 zones ramped, ${l2} zones now L2+`,
    level: 4,
  });
  return {
    demo_mode: true,
    district: "East Khasi Hills",
    zones_injected: targets.length,
    peak_mm_h: 55,
    zones_at_l2_plus: l2,
    levels: store.zones
      .slice(0, 12)
      .map((z) => ({ zone_code: z.zone_code, level: z.hazardLevel })),
  };
}
