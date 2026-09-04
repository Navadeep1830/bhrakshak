import { NextRequest, NextResponse } from 'next/server';
import { fail, body } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { predictDry } from '@/lib/simulate';

/**
 * POST /api/simulate/predict — the model console (dry-run).
 * Any numbers in → fused level, probability, driver contributions out.
 * Uses the exact same functions as the production engine. NO DB writes:
 * run it with random inputs in front of judges to show it is not hardcoded.
 */
export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const input = await body<{
      zoneCode?: string | null;
      suscMean?: number | null;
      suscP90?: number | null;
      rain1h?: number;
      rain24h?: number;
      rain72h?: number | null;
      rain7d?: number | null;
      soilMoisture?: number | null;
      seismic?: boolean;
    }>(req);
    const out = await predictDry({
      zoneCode: input.zoneCode ?? null,
      suscMean: input.suscMean ?? null,
      suscP90: input.suscP90 ?? null,
      rain1h: input.rain1h ?? 0,
      rain24h: input.rain24h ?? 0,
      rain72h: input.rain72h ?? null,
      rain7d: input.rain7d ?? null,
      soilMoisture: input.soilMoisture ?? null,
      seismic: !!input.seismic,
    });
    return NextResponse.json(out);
  } catch (e) {
    return fail(e);
  }
}

export const dynamic = 'force-dynamic';
