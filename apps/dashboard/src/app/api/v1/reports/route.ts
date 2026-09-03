// POST /api/v1/reports — create a citizen report (public; geo-tagged).
// GET  — list reports (ops roles).
import { NextRequest, NextResponse } from "next/server";
import { getStore, type CitizenReport } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";
import { haversineKm } from "@/lib/server/rng";

// Accept both the canonical union and the PWA's short labels.
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
  if (!body?.type || !body?.lat || !body?.lon) {
    return NextResponse.json(
      { detail: "type, lat, lon required" }, { status: 422 },
    );
  }
  const store = getStore();
  // nearest zone claims the report
  let best = store.zones[0];
  let bestD = Infinity;
  for (const z of store.zones) {
    const d = haversineKm([body.lon, body.lat], z.center);
    if (d < bestD) { bestD = d; best = z; }
  }
  const rep = {
    id: ++store.reportSeq,
    zone_id: best.id,
    reporter: String(body.reporter ?? "citizen"),
    type: normType(body.type),
    note: String(body.note ?? ""),
    lat: Number(body.lat),
    lon: Number(body.lon),
    photo: body.photo,
    verdict: body.verdict,
    status: "pending" as const,
    created_at: Date.now(),
  };
  store.reports.unshift(rep);
  store.events.unshift({
    id: ++store.eventSeq, kind: "sensor", ts: Date.now(),
    text: `Field report: ${rep.type} at ${best.zone_code} ${best.name}${rep.verdict ? ` — Model V: ${rep.verdict.label}` : ""}`,
  });
  return NextResponse.json({
    id: rep.id, zone_code: best.zone_code, status: "accepted",
  }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["admin", "district_admin", "field_official"]);
  if (!guard.ok) return guard.res;
  const store = getStore();
  const out = store.reports.slice(0, 50).flatMap((r) => {
    const z = store.zones.find((x) => x.id === r.zone_id);
    if (!z) return [];
    return [{
      id: r.id, zone_code: z.zone_code, type: r.type, note: r.note,
      status: r.status, lat: r.lat, lon: r.lon, verdict: r.verdict,
      created_at: r.created_at, reporter: r.reporter,
    }];
  });
  return NextResponse.json(out);
}
