import { NextRequest, NextResponse } from 'next/server';
import { fail, body } from '@/lib/api';
import { requireRoles } from '@/lib/auth';
import { decayConditions } from '@/lib/simulate';

/**
 * POST /api/simulate/reset — decay injected conditions back to drizzle.
 * Body: { district?: string } (omit = all districts)
 * The engine's 3-tick de-escalation hysteresis then steps zones down and
 * fires all-clear alerts + notifications.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRoles('admin', 'district_admin');
    const { district } = await body<{ district?: string | null }>(req);
    const out = await decayConditions(district ?? null);
    return NextResponse.json({ ok: true, scope: district ?? 'all districts', ...out });
  } catch (e) {
    return fail(e);
  }
}

export const dynamic = 'force-dynamic';
