// GET /api/v1/geo/reports — GeoJSON citizen report points.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { reportsGeojson } from "@/lib/server/queries";

export async function GET() {
  return NextResponse.json(reportsGeojson(getStore()));
}
