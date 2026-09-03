// POST /api/v1/demo/reset-storm — clears demo ramps, re-seeds the world to
// the live-gauge baseline (matches the repo's hysteresis-relaxed reset).
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { resetStore } from "@/lib/server/store";
import { kpis } from "@/lib/server/queries";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["admin"]);
  if (!guard.ok) return guard.res;
  const store = resetStore();
  return NextResponse.json({ reset: true, zones: store.zones.length, kpis: kpis(store) });
}
