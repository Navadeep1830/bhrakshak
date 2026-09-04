import { NextRequest, NextResponse } from 'next/server';
import { fail, body } from '@/lib/api';
import { requireRoles, ApiError } from '@/lib/auth';
import { injectConditions } from '@/lib/simulate';

/**
 * POST /api/simulate/conditions — manual condition injection.
 * Body: { district?, zoneCode?, rain1h, rain24h, rain72h?, rain7d?,
 *         soilMoisture?, hours?, label? }
 *
 * Writes real observation rows from the numbers the operator typed, then runs
 * the production engine pass (I-D thresholds + calibrated prior + hysteresis
 * + alert/notification/SMS fan-out). Returns the before→after diff.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRoles('admin', 'district_admin');
    const input = await body<{
      district?: string | null;
      zoneCode?: string | null;
      rain1h?: number;
      rain24h?: number;
      rain72h?: number | null;
      rain7d?: number | null;
      soilMoisture?: number | null;
      hours?: number;
      label?: string | null;
    }>(req);

    if (typeof input.rain1h !== 'number' || typeof input.rain24h !== 'number') {
      throw new ApiError(400, 'rain1h and rain24h (numbers) are required');
    }
    if (!input.district && !input.zoneCode) {
      throw new ApiError(400, 'Scope required — pass district or zoneCode');
    }

    const report = await injectConditions({
      district: input.district ?? null,
      zoneCode: input.zoneCode ?? null,
      rain1h: input.rain1h,
      rain24h: input.rain24h,
      rain72h: input.rain72h ?? null,
      rain7d: input.rain7d ?? null,
      soilMoisture: input.soilMoisture ?? null,
      hours: input.hours ?? 1,
      label: input.label ?? null,
    });
    return NextResponse.json(report);
  } catch (e) {
    return fail(e);
  }
}

export const dynamic = 'force-dynamic';
