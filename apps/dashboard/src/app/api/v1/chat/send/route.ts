// POST /api/v1/chat/send — send a field chat message (demo mode).
// Identity comes from the JWT payload, never from the request body.
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["admin", "district_admin", "field_official", "citizen"]);
  if (!guard.ok) return guard.res;
  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim().slice(0, 500) : "";
  if (!message) {
    return NextResponse.json({ detail: "message required" }, { status: 422 });
  }
  const store = getStore();
  const user = store.users.find((u) => u.email === guard.payload.email);
  const msg = {
    id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sender_name: user?.full_name ?? guard.payload.email,
    location: guard.payload.district ?? "NER",
    message,
    role: guard.payload.role,
    timestamp: new Date().toISOString(),
  };
  store.chat.push(msg);
  store.chat = store.chat.slice(-80);
  return NextResponse.json(msg, { status: 201 });
}
