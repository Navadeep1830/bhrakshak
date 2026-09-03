// GET /api/v1/analytics/backtest — serves the repo's REAL ML backtest fixture
// (demo/backtest_fixture.json — LODO metrics, lead time, Noney 2022 replay).
import { NextResponse } from "next/server";
import { backtest } from "@/lib/server/queries";

export async function GET() {
  return NextResponse.json(await backtest());
}
