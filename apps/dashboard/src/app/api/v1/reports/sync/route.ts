// POST /api/v1/reports/sync — offline queue sync with field dedupe:
// two reports within 50 m and 60 min of an existing one get MERGED.
import { NextRequest, NextResponse } from "next/server";
import { getStore, type CitizenReport } from "@/lib/server/store";
import { haversineKm } from "@/lib/server/rng";

const TYPE_MAP: Record<string, string> = {
  crack: "crack", flow: "slope_movement", roadblock: "road_block",
  seepage: "water", water: "water", slope_movement: "slope_movement",
  road_block: "road_block", checkin: "checkin",
};
function normType(t: unknown): CitizenReport["type"] {
  return (TYPE_MAP[String(t)] ?? "checkin") as CitizenReport["type"];
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const queued: any[] = Array.isArray(body?.queued) ? body.queued : [];
  if (queued.length === 0) {
    return NextResponse.json({ results: [], synced: 0 });
  }
  const store = getStore();
  const results: any[] = [];

  for (const q of queued) {
    const lat = Number(q.lat), lon = Number(q.lon);
    if (!lat || !lon || !q.type) {
      results.push({ client_id: q.client_id, status: "rejected", reason: "missing fields" });
      continue;
    }
    // dedupe: 50 m / 1 h against existing reports of the same type
    const dup = store.reports.find(
      (r) =>
        r.type === q.type &&
        Math.abs(r.created_at - Number(q.created_at ?? Date.now())) < 3600_000 &&
        haversineKm([lon, lat], [r.lon, r.lat]) < 0.05,
    );
    if (dup) {
      results.push({
        client_id: q.client_id, status: "merged",
        reason: "duplicate within 50 m / 1 h", server_id: dup.id,
      });
      continue;
    }
    let best = store.zones[0];
    let bestD = Infinity;
    for (const z of store.zones) {
      const d = haversineKm([lon, lat], z.center);
      if (d < bestD) { bestD = d; best = z; }
    }
    const rep = {
      id: ++store.reportSeq,
      zone_id: best.id,
      reporter: String(q.reporter ?? "field-pwa"),
      type: normType(q.type),
      note: String(q.note ?? ""),
      lat, lon,
      photo: q.photo,
      verdict: q.verdict,
      status: "pending" as const,
      created_at: Date.now(),
    };
    store.reports.unshift(rep);
    store.events.unshift({
      id: ++store.eventSeq, kind: "sensor", ts: Date.now(),
      text: `Synced report ${rep.type} → ${best.zone_code} ${best.name}`,
    });
    results.push({ client_id: q.client_id, status: "accepted", server_id: rep.id });
  }

  return NextResponse.json({ results, synced: results.filter((r) => r.status !== "rejected").length });
}
