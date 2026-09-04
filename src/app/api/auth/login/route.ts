import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword, createSessionToken, AUTH_COOKIE, SessionUser } from '@/lib/auth';
import { ApiError } from '@/lib/auth';
import { fail, body } from '@/lib/api';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await body<{ email: string; password: string }>(req);
    if (!email || !password) throw new ApiError(400, 'Email and password required');

    const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user) throw new ApiError(401, 'Invalid email or password');

    const valid = await verifyPassword(password, user.hashedPassword);
    if (!valid) throw new ApiError(401, 'Invalid email or password');

    const session: SessionUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as SessionUser['role'],
      district: user.district,
    };
    const token = await createSessionToken(session);
    const res = NextResponse.json({ user: session });
    res.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch (e) {
    return fail(e);
  }
}
