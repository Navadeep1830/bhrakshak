// Evacuation: shelter selection + hazard-avoiding safe route.
import type { Store, Zone } from "./store";
import { haversineKm } from "./rng";

export function sheltersOut(store: Store) {
  return store.shelters.map((s) => ({
    ...s,
    free: s.capacity - s.occupancy,
    utilization: +(s.occupancy / s.capacity).toFixed(2),
  }));
}

/**
 * Safe route: nearest shelter with free capacity, path penalised by
 * proximity to L3/L4 zone centres (control points offset away from them).
 */
export function safeRoute(store: Store, zoneCode: string) {
  const z = store.zones.find((x) => x.zone_code === zoneCode) ??
    store.zones.find((x) => x.id === zoneCode);
  if (!z) return null;

  const hot = store.zones.filter((x) => x.hazardLevel >= 3 && x.id !== z.id);
  const scored = store.shelters
    .map((s) => {
      const km = haversineKm(z.center, [s.lon, s.lat]);
      // penalty: 6 km added per hot zone within 5 km of the straight line
      let penalty = 0;
      for (const h of hot) {
        const d = pointSegDistKm(h.center, z.center, [s.lon, s.lat]);
        if (d < 5) penalty += (5 - d) * 1.2;
      }
      return { s, km: +km.toFixed(2), score: +(km + penalty).toFixed(2), penalty: +penalty.toFixed(1) };
    })
    .filter(({ s }) => s.occupancy < s.capacity)
    .sort((a, b) => a.score - b.score);

  const best = scored[0];
  if (!best) return { reachable: false as const, reason: "No shelter with free capacity" };
  const { s } = best;

  // route: straight line, but if it passes near a hot zone, bend around it
  const route: [number, number][] = [z.center];
  for (const h of hot) {
    const d = pointSegDistKm(h.center, z.center, [s.lon, s.lat]);
    if (d < 2.5) {
      // offset control point perpendicular, away from the hot centre
      const mx = (z.center[0] + s.lon) / 2;
      const my = (z.center[1] + s.lat) / 2;
      const dx = mx - h.center[0];
      const dy = my - h.center[1];
      const len = Math.hypot(dx, dy) || 1;
      route.push([+(mx + (dx / len) * 0.05).toFixed(4), +(my + (dy / len) * 0.05).toFixed(4)]);
    }
  }
  route.push([s.lon, s.lat]);

  return {
    reachable: true as const,
    from: { zone_code: z.zone_code, name: z.name, level: z.hazardLevel },
    shelter: {
      id: s.id, name: s.name, district: s.district,
      capacity: s.capacity, occupancy: s.occupancy, free: s.capacity - s.occupancy,
      has_medical: s.has_medical, water_l: s.water_l, ration_packets: s.ration_packets,
      slope_deg: s.slope_deg, distance_to_steep_slope_m: s.distance_to_steep_slope_m,
    },
    distance_km: best.km,
    hazard_penalty_km: best.penalty,
    eta_walk_min: Math.round(best.km * 13 + 12), // 4.5 km/h + assembly
    route,
    advisory:
      z.hazardLevel >= 3
        ? `L${z.hazardLevel} active — evacuate immediately, avoid the flagged slope section, keep to the upslope side of the road.`
        : `Precautionary route. Keep 10 m from cut slopes and stream channels.`,
  };
}

/** Distance (km) from point p to segment a-b. */
function pointSegDistKm(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const kx = (b[0] - a[0]) * 111 * Math.cos((a[1] * Math.PI) / 180);
  const ky = (b[1] - a[1]) * 111;
  const px = (p[0] - a[0]) * 111 * Math.cos((a[1] * Math.PI) / 180);
  const py = (p[1] - a[1]) * 111;
  const len2 = kx * kx + ky * ky || 1e-9;
  const t = Math.max(0, Math.min(1, (px * kx + py * ky) / len2));
  return Math.hypot(px - t * kx, py - t * ky);
}
