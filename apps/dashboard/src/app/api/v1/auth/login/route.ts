// POST /api/v1/auth/login — demo login (HMAC token).
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { login } from "@/lib/server/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ detail: "email and password required" }, { status: 422 });
  }
  const out = login(getStore(), String(body.email), String(body.password));
  if (!out) return NextResponse.json({ detail: "Invalid credentials" }, { status: 401 });
  return NextResponse.json(out);
}
