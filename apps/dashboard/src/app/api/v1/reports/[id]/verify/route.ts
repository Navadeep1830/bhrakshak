// POST /api/v1/reports/[id]/verify — official verification (field+).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = requireRole(req, ["admin", "district_admin", "field_official"]);
  if (!guard.ok) return guard.res;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const store = getStore();
  const rep = store.reports.find((r) => r.id === Number(id));
  if (!rep) return NextResponse.json({ detail: "Report not found" }, { status: 404 });
  rep.status = body?.reject ? "rejected" : "verified";
  store.events.unshift({
    id: ++store.eventSeq, kind: "ops", ts: Date.now(),
    text: `Report #${rep.id} ${rep.status} by ${guard.payload.email}`,
  });
  return NextResponse.json({ id: rep.id, status: rep.status });
}
