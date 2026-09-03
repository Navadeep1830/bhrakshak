// GET /api/v1/geo/zones — GeoJSON hexes for the MapLibre risk layer.
// ?district= filters; ?horizon=0/24/48/72 repaints with projected levels.
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { tick } from "@/lib/server/risk";
import { zonesGeojson } from "@/lib/server/queries";

export async function GET(req: NextRequest) {
  const store = getStore();
  tick(store);
  const district = req.nextUrl.searchParams.get("district");
  const horizon = Number(req.nextUrl.searchParams.get("horizon") ?? 0);
  return NextResponse.json(zonesGeojson(store, district, horizon));
}
