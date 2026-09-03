// GET /api/v1/evacuation/shelters — shelter capacity board (public).
import { NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { sheltersOut } from "@/lib/server/evacuation";

export async function GET() {
  return NextResponse.json(sheltersOut(getStore()));
}
