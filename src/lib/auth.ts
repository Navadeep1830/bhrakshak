/**
 * BhuRakshak auth — JWT (jose) in httpOnly cookies + bcrypt hashing + RBAC.
 * Roles: admin > district_admin > field_official > citizen
 */
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export const AUTH_COOKIE = 'bhr_session';
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'bhrakshak-dev-secret-change-in-production-0123456789'
);

export type Role = 'admin' | 'district_admin' | 'field_official' | 'citizen';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  district: string | null;
}

export async function hashPassword(pw: string): Promise<string> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.compare(pw, hash);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    district: user.district,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET);
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return {
      id: payload.sub as string,
      email: payload.email as string,
      fullName: payload.fullName as string,
      role: payload.role as Role,
      district: (payload.district as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Require any session; throws an ApiError otherwise. */
export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new ApiError(401, 'Authentication required');
  return s;
}

/** Require one of the given roles. */
export async function requireRoles(...roles: Role[]): Promise<SessionUser> {
  const s = await requireSession();
  if (!roles.includes(s.role)) {
    throw new ApiError(403, `Requires role: ${roles.join(' or ')}`);
  }
  return s;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * App-endpoint auth: accepts either a logged-in user session (cookie) or
 * a registered field device (x-device-id header). Lets the phone app work
 * standalone while the website keeps RBAC.
 */
export async function requireAppAuth(req: Request): Promise<
  | { kind: 'user'; user: SessionUser; deviceId: string | null }
  | { kind: 'device'; deviceId: string; user: null }
> {
  const session = await getSession();
  if (session) return { kind: 'user', user: session, deviceId: req.headers.get('x-device-id') };
  const deviceId = req.headers.get('x-device-id');
  if (deviceId) {
    const { db } = await import('@/lib/db');
    const device = await db.device.findUnique({ where: { deviceId } });
    if (device) {
      await db.device.update({ where: { deviceId }, data: { lastSeenAt: new Date() } }).catch(() => {});
      return { kind: 'device', deviceId, user: null };
    }
  }
  throw new ApiError(401, 'Authentication or device registration required');
}
