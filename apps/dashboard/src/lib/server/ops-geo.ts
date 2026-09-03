// Ops overlay + rain radar GeoJSON for the demo API — everything the map
// paints is COMPUTED from world state (blocked roads → A* alternative
// routes, gauge intensity → radar cells), never hardcoded geometry.
// Corridor bypasses mirror the backend's calibrated CORRIDOR_PROFILES.
import type { Store, Zone } from "./store";
import { clearance, detour, roadStatus } from "./roads";

const zoneBy = (store: Store, id: string) => store.zones.find((z) => z.id === id);

// Pre-planned emergency bypasses for the three arterial corridors (same
// geometry the FastAPI backend serves from CORRIDOR_PROFILES).
const CORRIDOR_BYPASSES: {
  corridor: string;
  name: string;
  wps: [number, number][];
  delayMin: number;
  staging: string;
}[] = [
  {
    corridor: "NH-29",
    name: "NH-29 Emergency Bypass",
    wps: [[93.85, 25.75], [93.92, 25.62], [94.02, 25.64], [94.05, 25.68]],
    delayMin: 45,
    staging: "Medziphema PWD Heavy Depot KM 18",
  },
  {
    corridor: "NH-102",
    name: "NH-102 Emergency Bypass",
    wps: [[93.95, 24.78], [93.98, 24.62], [94.08, 24.45], [94.15, 24.38]],
    delayMin: 60,
    staging: "Pallel BRO Sector Base KM 42",
  },
  {
    corridor: "NH-6",
    name: "NH-6 Emergency Bypass",
    wps: [[91.88, 25.57], [92.20, 25.45], [92.70, 24.85]],
    delayMin: 95,
    staging: "Jowai PWD Mechanical Division",
  },
];

/**
 * Ops overlay: pre-planned corridor bypasses (always active — they are the
 * alternative paths), blockage points for currently-BLOCKED road segments
 * with clearance ETAs, A* detours around them, and one machinery staging
 * base per district (at the district's highest-population zone).
 */
export function opsGeojson(store: Store) {
  const features: any[] = [];
  const drawn: string[] = [];

  // --- arterial corridor bypasses (the alternative paths)
  for (const c of CORRIDOR_BYPASSES) {
    features.push({
      type: "Feature",
      properties: {
        type: "detour_route",
        name: c.name,
        corridor: c.corridor,
        delay: `+${c.delayMin} min`,
        staging: c.staging,
      },
      geometry: { type: "LineString", coordinates: c.wps },
    });
    // corridor staging base
    features.push({
      type: "Feature",
      properties: {
        type: "machinery_base",
        name: c.staging,
        corridor: c.corridor,
        jcb_count: c.corridor === "NH-102" ? 4 : 2,
      },
      geometry: { type: "Point", coordinates: c.wps[0] },
    });
  }

  // --- live blockages + A* detours around them
  for (const r of store.roads) {
    const a = zoneBy(store, r.from_zone);
    const b = zoneBy(store, r.to_zone);
    if (!a || !b) continue;
    if (roadStatus(store, r) !== "blocked") continue;
    const est = clearance(store, r.id);

    // blockage choke point at the segment midpoint
    features.push({
      type: "Feature",
      properties: {
        type: "blockage",
        name: `${r.name} — blocked`,
        corridor: r.cls,
        eta: `Clearance ETA: ${est?.estimated_hours ?? 6} h`,
        debris_m3: est?.debris_m3 ?? null,
        rain_constraint: est?.rain_constraint ?? false,
      },
      geometry: {
        type: "Point",
        coordinates: [+((a.center[0] + b.center[0]) / 2).toFixed(4), +((a.center[1] + b.center[1]) / 2).toFixed(4)],
      },
    });

    // A* alternative path around the blockage (only once per road)
    if (!drawn.includes(r.id)) {
      drawn.push(r.id);
      const d = detour(store, a.zone_code, b.zone_code);
      if (d && (d as { reachable: boolean }).reachable) {
        const dd = d as { path: string[]; extra_km: number; eta_h: number; direct_km: number; detour_km: number };
        const coords = dd.path.map((code) => {
          const z = store.zones.find((x) => x.zone_code === code);
          return z ? [z.center[0], z.center[1]] : null;
        }).filter((c): c is [number, number] => !!c);
        if (coords.length >= 2) {
          features.push({
            type: "Feature",
            properties: {
              type: "detour_route",
              name: `${r.name} Emergency Bypass`,
              corridor: r.cls,
              delay: `+${Math.round(dd.extra_km * 4 + 25)} min`,
              detour_km: dd.detour_km,
              direct_km: dd.direct_km,
            },
            geometry: { type: "LineString", coordinates: coords },
          });
        }
      }
    }
  }

  // --- machinery staging: one per district at the highest-population zone
  const anchor = new Map<string, Zone>();
  for (const z of store.zones) {
    const cur = anchor.get(z.district);
    if (!cur || z.population > cur.population) anchor.set(z.district, z);
  }
  for (const [district, z] of anchor) {
    features.push({
      type: "Feature",
      properties: {
        type: "machinery_base",
        name: `${district} PWD staging — 2 JCB + dozer`,
        corridor: z.roadClass,
        jcb_count: 2,
      },
      geometry: { type: "Point", coordinates: [z.center[0], z.center[1]] },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Rain radar cells from live gauge intensity (the demo storm ramps
 * rainIntensity, so injected storms visibly intensify the radar). Cells
 * are sized by intensity and labelled with the zone they sit over.
 */
export function radarGeojson(store: Store) {
  const hot = store.zones
    .filter((z) => z.rainIntensity >= 12)
    .sort((x, y) => y.rainIntensity - x.rainIntensity)
    .slice(0, 6);
  const cell = (z: Zone): any => {
    const w = 0.018 + z.rainIntensity * 0.0009;
    const h = w * 0.75;
    const [cx, cy] = z.center;
    return {
      type: "Feature",
      properties: {
        intensity_mm_h: +z.rainIntensity.toFixed(1),
        name: `Rain cell — ${z.name}`,
        zone_code: z.zone_code,
        kind: "rain_cell",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [+(cx - w).toFixed(5), +(cy - h).toFixed(5)],
          [+(cx + w).toFixed(5), +(cy - h).toFixed(5)],
          [+(cx + w).toFixed(5), +(cy + h).toFixed(5)],
          [+(cx - w).toFixed(5), +(cy + h).toFixed(5)],
          [+(cx - w).toFixed(5), +(cy - h).toFixed(5)],
        ]],
      },
    };
  };
  return { type: "FeatureCollection", features: hot.map(cell) };
}
