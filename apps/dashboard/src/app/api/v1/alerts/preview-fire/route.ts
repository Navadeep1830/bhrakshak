// POST /api/v1/alerts/preview-fire — render an alert message in any of 8
// languages WITHOUT dispatching (public — used by the Ops console preview).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { alertChannels } from "@/lib/server/risk";
import { renderMessage } from "@/lib/server/i18n";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const store = getStore();
  const z = store.zones.find(
    (x) => x.id === body?.zone_id || x.zone_code === body?.zone_code,
  ) ?? store.zones[0];
  if (!z) return NextResponse.json({ detail: "Zone not found" }, { status: 404 });
  const lang = typeof body?.language === "string" ? body.language : "en";
  const level = Math.max(0, Math.min(4, z.hazardLevel || 1));
  const message = renderMessage(level, z.name, lang);
  return NextResponse.json({
    zone_code: z.zone_code,
    level,
    lang,
    message,
    channels: alertChannels(level),
    dispatched: false,
  });
}
