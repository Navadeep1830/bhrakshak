// GET /api/v1/alerts — alert log (admin/district_admin).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["admin", "district_admin", "field_official"]);
  if (!guard.ok) return guard.res;
  const store = getStore();
  const district = req.nextUrl.searchParams.get("district") ??
    (guard.payload.role === "district_admin" ? guard.payload.district : null);
  const alerts = district
    ? store.alerts.filter((a) => a.district === district)
    : store.alerts;
  return NextResponse.json(alerts.slice(0, 60));
}
