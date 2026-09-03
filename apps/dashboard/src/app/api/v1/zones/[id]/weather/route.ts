// GET /api/v1/zones/[id]/weather — public I-D threshold check + 72h forecast.
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { weatherOut } from "@/lib/server/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const store = getStore();
  const z = store.zones.find((x) => x.id === id || x.zone_code === id);
  if (!z) return NextResponse.json({ detail: "Zone not found" }, { status: 404 });
  return NextResponse.json(weatherOut(z));
}
