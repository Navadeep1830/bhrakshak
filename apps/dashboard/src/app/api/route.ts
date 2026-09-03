// GET /api — health check.
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "bhu-preview-api",
    version: "1.0.0",
    endpoints: 27,
  });
}
