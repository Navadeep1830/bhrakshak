/**
 * BhuRakshak hex response-zone grid generator — TS port.
 * Pointy-top hexes, ~5 km flat-to-flat, clipped to district boundaries.
 * Grid construction guarantees non-overlapping hexagons.
 * Uses a seeded hash for deterministic, reproducible susceptibility.
 */

import { createHash } from 'crypto';

export const HEX_R_KM = 3.0; // circumradius; width = sqrt(3)*R ≈ 5.2 km

export interface DistrictFeature {
  district: string;
  state: string;
  code: string;
  ring: Array<[number, number]>; // [lon, lat]
}

export interface HexZone {
  zoneCode: string;
  name: string;
  district: string;
  state: string;
  ring: Array<[number, number]>; // [lon, lat]
  centroidLat: number;
  centroidLon: number;
  suscMean: number;
  suscP90: number;
  population: number;
  roadKm: number;
  criticalInfra: { schools: number; phcs: number; bridges: number };
}

export function sha256Int(s: string): number {
  return parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
}

export function stableSusc(zoneCode: string): [number, number] {
  const h = sha256Int(zoneCode);
  const mean = 35 + (h % 60); // 35..94
  const p90 = Math.min(99, mean + 5 + ((h >> 8) % 10));
  return [Math.round(mean * 10) / 10, Math.round(p90 * 10) / 10];
}

function pointInRing(lon: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function hexVertices(cxKm: number, cyKm: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < 6; k++) {
    const ang = Math.PI / 6 + (k * Math.PI) / 3;
    out.push([cxKm + r * Math.cos(ang), cyKm + r * Math.sin(ang)]);
  }
  return out;
}

function kmToDegFactors(lat: number): [number, number] {
  const dlat = 1 / 110.574;
  const dlon = 1 / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
  return [dlat, dlon];
}

/** Generate ~5 km hexes over the district bbox; keep hexes meaningfully inside. */
export function hexGridForDistrict(feat: DistrictFeature): Array<{ ring: Array<[number, number]>; centroid: [number, number] }> {
  const lons = feat.ring.map((p) => p[0]);
  const lats = feat.ring.map((p) => p[1]);
  const minx = Math.min(...lons);
  const maxx = Math.max(...lons);
  const miny = Math.min(...lats);
  const maxy = Math.max(...lats);
  const lat0 = (miny + maxy) / 2;
  const [dlat, dlon] = kmToDegFactors(lat0);
  const dx = Math.sqrt(3) * HEX_R_KM; // column spacing
  const dy = 1.5 * HEX_R_KM; // row spacing

  const cols = Math.floor((maxx - minx) / (dx * dlon)) + 3;
  const rows = Math.floor((maxy - miny) / (dy * dlat)) + 3;
  const originX = minx - dx * dlon;
  const originY = miny - dy * dlat;

  const kept: Array<{ ring: Array<[number, number]>; centroid: [number, number] }> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = originX + col * dx * dlon + (dx / 2) * dlon * (row % 2);
      const cy = originY + row * dy * dlat;
      const vertsKm = hexVertices(0, 0, HEX_R_KM);
      const ring = vertsKm.map(([vx, vy]) => [cx + vx * dlon, cy + vy * dlat] as [number, number]);
      const centroid: [number, number] = [cx, cy];
      if (!pointInRing(centroid[0], centroid[1], feat.ring)) {
        // fraction-inside test: sample 6 vertices + centroid
        let inside = 0;
        for (const [vx, vy] of [...ring, centroid]) {
          if (pointInRing(vx, vy, feat.ring)) inside++;
        }
        if (inside / 7 < 0.25) continue; // <25% area inside → drop
      }
      kept.push({ ring, centroid });
    }
  }
  return kept;
}

export function buildZones(features: DistrictFeature[]): HexZone[] {
  const zones: HexZone[] = [];
  for (const feat of features) {
    const hexes = hexGridForDistrict(feat);
    // sort north→south, west→east for stable zone numbering
    const sorted = [...hexes].sort((a, b) => b.centroid[1] - a.centroid[1] || a.centroid[0] - b.centroid[0]);
    sorted.forEach((hex, idx) => {
      const code = `${feat.code}-${String(idx + 1).padStart(3, '0')}`;
      const [suscMean, suscP90] = stableSusc(code);
      const hh = sha256Int(code);
      zones.push({
        zoneCode: code,
        name: `${feat.district} Zone ${idx + 1}`,
        district: feat.district,
        state: feat.state,
        ring: hex.ring,
        centroidLat: hex.centroid[1],
        centroidLon: hex.centroid[0],
        suscMean,
        suscP90,
        population: 800 + (hh % 14000),
        roadKm: Math.round((2 + (hh % 180) / 10) * 10) / 10,
        criticalInfra: { schools: hh % 3, phcs: hh % 2, bridges: hh % 2 },
      });
    });
  }
  return zones;
}

// The 5 pilot districts (approximate demo boundaries, same as reference)
export const PILOT_DISTRICTS: DistrictFeature[] = [
  {
    district: 'Aizawl',
    state: 'Mizoram',
    code: 'MZ-AIZ',
    ring: [
      [92.55, 23.45], [92.75, 23.4], [93.0, 23.5], [93.1, 23.7],
      [93.0, 23.95], [92.8, 24.05], [92.6, 23.95], [92.5, 23.75], [92.55, 23.45],
    ],
  },
  {
    district: 'East Khasi Hills',
    state: 'Meghalaya',
    code: 'ML-EKH',
    ring: [
      [91.25, 25.05], [91.55, 25.0], [91.8, 25.1], [92.0, 25.35],
      [91.95, 25.65], [91.75, 25.8], [91.45, 25.75], [91.25, 25.5],
      [91.2, 25.25], [91.25, 25.05],
    ],
  },
  {
    district: 'Noney',
    state: 'Manipur',
    code: 'MN-NON',
    ring: [
      [93.55, 24.85], [93.8, 24.8], [94.0, 24.9], [94.05, 25.1],
      [93.9, 25.25], [93.7, 25.2], [93.55, 25.05], [93.5, 24.95], [93.55, 24.85],
    ],
  },
  {
    district: 'Imphal West',
    state: 'Manipur',
    code: 'MN-IMP',
    ring: [
      [93.78, 24.66], [93.98, 24.68], [94.08, 24.82], [94.02, 24.98],
      [93.88, 25.02], [93.76, 24.92], [93.72, 24.78], [93.78, 24.66],
    ],
  },
  {
    district: 'Gangtok',
    state: 'Sikkim',
    code: 'SK-GNG',
    ring: [
      [88.35, 27.25], [88.5, 27.2], [88.65, 27.3], [88.7, 27.5],
      [88.6, 27.65], [88.45, 27.62], [88.35, 27.45], [88.32, 27.35], [88.35, 27.25],
    ],
  },
];
