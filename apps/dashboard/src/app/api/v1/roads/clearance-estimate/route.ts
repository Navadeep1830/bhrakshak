// POST /api/v1/roads/clearance-estimate — equipment-based clearance time.
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { clearance } from "@/lib/server/roads";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.road_id) {
    return NextResponse.json({ detail: "road_id required" }, { status: 422 });
  }
  const out = clearance(getStore(), String(body.road_id));
  if (!out) return NextResponse.json({ detail: "Road not found" }, { status: 404 });
  return NextResponse.json(out);
}
