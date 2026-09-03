// Road network intelligence: status derivation, A* detours, clearance times.
import type { Store } from "./store";
import { haversineKm } from "./rng";

export type RoadStatus = "open" | "watch" | "blocked";

export function roadStatus(
  store: Store,
  road: { from_zone: string; to_zone: string; forcedBlocked: boolean },
): RoadStatus {
  if (road.forcedBlocked) return "blocked";
  const a = store.zones.find((z) => z.id === road.from_zone);
  const b = store.zones.find((z) => z.id === road.to_zone);
  const lvl = Math.max(a?.hazardLevel ?? 0, b?.hazardLevel ?? 0);
  if (lvl >= 4 || (lvl === 3 && (a?.prob24h ?? 0) > 0.8)) return "blocked";
  if (lvl === 3) return "watch";
  return "open";
}

export function roadsOut(store: Store) {
  return store.roads.map((r) => {
    const a = store.zones.find((z) => z.id === r.from_zone)!;
    const b = store.zones.find((z) => z.id === r.to_zone)!;
    return {
      id: r.id, name: r.name, km: r.km, cls: r.cls,
      from: a.zone_code, to: b.zone_code,
      from_name: a.name, to_name: b.name,
      district: a.district,
      status: roadStatus(store, r),
      cleared_eta_h: null as number | null,
    };
  });
}

/** A* (here: Dijkstra with straight-line heuristic) detour avoiding blocked segments. */
export function detour(store: Store, fromCode: string, toCode: string) {
  const adj = new Map<string, { to: string; km: number; status: RoadStatus; name: string; cls: string }[]>();
  for (const r of store.roads) {
    const a = store.zones.find((z) => z.id === r.from_zone)!;
    const b = store.zones.find((z) => z.id === r.to_zone)!;
    const st = roadStatus(store, r);
    const e = { to: b.zone_code, km: r.km, status: st, name: r.name, cls: r.cls };
    const e2 = { to: a.zone_code, km: r.km, status: st, name: r.name, cls: r.cls };
    if (!adj.has(a.zone_code)) adj.set(a.zone_code, []);
    if (!adj.has(b.zone_code)) adj.set(b.zone_code, []);
    adj.get(a.zone_code)!.push(e);
    adj.get(b.zone_code)!.push(e2);
  }
  const direct = store.roads.find((r) => {
    const a = store.zones.find((z) => z.id === r.from_zone);
    const b = store.zones.find((z) => z.id === r.to_zone);
    return (a?.zone_code === fromCode && b?.zone_code === toCode) ||
      (a?.zone_code === toCode && b?.zone_code === fromCode);
  });
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; km: number }>();
  const pq: [number, string][] = [[0, fromCode]];
  dist.set(fromCode, 0);
  while (pq.length) {
    pq.sort((x, y) => x[0] - y[0]);
    const [d, u] = pq.shift()!;
    if (d > (dist.get(u) ?? Infinity)) continue;
    if (u === toCode) break;
    for (const e of adj.get(u) ?? []) {
      if (e.status === "blocked") continue;
      const nd = d + e.km;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { node: u, km: e.km });
        pq.push([nd, e.to]);
      }
    }
  }
  if (!dist.has(toCode)) {
    return { reachable: false as const, reason: "No open route — zone fully isolated" };
  }
  const path: string[] = [toCode];
  let cur = toCode;
  while (cur !== fromCode) {
    const p = prev.get(cur)!;
    cur = p.node;
    path.unshift(cur);
  }
  const names = path.map((c) => {
    const z = store.zones.find((x) => x.zone_code === c);
    return z ? `${c} ${z.name}` : c;
  });
  const directKm = direct?.km ?? 0;
  const detourKm = dist.get(toCode)!;
  return {
    reachable: true as const,
    path,
    waypoints: names,
    direct_km: +directKm.toFixed(1),
    detour_km: +detourKm.toFixed(1),
    extra_km: +Math.max(0, detourKm - directKm).toFixed(1),
    eta_h: +(detourKm / 26 + 0.6).toFixed(1), // hill-road average speed
    blocked_segment: direct ? direct.name : null,
  };
}

/** Equipment-based clearance estimate for a blocked segment. */
export function clearance(store: Store, roadId: string) {
  const road = store.roads.find((r) => r.id === roadId);
  if (!road) return null;
  const a = store.zones.find((z) => z.id === road.from_zone)!;
  const b = store.zones.find((z) => z.id === road.to_zone)!;
  const lvl = Math.max(a.hazardLevel, b.hazardLevel);
  const severity = lvl >= 4 ? 3 : 2;
  const crews = 3; // JCB x2 + dozer x1 staged at district HQ
  const hours = Math.round((road.km * 0.9 + severity * 3.5) / Math.max(1, crews) + 2);
  return {
    road: road.name, id: road.id, km: road.km, cls: road.cls,
    severity, crews_available: crews,
    estimated_hours: hours,
    debris_m3: Math.round(road.km * severity * 420),
    rain_constraint: a.rainIntensity > 30 || b.rainIntensity > 30,
    advice:
      a.rainIntensity > 30 || b.rainIntensity > 30
        ? "Suspend dozer work while rainfall >30 mm/h (secondary failure risk)."
        : "Clearance can proceed — monitor slope seepage at cut face.",
  };
}
