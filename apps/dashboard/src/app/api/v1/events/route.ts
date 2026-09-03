// GET /api/v1/events?since=N — live event feed (polling replacement for the
// repo's /ws/live WebSocket: same payload shape).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";

export async function GET(req: NextRequest) {
  const store = getStore();
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0);
  const events = since === 0
    ? store.events.slice(0, 40)
    : store.events.filter((e) => e.id > since).slice(0, 40);
  return NextResponse.json({ events, latest_id: store.events[0]?.id ?? 0 });
}
