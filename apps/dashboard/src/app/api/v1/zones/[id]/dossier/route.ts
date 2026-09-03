// GET /api/v1/zones/[id]/dossier — full zone dossier (admin/district/field).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";
import { dossier } from "@/lib/server/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = requireRole(req, ["admin", "district_admin", "field_official"]);
  if (!guard.ok) return guard.res;
  const { id } = await params;
  const store = getStore();
  const z = store.zones.find((x) => x.id === id || x.zone_code === id);
  if (!z) return NextResponse.json({ detail: "Zone not found" }, { status: 404 });
  if (guard.payload.role === "district_admin" && guard.payload.district &&
      z.district !== guard.payload.district) {
    return NextResponse.json({ detail: "Zone outside your district" }, { status: 403 });
  }
  return NextResponse.json(dossier(store, z, { authed: true }));
}
