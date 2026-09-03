// GET /api/v1/geo/roads — GeoJSON road network with status colors.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { roadsGeojson } from "@/lib/server/queries";

export async function GET() {
  return NextResponse.json(roadsGeojson(getStore()));
}
