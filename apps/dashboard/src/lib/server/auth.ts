// HMAC demo auth — port of the repo's JWT-style contract (5 demo users).
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { Store } from "./store";

const SECRET = "bhu-demo-secret-sih26001";
const DAY_MS = 24 * 3600_000;

export type Role = "admin" | "district_admin" | "field_official" | "citizen";

export interface TokenPayload {
  email: string;
  role: Role;
  district: string | null;
  exp: number;
}

const b64u = (s: string) =>
  Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function signToken(p: TokenPayload): string {
  const body = b64u(JSON.stringify(p));
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig !== expect) return null;
  try {
    const p = JSON.parse(unb64u(body)) as TokenPayload;
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function login(store: Store, email: string, password: string) {
  const user = store.users.find((u) => u.email === email);
  if (!user || user.password !== password) return null;
  const payload: TokenPayload = {
    email: user.email,
    role: user.role,
    district: user.district,
    exp: Date.now() + DAY_MS,
  };
  return {
    access_token: signToken(payload),
    refresh_token: "refresh-" + signToken({ ...payload, exp: Date.now() + 14 * DAY_MS }),
    role: user.role,
    user: { email: user.email, full_name: user.full_name, role: user.role, district: user.district },
  };
}

function bearer(req: NextRequest): TokenPayload | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? verifyToken(m[1]) : null;
}

/** Guard helper: returns payload or a NextResponse error. */
export function requireRole(
  req: NextRequest,
  roles: Role[],
): { ok: true; payload: TokenPayload } | { ok: false; res: NextResponse } {
  const p = bearer(req);
  if (!p) return { ok: false, res: NextResponse.json({ detail: "Not authenticated" }, { status: 401 }) };
  if (!roles.includes(p.role)) {
    return { ok: false, res: NextResponse.json({ detail: "Requires admin/district_admin" }, { status: 403 }) };
  }
  return { ok: true, payload: p };
}
