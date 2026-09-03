// POST /api/v1/roads/detour — A* detour avoiding blocked segments (public).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { detour } from "@/lib/server/roads";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.from || !body?.to) {
    return NextResponse.json({ detail: "from and to zone codes required" }, { status: 422 });
  }
  const out = detour(getStore(), String(body.from), String(body.to));
  return NextResponse.json(out);
}
