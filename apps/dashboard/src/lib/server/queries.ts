// Query layer: zone DTOs, dossier assembly, KPIs, geojson, briefing markdown.
import { promises as fs } from "fs";
import path from "path";
import type { Store, Zone } from "./store";
import type { Dossier, KpisOut, ZoneOut, WeatherOut } from "../types";
import { drivers, suscBand, thresholdTier, FORECAST_MULT } from "./risk";
import { LEVEL_NAMES } from "./i18n";
import { roadStatus } from "./roads";

export function zoneOut(z: Zone): ZoneOut {
  return {
    id: z.id,
    zone_code: z.zone_code,
    name: z.name,
    district: z.district,
    state: z.state,
    hazard_level: z.hazardLevel,
    susc_mean: z.suscMean,
    susc_p90: z.suscP90,
    prob_24h: z.prob24h,
    population: z.population,
    road_km: z.roadKm,
  };
}

export function zonesGeojson(store: Store, district?: string | null, horizon = 0) {
  const mult = FORECAST_MULT[Math.max(0, Math.min(3, horizon))];
  const zs = district
    ? store.zones.filter((z) => z.district === district)
    : store.zones;
  return {
    type: "FeatureCollection" as const,
    features: zs.map((z) => {
      let lvl = z.hazardLevel;
      if (horizon > 0) {
        // one-shot projection (no hysteresis): intensity x mult -> tiers
        const band = suscBand(z.suscMean);
        const projInt = z.rainIntensity * mult;
        const durMin = Math.min(480, Math.round((z.rain24h / Math.max(1, projInt)) * 60));
        lvl = Math.max(thresholdTier(durMin, projInt, band), z.hazardLevel > 0 ? 1 : 0);
      }
      return {
        type: "Feature" as const,
        id: z.id,
        properties: {
          zone_id: z.id,
          zone_code: z.zone_code,
          name: z.name,
          district: z.district,
          state: z.state,
          hazard_level: lvl,
          current_level: z.hazardLevel,
          horizon,
          susc_mean: z.suscMean,
          susc_p90: z.suscP90,
          population: z.population,
          prob_24h: +z.prob24h.toFixed(3),
          creep_mm_year: z.creepMmYear,
          isolation: z.isolationScore,
        },
        geometry: { type: "Polygon" as const, coordinates: z.hex },
      };
    }),
  };
}

export function roadsGeojson(store: Store) {
  return {
    type: "FeatureCollection" as const,
    features: store.roads.flatMap((r) => {
      const a = store.zones.find((z) => z.id === r.from_zone);
      const b = store.zones.find((z) => z.id === r.to_zone);
      if (!a || !b) return [];
      return [{
        type: "Feature" as const,
        id: r.id,
        properties: {
          id: r.id, name: r.name, cls: r.cls, km: r.km,
          status: roadStatus(store, r),
        },
        geometry: {
          type: "LineString" as const,
          coordinates: [a.center, b.center],
        },
      }];
    }),
  };
}

export function reportsGeojson(store: Store) {
  return {
    type: "FeatureCollection" as const,
    features: store.reports.flatMap((rep) => {
      const z = store.zones.find((x) => x.id === rep.zone_id);
      if (!z) return [];
      return [{
        type: "Feature" as const,
        id: String(rep.id),
        properties: {
          id: rep.id, type: rep.type, status: rep.status,
          note: rep.note, zone_code: z.zone_code,
        },
        geometry: { type: "Point" as const, coordinates: [rep.lon, rep.lat] },
      }];
    }),
  };
}

export function kpis(store: Store): KpisOut {
  const day = Date.now() - 24 * 3600_000;
  return {
    zones_l3_l4: store.zones.filter((z) => z.hazardLevel >= 3).length,
    alerts_today: store.alerts.filter((a) => a.created_at > day).length,
    pending_reports: store.reports.filter((r) => r.status === "pending").length,
    sensors_online: store.sensors.filter((s) => s.online).length,
    total_zones: store.zones.length,
  };
}

export function weatherOut(z: Zone): WeatherOut {
  const band = suscBand(z.suscMean);
  const durationMin = Math.min(
    480,
    Math.round((z.rain24h / Math.max(1, z.rainIntensity)) * 60),
  );
  const tier = thresholdTier(durationMin, z.rainIntensity, band);
  const forecast = FORECAST_MULT.map((m, i) => ({
    h: i * 24,
    mm: Math.round(z.rainIntensity * m * 6),
    level: Math.min(
      4,
      thresholdTier(durationMin, z.rainIntensity * m, band) || (i === 0 ? z.hazardLevel : 0),
    ),
  }));
  return {
    zone: {
      zone_code: z.zone_code, name: z.name,
      district: z.district, level: z.hazardLevel,
    },
    current: {
      intensity_mm_h: z.rainIntensity,
      rain_24h: z.rain24h,
      soil_moisture: Math.round(z.soilMoisture),
      antecedent: z.antecedent,
    },
    id_check: {
      band,
      duration_min: durationMin,
      thresholds: [],
      tier,
      verdict:
        tier >= 3 ? "EXCEEDED — intensity-duration threshold crossed at high severity"
        : tier === 2 ? "APPROACHING — threshold tier reached, watch closely"
        : tier === 1 ? "WATCH — low-tier threshold met"
        : "Within safe limits for this susceptibility band",
    },
    forecast_72h: forecast,
  };
}

export function dossier(store: Store, z: Zone, opts: { authed?: boolean } = {}): Dossier {
  // zone-scoped reports: within ~0.06 deg of the zone centre
  const reports = store.reports
    .filter((r) => {
      const rz = store.zones.find((x) => x.id === r.zone_id);
      if (!rz) return false;
      return (
        Math.abs(rz.center[0] - z.center[0]) < 0.06 &&
        Math.abs(rz.center[1] - z.center[1]) < 0.06
      );
    })
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 8)
    .map((r) => ({
      id: r.id, type: r.type, note: r.note, status: r.status,
      verdict: r.verdict, created_at: r.created_at,
    }));

  const d = drivers(z);
  const wx = weatherOut(z);

  return {
    zone: {
      ...zoneOut(z),
      center: z.center,
      rain_intensity: z.rainIntensity,
      rain_24h: z.rain24h,
      antecedent: z.antecedent,
      soil_moisture: Math.round(z.soilMoisture),
      creep_mm_year: z.creepMmYear,
      isolation_score: z.isolationScore,
      flood_index: z.floodIndex,
      road_class: z.roadClass,
      threshold_tier: z.thresholdTier,
      ml_tier: z.mlTier,
      history: z.history.slice(-24),
    },
    drivers: d,
    reports,
    weather: {
      intensity_mm_h: wx.current.intensity_mm_h,
      duration_min: wx.id_check.duration_min,
      band: wx.id_check.band,
      threshold: [],
      check: wx.id_check.verdict,
      forecast_72h: wx.forecast_72h,
    },
    briefing_md: opts.authed ? briefingMd(store, z) : "",
  };
}

export function briefingMd(store: Store, z: Zone): string {
  const drv = drivers(z)
    .map((d, i) => `${i + 1}. **${d.name}** (${d.feature}) — ${d.value} · contribution ${(((d.contribution ?? 0)) * 100).toFixed(0)}%`)
    .join("\n");
  const blocked = store.roads.filter(
    (r) => (r.from_zone === z.id || r.to_zone === z.id) && roadStatus(store, r) === "blocked",
  );
  const lines = [
    `# BhuRakshak Zone Briefing — ${z.name} (${z.zone_code})`,
    ``,
    `**District:** ${z.district}, ${z.state}  ·  **Road class:** ${z.roadClass}`,
    `**Hazard level:** L${z.hazardLevel} (${LEVEL_NAMES[z.hazardLevel]})  ·  **P(event ≤24h):** ${(z.prob24h * 100).toFixed(1)}%`,
    `**Population:** ${z.population.toLocaleString("en-IN")}  ·  **Road length:** ${z.roadKm} km`,
    ``,
    `## Risk drivers`,
    drv,
    ``,
    `## Hydromet now`,
    `- Rainfall: ${z.rainIntensity} mm/h now, ${z.rain24h} mm/24h, antecedent ${z.antecedent} mm (7d)`,
    `- Soil moisture: ${Math.round(z.soilMoisture)}% VWC`,
    `- Deformation (PSInSAR): ${z.creepMmYear} mm/yr${z.creepMmYear > 20 ? " — ACTIVE CREEP CLUSTER" : ""}`,
    ``,
    `## Field reports (near zone)`,
    store.reports
      .filter((r) => r.zone_id === z.id)
      .slice(0, 4)
      .map((r) => `- [${r.status}] ${r.type}: ${r.note}`)
      .join("\n") || "- none in the last window",
    ``,
    `## Connectivity`,
    blocked.length
      ? blocked.map((r) => `- BLOCKED: ${r.name} — A* detour active`).join("\n")
      : "- all road links open",
    ``,
    `_Generated by BhuRakshak risk engine · SIH 26001 · ${new Date().toISOString()}_`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------- backtest
export async function backtest() {
  const candidates = [
    path.join(process.cwd(), "demo", "backtest_fixture.json"),
    path.join(process.cwd(), "repo", "demo", "backtest_fixture.json"),
  ];
  for (const p of candidates) {
    try {
      const txt = await fs.readFile(p, "utf8");
      return { ok: true, ...JSON.parse(txt) };
    } catch { /* try next */ }
  }
  return { ok: false, note: "backtest fixture missing — run `make data` in the repo" };
}
