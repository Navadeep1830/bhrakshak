// Response priority queue — Model D exposure ranking.
import type { Store, Zone } from "./store";
import { sopsFor, type Sop } from "./dc";
import { roadStatus } from "./roads";

export interface PriorityRow {
  zone_id: string;
  zone_code: string;
  name: string;
  district: string;
  level: number;
  population: number;
  isolation: number;
  roads_blocked: number;
  priority: number;
  sops: Sop[];
  team: string | null;
  status: "open" | "directed" | "assigned";
}

// per-zone ops state kept outside Store (mutable scratchpad)
const g = globalThis as unknown as { __bhuOps?: Map<string, { team: string | null; status: PriorityRow["status"]; applied: string[] }> };
function ops(): Map<string, { team: string | null; status: PriorityRow["status"]; applied: string[] }> {
  if (!g.__bhuOps) g.__bhuOps = new Map();
  return g.__bhuOps;
}

export function priorityQueue(store: Store): PriorityRow[] {
  const o = ops();
  return store.zones
    .filter((z) => z.hazardLevel >= 2)
    .map((z) => {
      const blocked = store.roads.filter(
        (r) => (r.from_zone === z.id || r.to_zone === z.id) &&
          roadStatus(store, r) === "blocked",
      ).length;
      const popScore = Math.min(1, z.population / 6000);
      const score = Math.round(
        z.hazardLevel * 38 +
        popScore * 22 +
        z.isolationScore * 14 +
        blocked * 12 +
        z.creepMmYear / 8,
      );
      const st = o.get(z.id);
      return {
        zone_id: z.id,
        zone_code: z.zone_code,
        name: z.name,
        district: z.district,
        level: z.hazardLevel,
        population: z.population,
        isolation: z.isolationScore,
        roads_blocked: blocked,
        priority: score,
        sops: sopsFor(z.hazardLevel),
        team: st?.team ?? null,
        status: st?.status ?? "open",
      };
    })
    .sort((a, b) => b.priority - a.priority);
}

export function applySop(store: Store, zoneId: string, sopId: string) {
  const z = store.zones.find((x) => x.id === zoneId);
  if (!z) return null;
  const o = ops();
  const cur = o.get(zoneId) ?? { team: null, status: "open" as const, applied: [] };
  cur.applied.push(sopId);
  cur.status = "directed";
  o.set(zoneId, cur as { team: string | null; status: PriorityRow["status"]; applied: string[] });
  store.opsLog.push({ ts: Date.now(), text: `DC directive applied: ${sopId} → ${z.zone_code} ${z.name}` });
  return { zone: z.zone_code, sop: sopId, status: "directed" };
}

export function assignTeam(store: Store, zoneId: string, team: string) {
  const z = store.zones.find((x) => x.id === zoneId);
  if (!z) return null;
  const o = ops();
  const cur = o.get(zoneId) ?? { team: null, status: "directed" as const, applied: [] };
  cur.team = team;
  cur.status = "assigned";
  o.set(zoneId, cur as { team: string | null; status: PriorityRow["status"]; applied: string[] });
  store.opsLog.push({ ts: Date.now(), text: `Team ${team} assigned to ${z.zone_code} ${z.name}` });
  return { zone: z.zone_code, team, status: "assigned" };
}
