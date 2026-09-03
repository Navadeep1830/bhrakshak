// GET /api/v1/analytics/registry — model registry (public).
import { NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";

export async function GET() {
  return NextResponse.json(getStore().registry);
}
