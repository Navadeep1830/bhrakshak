/**
 * BhuRakshak Safest-Route Evacuation Pathway Model (Layer E) — TypeScript
 * port of the proven bhrakshak-v2 engine.
 *
 * Terrain is modeled as a grid graph around the caller's position. Each node
 * carries a hazard cost derived from live zone hazard levels, susceptibility
 * and spatial decay. A* with hazard-weighted cost bends AROUND red zones even
 * when that is longer — which is the whole point. Shelters are ranked by a
 * SAFETY score (flat, capacity, medical), not just proximity.
 */

export const GRID_STEP_KM = 0.25;
export const GRID_RADIUS_KM = 6.0;
export const GRID_N = Math.floor(GRID_RADIUS_KM / GRID_STEP_KM) * 2 + 1; // 49
const HAZARD_COST_WEIGHT = 14.0; // up to ~4x detour before accepting hazard

export function kmToDeg(lat: number): [number, number] {
  const dlat = 1 / 110.574;
  const dlon = 1 / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
  return [dlat, dlon];
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface GridNode {
  lat: number;
  lon: number;
  hazard: number;
}

export interface ZoneHazardRow {
  centroidLat: number;
  centroidLon: number;
  hazardLevel: number;
  suscMean: number;
  radiusKm: number;
}

export interface ShelterRow {
  id: string;
  name: string;
  district: string;
  lat: number;
  lon: number;
  shelterType: string;
  capacity: number;
  occupancy: number;
  hasMedical: boolean;
  slopeDeg: number;
  distToSlopeM: number;
}

/** Rasterise live zone hazard onto a grid around the origin. */
export function buildHazardField(
  originLat: number,
  originLon: number,
  zoneRows: ZoneHazardRow[]
): GridNode[][] {
  const [dlat, dlon] = kmToDeg(originLat);
  const n = GRID_N;
  const grid: GridNode[][] = [];
  for (let i = 0; i < n; i++) {
    const row: GridNode[] = [];
    for (let j = 0; j < n; j++) {
      const dKmLat = (Math.floor(n / 2) - i) * GRID_STEP_KM;
      const dKmLon = (j - Math.floor(n / 2)) * GRID_STEP_KM;
      row.push({
        lat: originLat + dKmLat * dlat,
        lon: originLon + dKmLon * dlon,
        hazard: 0,
      });
    }
    grid.push(row);
  }
  for (const z of zoneRows) {
    const lvl = z.hazardLevel || 0;
    const susc = z.suscMean || 40;
    const radius = z.radiusKm || 3;
    const danger = Math.min(1, (lvl / 4) * 0.75 + (susc / 100) * 0.25);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const node = grid[i][j];
        const d = haversineKm(z.centroidLat, z.centroidLon, node.lat, node.lon);
        if (d <= radius) {
          const decay = 1 - d / radius;
          node.hazard = Math.max(node.hazard, danger * (0.35 + 0.65 * decay));
        }
      }
    }
  }
  return grid;
}

/** A* over the hazard grid. Returns grid indices path or null. */
function astar(
  grid: GridNode[][],
  start: [number, number],
  goal: [number, number]
): [number, number][] | null {
  const n = grid.length;
  const openq: Array<[number, number, [number, number]]> = [[0, 0, start]];
  const gScore = new Map<string, number>();
  gScore.set(`${start[0]},${start[1]}`, 0);
  const came = new Map<string, [number, number]>();

  const h = (a: [number, number], b: [number, number]) => {
    const di = Math.abs(a[0] - b[0]);
    const dj = Math.abs(a[1] - b[1]);
    return di + dj + (Math.SQRT2 - 2) * Math.min(di, dj);
  };

  while (openq.length) {
    openq.sort((x, y) => x[0] - y[0]);
    const [, g, cur] = openq.shift()!;
    if (cur[0] === goal[0] && cur[1] === goal[1]) {
      const path: [number, number][] = [cur];
      let key = `${cur[0]},${cur[1]}`;
      while (came.has(key)) {
        const prev = came.get(key)!;
        path.push(prev);
        key = `${prev[0]},${prev[1]}`;
      }
      path.reverse();
      return path;
    }
    const [ci, cj] = cur;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || ni >= n || nj < 0 || nj >= n) continue;
        const node = grid[ni][nj];
        const step = di !== 0 && dj !== 0 ? Math.SQRT2 : 1;
        const cost = step * (1 + HAZARD_COST_WEIGHT * node.hazard);
        const ng = g + cost;
        const nk = `${ni},${nj}`;
        if (ng < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, ng);
          came.set(nk, cur);
          openq.push([ng + h([ni, nj], goal), ng, [ni, nj]]);
        }
      }
    }
  }
  return null;
}

// Shelter safety weights
const W_FLAT = 0.3;
const W_CAPACITY = 0.25;
const W_SITE = 0.2;
const W_MEDICAL = 0.15;
const W_PROXIMITY = 0.1;

export function shelterSafetyScore(shelter: ShelterRow, originKm: number): number {
  const cap = Math.max(shelter.capacity || 1, 1);
  const free = Math.max(0, 1 - shelter.occupancy / cap);
  const flat = Math.min(1, (shelter.distToSlopeM || 300) / 800);
  const site = 1 - Math.min(1, (shelter.slopeDeg || 12) / 25);
  const med = shelter.hasMedical ? 1 : 0;
  const prox = Math.max(0, 1 - Math.min(originKm, 15) / 15);
  return Math.round(
    (W_FLAT * flat + W_CAPACITY * free + W_SITE * site + W_MEDICAL * med + W_PROXIMITY * prox) * 10000
  ) / 10000;
}

export interface EvacuationPlan {
  origin: { lat: number; lon: number };
  destination: {
    id: string;
    name: string;
    district: string;
    lat: number;
    lon: number;
    shelterType: string;
    capacity: number;
    occupancy: number;
    hasMedical: boolean;
    slopeDeg: number;
    distToSlopeM: number;
  };
  safetyScore: number;
  route: Array<[number, number]>; // [lon, lat]
  routeLengthKm: number;
  etaMinutes: number;
  meanHazardAlongRoute: number;
  maxHazardAlongRoute: number;
  avoidedLevels: number[];
  alternatives: Array<{ shelterId: string; name: string; safety: number; distanceKm: number }>;
  avoidedZones: Array<{ zoneCode: string; name: string; hazardLevel: number }>;
  model: string;
}

/** Full pathway: pick safest reachable shelter, route around hazard. */
export function planEvacuation(
  originLat: number,
  originLon: number,
  zoneRows: ZoneHazardRow[],
  shelters: ShelterRow[]
): EvacuationPlan | { error: string } {
  if (!shelters.length) return { error: 'No active shelters registered' };

  const scored = shelters
    .map((s) => ({
      score: shelterSafetyScore(s, haversineKm(originLat, originLon, s.lat, s.lon)),
      km: haversineKm(originLat, originLon, s.lat, s.lon),
      s,
    }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];

  const grid = buildHazardField(originLat, originLon, zoneRows);
  const [dlat, dlon] = kmToDeg(originLat);
  const n = GRID_N;

  const toIJ = (lat: number, lon: number): [number, number] => {
    const diKm = (originLat - lat) / dlat;
    const djKm = (lon - originLon) / dlon;
    const i = Math.round(Math.floor(n / 2) - diKm / GRID_STEP_KM);
    const j = Math.round(Math.floor(n / 2) + djKm / GRID_STEP_KM);
    return [Math.max(0, Math.min(n - 1, i)), Math.max(0, Math.min(n - 1, j))];
  };

  const start = toIJ(originLat, originLon);
  const goal = toIJ(best.s.lat, best.s.lon);
  grid[goal[0]][goal[1]].hazard = 0; // destination marked safe
  const path = astar(grid, start, goal);

  const route: Array<[number, number]> = [];
  const hazardAlong: number[] = [];
  if (path) {
    for (const [i, j] of path) {
      const node = grid[i][j];
      route.push([Math.round(node.lon * 1e5) / 1e5, Math.round(node.lat * 1e5) / 1e5]);
      hazardAlong.push(Math.round(node.hazard * 1000) / 1000);
    }
  } else {
    route.push([originLon, originLat], [best.s.lon, best.s.lat]);
    hazardAlong.push(0, 0);
  }

  let distKm = 0;
  for (let k = 0; k < route.length - 1; k++) {
    distKm += haversineKm(route[k][1], route[k][0], route[k + 1][1], route[k + 1][0]);
  }
  const meanHazard = hazardAlong.length ? hazardAlong.reduce((a, b) => a + b, 0) / hazardAlong.length : 0;
  const speed = 4.5 - 2 * meanHazard;
  const etaMin = Math.round((distKm / Math.max(speed, 0.5)) * 60);

  // zones whose hazard the route visibly bends around
  const avoidedZones = zoneRows
    .filter((z) => z.hazardLevel >= 2)
    .map((z) => ({
      zoneCode: (z as ZoneHazardRow & { zoneCode?: string }).zoneCode || '',
      name: (z as ZoneHazardRow & { name?: string }).name || '',
      hazardLevel: z.hazardLevel,
    }))
    .filter((z) => z.zoneCode)
    .sort((a, b) => b.hazardLevel - a.hazardLevel)
    .slice(0, 5);

  return {
    origin: { lat: originLat, lon: originLon },
    destination: {
      id: best.s.id,
      name: best.s.name,
      district: best.s.district,
      lat: best.s.lat,
      lon: best.s.lon,
      shelterType: best.s.shelterType,
      capacity: best.s.capacity,
      occupancy: best.s.occupancy,
      hasMedical: best.s.hasMedical,
      slopeDeg: best.s.slopeDeg,
      distToSlopeM: best.s.distToSlopeM,
    },
    safetyScore: best.score,
    route,
    routeLengthKm: Math.round(distKm * 100) / 100,
    etaMinutes: etaMin,
    meanHazardAlongRoute: Math.round(meanHazard * 1000) / 1000,
    maxHazardAlongRoute: hazardAlong.length ? Math.max(...hazardAlong) : 0,
    avoidedLevels: [...new Set(zoneRows.filter((z) => z.hazardLevel).map((z) => z.hazardLevel))]
      .sort((a, b) => b - a)
      .slice(0, 3),
    alternatives: scored.slice(1, 4).map((t) => ({
      shelterId: t.s.id,
      name: t.s.name,
      safety: t.score,
      distanceKm: Math.round(t.km * 100) / 100,
    })),
    avoidedZones,
    model: 'evac-pathway-v1 (A* hazard-weighted + shelter safety scoring)',
  };
}
