// GET /api/v1/analytics/kpis — public dashboard KPIs.
import { NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { tick } from "@/lib/server/risk";
import { kpis } from "@/lib/server/queries";

export async function GET() {
  const store = getStore();
  tick(store);
  return NextResponse.json(kpis(store));
}
