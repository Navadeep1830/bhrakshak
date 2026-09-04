/**
 * BhuRakshak road corridor intelligence — Layer D service.
 *
 * For each road segment we compute the live corridor hazard (max hazard level
 * of response zones within corridor distance of the road), escalate the road
 * status when the fused engine predicts blockage, and synthesise a bypass
 * (alternative route) polyline that bows around the highest-hazard epicentre.
 *
 * Everything is deterministic (jitter derived from a string hash), so the demo
 * is repeatable.
 */
import { db } from '@/lib/db';

export interface DetourInfo {
  available: boolean;
  reason: string;
  polyline: Array<[number, number]>; // [lon, lat]
  extraKm: number;
  delayMinutes: number;
  clearanceEtaHours: number;
  corridorHazard: number;
  blockageAt: [number, number] | null; // [lon, lat]
}

export interface RoadRowOut {
  id: string;
  roadName: string;
  district: string;
  coords: Array<[number, number]>;
  status: string;
  source: string;
  note: string | null;
  updatedAt: Date;
  detour: DetourInfo | null;
}

const CORRIDOR_KM = 7.5; // zone-of-influence radius around a road
const BYPASS_KM = 9.0; // how far the alternative route bows out
const HILL_SPEED_KMH = 35; // hill-road average speed for delay estimates

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Deterministic hash → [0,1) for repeatable jitter. */
function prand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 10000) / 10000;
}

function polylineLengthKm(pts: Array<[number, number]>): number {
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    d += haversineKm(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0]);
  }
  return d;
}

/** Quadratic bezier sample — the visible bypass arc. */
function bezier(a: [number, number], c: [number, number], b: [number, number], steps = 14): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/**
 * Build the bypass polyline for a road whose corridor is threatened.
 * Strategy: find the vertex closest to the hazard epicentre, then replace the
 * epicentre-adjacent segment with a bezier arc that bows away from it.
 */
function buildBypass(
  coords: Array<[number, number]>,
  epicentre: [number, number],
  bypasKm: number
): Array<[number, number]> {
  if (coords.length < 2) return coords;
  // index of vertex nearest the epicentre
  let k = 0;
  let bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineKm(coords[i][1], coords[i][0], epicentre[1], epicentre[0]);
    if (d < bestD) {
      bestD = d;
      k = i;
    }
  }
  const a = coords[Math.max(0, k - 1)];
  const b = coords[Math.min(coords.length - 1, k + 1)];
  // midpoint of the cut segment
  const m: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // direction from epicentre through the midpoint (push the arc that way)
  const dlat = m[1] - epicentre[1];
  const dlon = m[0] - epicentre[0];
  const norm = Math.hypot(dlat, dlon) || 1e-6;
  const dLatDeg = bypasKm / 110.574;
  const dLonDeg = bypasKm / (111.32 * Math.max(Math.cos((m[1] * Math.PI) / 180), 0.2));
  const control: [number, number] = [
    epicentre[0] + (dlon / norm) * dLonDeg,
    epicentre[1] + (dlat / norm) * dLatDeg,
  ];
  const arc = bezier(a, control, b);
  const head = coords.slice(0, Math.max(0, k - 1) + 1);
  const tail = coords.slice(Math.min(coords.length - 1, k + 1));
  return [...head, ...arc.slice(1, -1), ...tail];
}

const CLEARANCE_H_BY_LEVEL: Record<number, number> = { 2: 5, 3: 10, 4: 16 };

/** Enrich every road row with live corridor hazard + detour plan. */
export async function enrichRoadsWithDetours(): Promise<RoadRowOut[]> {
  const [roads, zones] = await Promise.all([
    db.roadStatus.findMany({ orderBy: { roadName: 'asc' } }),
    db.zone.findMany({
      select: {
        zoneCode: true,
        name: true,
        district: true,
        centroidLat: true,
        centroidLon: true,
        suscMean: true,
        riskCell: { select: { hazardLevel: true } },
      },
    }),
  ]);

  const zoneRows = zones.map((z) => ({
    zoneCode: z.zoneCode,
    name: z.name,
    district: z.district,
    lat: z.centroidLat,
    lon: z.centroidLon,
    suscMean: z.suscMean,
    hazard: z.riskCell?.hazardLevel ?? 0,
  }));

  return roads.map((r) => {
    const coords = JSON.parse(r.coords) as Array<[number, number]>;
    const jitter = prand(r.id);

    // corridor = zones within CORRIDOR_KM of any vertex
    let corridorHazard = 0;
    let epicentre: { lat: number; lon: number; zoneCode: string; name: string } | null = null;
    let maxScore = -1;
    for (const z of zoneRows) {
      let near = false;
      let minD = Infinity;
      for (const v of coords) {
        const d = haversineKm(z.lat, z.lon, v[1], v[0]);
        if (d <= CORRIDOR_KM) near = true;
        if (d < minD) minD = d;
      }
      if (!near) continue;
      const score = z.hazard * 100 + minD; // prefer higher hazard, then closer
      if (z.hazard > corridorHazard) corridorHazard = z.hazard;
      if (score > maxScore) {
        maxScore = score;
        if (z.hazard >= 2) epicentre = { lat: z.lat, lon: z.lon, zoneCode: z.zoneCode, name: z.name };
      }
    }

    // live status escalation — the fused engine predicts blockage
    let status = r.status;
    let source = r.source;
    let note = r.note;
    const predicted =
      corridorHazard >= 4 || (corridorHazard === 3 && (epicentre?.zoneCode ? zoneRows.find((z) => z.zoneCode === epicentre!.zoneCode)!.suscMean : 0) >= 60);
    if (predicted && r.status !== 'blocked') {
      status = 'blocked';
      source = 'model';
      note = `ML predicts blockage — corridor hazard L${corridorHazard}${epicentre ? ` (${epicentre.zoneCode})` : ''}`;
    } else if (corridorHazard >= 2 && r.status === 'open') {
      status = 'watch';
      source = 'model';
      note = `Corridor under landslide watch — hazard L${corridorHazard}${epicentre ? ` (${epicentre.zoneCode})` : ''}`;
    }

    // detour synthesis for anything not fully open
    let detour: DetourInfo | null = null;
    if (status !== 'open' && coords.length >= 2) {
      const blockageAt: [number, number] | null =
        epicentre && (status === 'blocked' || corridorHazard >= 2)
          ? [epicentre.lon, epicentre.lat]
          : coords[Math.floor(coords.length / 2)];
      const epi = blockageAt ?? coords[Math.floor(coords.length / 2)];
      const bypass = buildBypass(coords, epi, BYPASS_KM);
      const originalKm = polylineLengthKm(coords);
      const detourKm = polylineLengthKm(bypass);
      const extraKm = Math.max(0.6, Math.round((detourKm - originalKm) * 10) / 10);
      const delayMinutes = Math.round((extraKm / HILL_SPEED_KMH) * 60) + 6 + Math.round(jitter * 8);
      const clearanceEtaHours = Math.round(
        ((CLEARANCE_H_BY_LEVEL[Math.max(corridorHazard, 2)] ?? 6) + jitter * 4) * 10
      ) / 10;
      const reason =
        status === 'blocked'
          ? epicentre
            ? `Landslide debris / slope failure risk at ${epicentre.zoneCode} (${epicentre.name}) — hazard L${corridorHazard}`
            : 'Reported blockage on this segment'
          : corridorHazard >= 2
            ? `Corridor hazard L${corridorHazard} — restricted passage, advisory detour`
            : 'Field advisory on this segment — restricted passage, advisory detour';
      detour = {
        available: true,
        reason,
        polyline: bypass,
        extraKm,
        delayMinutes,
        clearanceEtaHours,
        corridorHazard,
        blockageAt,
      };
    }

    return {
      id: r.id,
      roadName: r.roadName,
      district: r.district,
      coords,
      status,
      source,
      note,
      updatedAt: r.updatedAt,
      detour,
    };
  });
}
