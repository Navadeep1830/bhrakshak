// POST /api/v1/demo/inject-rainfall-storm — demo storm over East Khasi Hills
// (9 zones ramped to 55 mm/h; hysteresis escalates to L3/L4 with alerts).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";
import { injectStorm } from "@/lib/server/risk";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["admin"]);
  if (!guard.ok) return guard.res;
  return NextResponse.json(injectStorm(getStore()));
}
