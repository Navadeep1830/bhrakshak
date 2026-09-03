// POST /api/v1/alerts/[id]/ack — acknowledge an alert (admin/district_admin).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = requireRole(req, ["admin", "district_admin"]);
  if (!guard.ok) return guard.res;
  const { id } = await params;
  const store = getStore();
  const a = store.alerts.find((x) => x.id === Number(id));
  if (!a) return NextResponse.json({ detail: "Alert not found" }, { status: 404 });
  a.ack = true;
  a.ack_by = guard.payload.email;
  store.events.unshift({
    id: ++store.eventSeq, kind: "ops", ts: Date.now(),
    text: `Alert #${a.id} (${a.zone_code} L${a.level}) acknowledged by ${guard.payload.email}`,
    level: a.level,
  });
  return NextResponse.json({ acked: a.id, by: a.ack_by });
}
