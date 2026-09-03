// GET /api/v1/geo/ops — ops overlay GeoJSON: detour routes (A* around
// blocked segments), blockage points with clearance ETAs, machinery
// staging bases. All computed from live world state.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { tick } from "@/lib/server/risk";
import { opsGeojson } from "@/lib/server/ops-geo";

export async function GET() {
  const store = getStore();
  tick(store);
  return NextResponse.json(opsGeojson(store));
}
