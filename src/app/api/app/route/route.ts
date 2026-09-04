import { NextRequest, NextResponse } from 'next/server';
import { fail, body } from '@/lib/api';
import { requireAppAuth, ApiError } from '@/lib/auth';
import { planRoutes } from '@/lib/app-route';

/**
 * POST /api/app/route — alternative safe routes for the phone app.
 * Body: { originLat, originLon, destLat, destLon }
 * Returns 3 route options (fastest / safest / alternate bypass), each with
 * corridor risk score, ETA, and hazard marks (where landslides could occur).
 */
export async function POST(req: NextRequest) {
  try {
    await requireAppAuth(req);
    const { originLat, originLon, destLat, destLon, destName } = await body<{
      originLat: number;
      originLon: number;
      destLat: number;
      destLon: number;
      destName?: string | null;
    }>(req);
    for (const [k, v] of Object.entries({ originLat, originLon, destLat, destLon })) {
      if (typeof v !== 'number' || Number.isNaN(v)) throw new ApiError(400, `${k} (number) required`);
    }
    if (Math.abs(originLat) > 90 || Math.abs(destLat) > 90 || Math.abs(originLon) > 180 || Math.abs(destLon) > 180) {
      throw new ApiError(400, 'Invalid coordinates');
    }

    const plan = await planRoutes(
      { lat: originLat, lon: originLon },
      { lat: destLat, lon: destLon },
      destName ?? null
    );
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    return fail(e);
  }
}
