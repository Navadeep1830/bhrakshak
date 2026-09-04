import { NextRequest, NextResponse } from 'next/server';
import { fail, body } from '@/lib/api';
import { requireRoles, ApiError } from '@/lib/auth';
import { decayConditions } from '@/lib/simulate';

/**
 * POST /api/demo/allclear — legacy alias of /api/simulate/reset.
 * Rainfall decays to drizzle, the engine runs 3 de-escalation ticks
 * (anti-flapping requires 3 consecutive falling ticks), zones step down
 * and all-clear alerts fire.
 * Body: { district: string }
 */
export async function POST(req: NextRequest) {
  try {
    await requireRoles('admin', 'district_admin');
    const { district } = await body<{ district: string }>(req);
    if (!district) throw new ApiError(400, 'district required');

    const out = await decayConditions(district);
    return NextResponse.json({
      ok: true,
      district,
      zonesUpdated: out.zones,
      deescalated: out.deescalated,
      levelsAfter: out.levelsAfter,
    });
  } catch (e) {
    return fail(e);
  }
}

export const dynamic = 'force-dynamic';
