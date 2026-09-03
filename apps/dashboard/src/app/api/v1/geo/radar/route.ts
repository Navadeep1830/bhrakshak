// GET /api/v1/geo/radar — rain radar cell GeoJSON from live gauge
// intensity (demo storm inject ramps these cells visibly).
import { NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { tick } from "@/lib/server/risk";
import { radarGeojson } from "@/lib/server/ops-geo";

export async function GET() {
  const store = getStore();
  tick(store);
  return NextResponse.json(radarGeojson(store));
}
