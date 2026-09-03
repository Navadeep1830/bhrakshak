// GET /api/v1/roads/status — road connectivity board (public).
import { NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { roadsOut } from "@/lib/server/roads";

export async function GET() {
  const rows = roadsOut(getStore());
  return NextResponse.json({
    roads: rows,
    summary: {
      total: rows.length,
      open: rows.filter((r) => r.status === "open").length,
      watch: rows.filter((r) => r.status === "watch").length,
      blocked: rows.filter((r) => r.status === "blocked").length,
    },
  });
}
