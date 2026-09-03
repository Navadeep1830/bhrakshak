// GET /api/v1/analytics/briefing-dossier/[zoneId] — markdown briefing (ops).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";
import { briefingMd } from "@/lib/server/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ zoneId: string }> },
) {
  const guard = requireRole(req, ["admin", "district_admin", "field_official"]);
  if (!guard.ok) return guard.res;
  const { zoneId } = await params;
  const store = getStore();
  const z = store.zones.find((x) => x.id === zoneId || x.zone_code === zoneId);
  if (!z) return NextResponse.json({ detail: "Zone not found" }, { status: 404 });
  return NextResponse.json({ zone_code: z.zone_code, briefing_md: briefingMd(store, z) });
}
