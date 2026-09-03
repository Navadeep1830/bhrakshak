// GET /api/v1/evacuation/safe-route?zone=CODE — hazard-avoiding route to the
// best shelter (public — citizens need it most).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { safeRoute } from "@/lib/server/evacuation";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("zone") ?? "MN-NON-002";
  const out = safeRoute(getStore(), code);
  if (!out) return NextResponse.json({ detail: "Zone not found" }, { status: 404 });
  return NextResponse.json(out);
}
