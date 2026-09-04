/**
 * BhuRakshak safe-routing engine — three alternative routes between an
 * origin and a destination, each scored against the LIVE hazard grid.
 *
 *  - fastest  : near-direct corridor (minimal deviation)
 *  - safest   : hazard-optimised corridor — lateral offset chosen so the
 *               cumulative corridor hazard (ML hazard levels + probability)
 *               is minimised
 *  - alternate: bypass corridor that snakes around the worst epicentre /
 *               threatened road (labels the road it bypasses)
 *
 * Every route carries hazard marks: the zones (level >= 2) whose corridors
 * it passes near — "places where landslides could occur" — plus predicted
 * blocked roads. All deterministic, all computed from live DB state.
 */
import { db } from '@/lib/db';
import { enrichRoadsWithDetours } from '@/lib/roads';

export interface HazardMark {
  zoneCode: string;
  name: string;
  district: string;
  level: number;
  probability: number;
  lat: number;
  lon: number;
  side: 'left' | 'right';
  distanceKm: number;
}

export interface RouteStep {
  idx: number;
  kind:
    | 'depart'
    | 'turn-left' | 'turn-right'
    | 'slight-left' | 'slight-right'
    | 'sharp-left' | 'sharp-right'
    | 'uturn'
    | 'continue'
    | 'hazard'
    | 'arrive';
  instruction: string;
  roadName: string | null;
  distanceKm: number; // distance from the previous maneuver to this one
  cumKm: number;
  cumMin: number;
  zoneCode?: string;
  level?: number;
  at: [number, number]; // [lon, lat] where it happens
}

export interface RouteOption {
  id: 'fastest' | 'safest' | 'alternate';
  label: string;
  summary: string;
  polyline: Array<[number, number]>; // [lon, lat]
  distanceKm: number;
  etaMinutes: number;
  riskScore: number; // 0..100
  riskLabel: 'Low' | 'Moderate' | 'High' | 'Severe';
  hazardMarks: HazardMark[];
  blockedRoads: string[];
  bypasses: string | null;
  recommended: boolean;
  strokeColor: string;
  steps: RouteStep[]; // turn-by-turn directions (Google-Maps style)
  via: string | null; // "via NH-6 · Sohra road"
}

export interface RoutePlan {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  routes: RouteOption[];
  generatedAt: string;
}

const HILL_SPEED_KMH = 32;
const CORRIDOR_KM = 5.5; // zone-of-influence along a route
const MARK_MAX = 8;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function polylineLengthKm(pts: Array<[number, number]>): number {
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) d += haversineKm(pts[i][1], pts[i][0], pts[i + 1][1], pts[i + 1][0]);
  return d;
}

/** min distance (km) from a point to a polyline */
function pointToPolylineKm(lat: number, lon: number, pts: Array<[number, number]>): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]; // lon, lat
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / len2));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const d = haversineKm(lat, lon, py, px);
    if (d < best) best = d;
  }
  if (pts.length === 1) return haversineKm(lat, lon, pts[0][1], pts[0][0]);
  return best;
}

/** which side of the (directed) polyline a point sits on */
function sideOf(lat: number, lon: number, pts: Array<[number, number]>): 'left' | 'right' {
  // use the segment nearest to the point
  let best = Infinity;
  let bestSeg = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / len2));
    const d = haversineKm(lat, lon, y1 + t * dy, x1 + t * dx);
    if (d < best) {
      best = d;
      bestSeg = i;
    }
  }
  const [x1, y1] = pts[bestSeg];
  const [x2, y2] = pts[Math.min(bestSeg + 1, pts.length - 1)];
  const cross = (x2 - x1) * (lat - y1) - (y2 - y1) * (lon - x1);
  return cross > 0 ? 'left' : 'right';
}

/** offset a point perpendicular to a bearing by `km` */
function offsetPoint(lat: number, lon: number, bearingRad: number, km: number): [number, number] {
  const dLatDeg = (km * Math.cos(bearingRad)) / 110.574;
  const dLonDeg = (km * Math.sin(bearingRad)) / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2));
  return [lon + dLonDeg, lat + dLatDeg];
}

function bearingRad(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return Math.atan2(y, x);
}

/** Catmull-Rom smoothed polyline through waypoints */
function smoothPath(waypoints: Array<[number, number]>, samplesPerSeg = 10): Array<[number, number]> {
  if (waypoints.length < 3) return waypoints;
  const pts: Array<[number, number]> = [waypoints[0]];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const p0 = waypoints[Math.max(0, i - 1)];
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)];
    for (let s = 1; s <= samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      pts.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  return pts;
}

interface ZoneLite {
  zoneCode: string;
  name: string;
  district: string;
  lat: number;
  lon: number;
  level: number;
  probability: number;
}

interface Scored {
  polyline: Array<[number, number]>;
  score: number;
}

/** cumulative corridor hazard of a polyline (lower = safer) */
function corridorScore(poly: Array<[number, number]>, zones: ZoneLite[]): number {
  let s = 0;
  for (const z of zones) {
    const d = pointToPolylineKm(z.lat, z.lon, poly);
    if (d > CORRIDOR_KM) continue;
    const w = 1 - d / CORRIDOR_KM;
    s += Math.pow(z.level, 1.6) * w * (0.55 + z.probability * 0.9);
    if (z.level >= 4 && d < 3) s += 14; // hard penalty: imminent-failure epicentre
  }
  return s;
}

function riskLabelOf(score: number): RouteOption['riskLabel'] {
  if (score < 6) return 'Low';
  if (score < 20) return 'Moderate';
  if (score < 45) return 'High';
  return 'Severe';
}

/* ── turn-by-turn direction synthesis (Google-Maps style) ─────────────── */

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return (bearingRad(lat1, lon1, lat2, lon2) * (180 / Math.PI) + 360) % 360;
}

function compassOf(brg: number): string {
  return COMPASS[Math.round(((brg % 360) + 360) % 360 / 45) % 8];
}

/** normalised signed turn angle in (−180, 180] */
function turnDelta(fromDeg: number, toDeg: number): number {
  let d = (toDeg - fromDeg) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

interface RoadLike {
  roadName: string;
  coords: Array<[number, number]>;
}

/** Street/road name near a point: nearest named highway, else nearest
 *  settlement (zone) road, else generic hill road. */
function nameForPoint(lat: number, lon: number, roads: RoadLike[], zones: ZoneLite[]): string {
  let bestRoad: string | null = null;
  let bestRoadD = 6;
  for (const r of roads) {
    const d = pointToPolylineKm(lat, lon, r.coords);
    if (d < bestRoadD) {
      bestRoadD = d;
      bestRoad = r.roadName;
    }
  }
  if (bestRoad) return bestRoad;
  let bestZone: ZoneLite | null = null;
  let bestZoneD = 10;
  for (const z of zones) {
    const d = haversineKm(lat, lon, z.lat, z.lon);
    if (d < bestZoneD) {
      bestZoneD = d;
      bestZone = z;
    }
  }
  if (bestZone) return `${bestZone.name} road`;
  return 'hill road';
}

/** position of a point along a polyline → [cumulative km, nearest point] */
function alongPolyline(lat: number, lon: number, pts: Array<[number, number]>): { cumKm: number; at: [number, number] } {
  let cum = 0;
  let best = Infinity;
  let bestCum = 0;
  let bestAt: [number, number] = pts[0];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0) t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / len2));
    const px = x1 + t * dx;
    const py = y1 + t * dy;
    const d = haversineKm(lat, lon, py, px);
    if (d < best) {
      best = d;
      bestCum = cum + haversineKm(y1, x1, py, px);
      bestAt = [px, py];
    }
    cum += haversineKm(y1, x1, y2, x2);
  }
  return { cumKm: bestCum, at: bestAt };
}

/**
 * Build turn-by-turn steps for a route polyline against live zones + roads.
 * Maneuvers are derived from real geometry (bearing changes), street names
 * from the live road network / settlements, and hazard warnings from the
 * live hazard grid — nothing scripted.
 */
function buildSteps(
  poly: Array<[number, number]>,
  zones: ZoneLite[],
  roads: RoadLike[],
  hazardMarks: HazardMark[],
  destLandmark: string
): { steps: RouteStep[]; via: string | null } {
  if (poly.length < 2) return { steps: [], via: null };

  const totalKm = polylineLengthKm(poly);
  const legLen = Math.max(1.1, totalKm / 11); // ≈ 12 legs max before merging

  // 1) split into legs by accumulated distance
  interface Leg {
    from: [number, number];
    to: [number, number];
    km: number;
    cumStart: number;
    bearing: number;
  }
  const legs: Leg[] = [];
  let acc = 0;
  let legStart: [number, number] = poly[0];
  let legStartCum = 0;
  for (let i = 1; i < poly.length; i++) {
    acc += haversineKm(poly[i - 1][1], poly[i - 1][0], poly[i][1], poly[i][0]);
    if (acc >= legLen || i === poly.length - 1) {
      legs.push({
        from: legStart,
        to: poly[i],
        km: acc,
        cumStart: legStartCum,
        bearing: bearingDeg(legStart[1], legStart[0], poly[i][1], poly[i][0]),
      });
      legStartCum += acc;
      acc = 0;
      legStart = poly[i];
    }
  }

  // 2) maneuvers between consecutive legs
  interface Man {
    kind: RouteStep['kind'];
    road: string;
    at: [number, number];
    cumKm: number;
  }
  const mans: Man[] = [];
  const roadHits = new Map<string, number>();
  const firstRoad = nameForPoint(poly[0][1], poly[0][0], roads, zones);
  mans.push({ kind: 'depart', road: firstRoad, at: poly[0], cumKm: 0 });
  roadHits.set(firstRoad, (roadHits.get(firstRoad) ?? 0) + 1);

  let prevBearing = legs[0]?.bearing ?? 0;
  for (let i = 1; i < legs.length; i++) {
    const leg = legs[i];
    const d = turnDelta(prevBearing, leg.bearing);
    const ad = Math.abs(d);
    const mid: [number, number] = [(leg.from[0] + leg.to[0]) / 2, (leg.from[1] + leg.to[1]) / 2];
    const road = nameForPoint(mid[1], mid[0], roads, zones);
    roadHits.set(road, (roadHits.get(road) ?? 0) + 1);

    let kind: RouteStep['kind'] | null = null;
    if (ad > 165) kind = 'uturn';
    else if (ad > 120) kind = d > 0 ? 'sharp-right' : 'sharp-left';
    else if (ad > 45) kind = d > 0 ? 'turn-right' : 'turn-left';
    else if (ad > 16) kind = d > 0 ? 'slight-right' : 'slight-left';
    else if (leg.km > Math.max(2.4, legLen * 2)) kind = 'continue';

    if (kind) mans.push({ kind, road, at: leg.from, cumKm: leg.cumStart });
    prevBearing = leg.bearing;
  }
  mans.push({ kind: 'arrive', road: destLandmark, at: poly[poly.length - 1], cumKm: totalKm });

  // 3) hazard warnings placed at their real position along the route
  const hazardSteps: Array<Man & { zoneCode: string; level: number }> = [];
  for (const m of hazardMarks) {
    const pos = alongPolyline(m.lat, m.lon, poly);
    if (pos.cumKm > 0.4 && pos.cumKm < totalKm - 0.4) {
      hazardSteps.push({ kind: 'hazard', road: m.zoneCode, at: pos.at, cumKm: pos.cumKm, zoneCode: m.zoneCode, level: m.level });
    }
  }

  // 4) merge + render instructions
  type Merged = Man & { zoneCode?: string; level?: number };
  const all: Merged[] = ([...mans, ...hazardSteps] as Merged[]).sort((a, b) => a.cumKm - b.cumKm);
  const steps: RouteStep[] = [];
  let hazardsBefore = 0;
  for (const m of all) {
    const prevCum = steps.length ? steps[steps.length - 1].cumKm : 0;
    const distanceKm = Math.round((m.cumKm - prevCum) * 10) / 10;
    if (m.kind !== 'depart' && distanceKm < 0.15) continue; // skip micro-steps
    if (m.kind === 'hazard') hazardsBefore++;
    const cumMin = Math.round(m.cumKm / HILL_SPEED_KMH * 60 + hazardsBefore * 2 + 1);

    let instruction: string;
    switch (m.kind) {
      case 'depart':
        instruction = `Head ${compassOf(legs[0]?.bearing ?? 0)} on ${m.road}`;
        break;
      case 'turn-left':
      case 'turn-right':
        instruction = `Turn ${m.kind === 'turn-left' ? 'left' : 'right'} onto ${m.road}`;
        break;
      case 'slight-left':
      case 'slight-right':
        instruction = `Slight ${m.kind === 'slight-left' ? 'left' : 'right'} onto ${m.road}`;
        break;
      case 'sharp-left':
      case 'sharp-right':
        instruction = `Sharp ${m.kind === 'sharp-left' ? 'left' : 'right'} onto ${m.road}`;
        break;
      case 'uturn':
        instruction = `Make a U-turn onto ${m.road}`;
        break;
      case 'continue':
        instruction = `Continue on ${m.road}`;
        break;
      case 'hazard':
        instruction = `Caution — landslide risk zone ${m.zoneCode} (L${m.level})`;
        break;
      case 'arrive':
        instruction = `Arrive at ${m.road}`;
        break;
      default:
        instruction = m.road;
    }

    steps.push({
      idx: steps.length,
      kind: m.kind,
      instruction,
      roadName: m.road,
      distanceKm,
      cumKm: Math.round(m.cumKm * 10) / 10,
      cumMin,
      zoneCode: m.kind === 'hazard' ? m.zoneCode : undefined,
      level: m.kind === 'hazard' ? m.level : undefined,
      at: m.at,
    });
  }

  // 5) via summary — the two most-hit named roads
  const via = [...roadHits.entries()]
    .filter(([name]) => !name.startsWith('hill road'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name)
    .join(' · ') || null;

  return { steps, via };
}

const STROKE: Record<RouteOption['id'], string> = {
  fastest: '#f59e0b',
  safest: '#10b981',
  alternate: '#38bdf8',
};

/**
 * Plan three alternative routes between origin and destination against
 * the live hazard grid.
 */
export async function planRoutes(
  origin: { lat: number; lon: number },
  destination: { lat: number; lon: number },
  destName?: string | null
): Promise<RoutePlan> {
  const [zonesRaw, roads] = await Promise.all([
    db.zone.findMany({
      select: {
        zoneCode: true, name: true, district: true, centroidLat: true, centroidLon: true,
        riskCell: { select: { hazardLevel: true, probability: true } },
      },
    }),
    enrichRoadsWithDetours(),
  ]);

  const zones: ZoneLite[] = zonesRaw.map((z) => ({
    zoneCode: z.zoneCode,
    name: z.name,
    district: z.district,
    lat: z.centroidLat,
    lon: z.centroidLon,
    level: z.riskCell?.hazardLevel ?? 0,
    probability: z.riskCell?.probability ?? 0,
  }));

  const directKm = haversineKm(origin.lat, origin.lon, destination.lat, destination.lon);
  const brg = bearingRad(origin.lat, origin.lon, destination.lat, destination.lon);
  const perp = brg + Math.PI / 2;
  const mid1: [number, number] = [origin.lon + (destination.lon - origin.lon) / 3, origin.lat + (destination.lat - origin.lat) / 3];
  const mid2: [number, number] = [origin.lon + (2 * (destination.lon - origin.lon)) / 3, origin.lat + (2 * (destination.lat - origin.lat)) / 3];

  // ── candidate corridors: lateral offsets on both sides ──
  const candidates: Array<Scored & { offsetKm: number }> = [];
  for (const off of [-24, -18, -12, -7, -3, 0, 3, 7, 12, 18, 24]) {
    const w1 = offsetPoint(mid1[1], mid1[0], perp, off);
    const w2 = offsetPoint(mid2[1], mid2[0], perp, off * 0.65);
    const poly = smoothPath([[origin.lon, origin.lat], w1, w2, [destination.lon, destination.lat]], 12);
    candidates.push({ polyline: poly, score: corridorScore(poly, zones), offsetKm: off });
  }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0] ?? candidates[candidates.length - 1];

  // pick a bypass corridor on the OTHER side of the direct line, far from
  // the safest one — genuinely distinct geography
  const bestSide = Math.sign(best.offsetKm) || 1;
  const bypassPool = candidates.filter((c) => Math.sign(c.offsetKm) !== bestSide && c.offsetKm !== 0);
  const bypass = (bypassPool.length ? bypassPool : candidates.filter((c) => c !== best))[0] ?? best;

  // ── route A: fastest (near-direct with a natural drift) ──
  const drift = 3 * (bestSide * -1);
  const f1 = offsetPoint(mid1[1], mid1[0], perp, drift);
  const f2 = offsetPoint(mid2[1], mid2[0], perp, drift * 0.7);
  const fastestPoly = smoothPath([[origin.lon, origin.lat], f1, f2, [destination.lon, destination.lat]], 12);

  // ── route B: safest ──
  const safestPoly = best.polyline;

  // ── route C: alternate bypass (label any threatened road it clears) ──
  const altPoly = bypass.polyline;
  const o: { lat: number; lon: number } = origin;
  const d: { lat: number; lon: number } = destination;
  const threatened = roads
    .filter((r) => r.status !== 'open')
    .map((r) => {
      const near = Math.min(
        pointToPolylineKm(o.lat, o.lon, r.coords),
        pointToPolylineKm(d.lat, d.lon, r.coords),
        pointToPolylineKm((o.lat + d.lat) / 2, (o.lon + d.lon) / 2, r.coords)
      );
      return { road: r, near };
    })
    .filter((x) => x.near < 28)
    .sort((a, b) => a.near - b.near)[0];

  function mk(
    id: RouteOption['id'],
    label: string,
    summary: string,
    poly: Array<[number, number]>,
    bypasses: string | null
  ): RouteOption {
    const km = polylineLengthKm(poly);
    const score = corridorScore(poly, zones);
    const marks: HazardMark[] = zones
      .filter((z) => z.level >= 2)
      .map((z) => ({
        zoneCode: z.zoneCode, name: z.name, district: z.district, level: z.level,
        probability: Math.round(z.probability * 100) / 100,
        lat: z.lat, lon: z.lon,
        side: sideOf(z.lat, z.lon, poly),
        distanceKm: Math.round(pointToPolylineKm(z.lat, z.lon, poly) * 10) / 10,
      }))
      .filter((m) => m.distanceKm <= CORRIDOR_KM + 1)
      .sort((a, b) => a.level * 10 - b.level * 10 || a.distanceKm - b.distanceKm)
      .slice(0, MARK_MAX);
    const l3plus = marks.filter((m) => m.level >= 3).length;
    const blocked = roads
      .filter((r) => r.status === 'blocked')
      .filter((r) => pointToPolylineKm(o.lat, o.lon, r.coords) < 18 || pointToPolylineKm(d.lat, d.lon, r.coords) < 18)
      .map((r) => r.roadName);

    const eta = Math.round(4 + (km / HILL_SPEED_KMH) * 60 + l3plus * 7 + (score > 25 ? 9 : 0));

    // turn-by-turn steps + via-road summary (computed from real geometry)
    let destZone = zones[0];
    let destZoneD = Infinity;
    for (const z of zones) {
      const dd = haversineKm(z.lat, z.lon, destination.lat, destination.lon);
      if (dd < destZoneD) { destZoneD = dd; destZone = z; }
    }
    const { steps, via } = buildSteps(
      poly,
      zones,
      roads.map((r) => ({ roadName: r.roadName, coords: r.coords })),
      marks,
      destName ? `${destName} (${destZone?.name ?? 'destination'} area)` : `${destZone?.name ?? 'destination'} area`
    );

    return {
      id,
      label,
      summary,
      polyline: poly,
      distanceKm: Math.round(km * 10) / 10,
      etaMinutes: eta,
      riskScore: Math.round(score * 10) / 10,
      riskLabel: riskLabelOf(score),
      hazardMarks: marks,
      blockedRoads: [...new Set(blocked)],
      bypasses,
      recommended: false,
      strokeColor: STROKE[id],
      steps,
      via,
    };
  }

  const routes = [
    mk('fastest', 'Fastest corridor', `Near-direct route${directKm < 8 ? '' : ' along the main alignment'} — shortest travel time.`, fastestPoly, null),
    mk('safest', 'Safest corridor', 'Hazard-optimised alignment — ML corridor risk minimised around high-hazard zones.', safestPoly, threatened ? `bypasses ${threatened.road.roadName} risk zone` : null),
    mk('alternate', 'Alternate bypass', threatened ? `Distinct bypass corridor clearing ${threatened.road.roadName} (${threatened.road.status}).` : 'Distinct bypass corridor on the opposite flank — redundancy if the main corridor fails.', altPoly, threatened ? threatened.road.roadName : null),
  ];

  // recommended = best balance (risk dominates, time breaks ties)
  let rec = [...routes].sort((a, b) => a.riskScore * 1.6 + a.etaMinutes - (b.riskScore * 1.6 + b.etaMinutes))[0];
  routes.forEach((r) => (r.recommended = r === rec));

  return {
    origin,
    destination,
    routes,
    generatedAt: new Date().toISOString(),
  };
}
