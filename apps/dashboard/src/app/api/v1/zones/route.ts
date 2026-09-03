// GET /api/v1/zones — zone list (optional ?district=).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { tick } from "@/lib/server/risk";
import { zoneOut } from "@/lib/server/queries";

export async function GET(req: NextRequest) {
  const store = getStore();
  tick(store);
  const district = req.nextUrl.searchParams.get("district");
  const zones = district
    ? store.zones.filter((z) => z.district === district)
    : store.zones;
  return NextResponse.json(zones.map(zoneOut));
}
