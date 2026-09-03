// GET /api/v1/chat/messages — live field chat history (demo mode, in-memory).
// Contract-identical to the FastAPI backend: oldest → newest, requires any
// authenticated role.
import { NextRequest, NextResponse } from "next/server";
import { getStore, tickChat } from "@/lib/server/store";
import { requireRole } from "@/lib/server/auth";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["admin", "district_admin", "field_official", "citizen"]);
  if (!guard.ok) return guard.res;
  const store = getStore();
  tickChat(store);
  return NextResponse.json(store.chat.slice(-80));
}
