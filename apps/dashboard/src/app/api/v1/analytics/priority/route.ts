// GET  /api/v1/analytics/priority — response priority queue (ops roles).
// POST /api/v1/analytics/priority — apply a DC SOP directive {zone_id, sop_id}.
// PUT  /api/v1/analytics/priority — assign a team {zone_id, team}.
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";
import { priorityQueue, applySop, assignTeam } from "@/lib/server/priority";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["admin", "district_admin", "field_official"]);
  if (!guard.ok) return guard.res;
  const store = getStore();
  const district = guard.payload.role === "district_admin" ? guard.payload.district : null;
  const rows = priorityQueue(store);
  return NextResponse.json(district ? rows.filter((r) => r.district === district) : rows);
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["admin", "district_admin"]);
  if (!guard.ok) return guard.res;
  const body = await req.json().catch(() => ({}));
  if (!body?.zone_id || !body?.sop_id) {
    return NextResponse.json({ detail: "zone_id and sop_id required" }, { status: 422 });
  }
  const out = applySop(getStore(), String(body.zone_id), String(body.sop_id));
  if (!out) return NextResponse.json({ detail: "Zone not found" }, { status: 404 });
  return NextResponse.json(out);
}

export async function PUT(req: NextRequest) {
  const guard = requireRole(req, ["admin", "district_admin"]);
  if (!guard.ok) return guard.res;
  const body = await req.json().catch(() => ({}));
  if (!body?.zone_id || !body?.team) {
    return NextResponse.json({ detail: "zone_id and team required" }, { status: 422 });
  }
  const store = getStore();
  if (!store.teams.includes(String(body.team))) {
    return NextResponse.json({ detail: "Unknown team" }, { status: 422 });
  }
  const out = assignTeam(store, String(body.zone_id), String(body.team));
  if (!out) return NextResponse.json({ detail: "Zone not found" }, { status: 404 });
  return NextResponse.json(out);
}
