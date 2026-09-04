import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { haversineKm } from '@/lib/evacuation';

/**
 * POST /api/checkin — "I'm safe" check-in with nearest zone attribution.
 * Body: { lat, lon, message? }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSession();
    const { lat, lon, message } = await body<{ lat: number; lon: number; message?: string }>(req);
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return NextResponse.json({ error: 'lat/lon required' }, { status: 400 });
    }

    const zones = await db.zone.findMany();
    let bestCode: string | null = null;
    let bestKm = Infinity;
    for (const z of zones) {
      const d = haversineKm(lat, lon, z.centroidLat, z.centroidLon);
      if (d < bestKm) {
        bestKm = d;
        bestCode = z.zoneCode;
      }
    }

    const checkin = await db.safeCheckin.create({
      data: { userId: user.id, lat, lon, zoneCode: bestCode, message: message?.slice(0, 300) ?? null },
    });

    return NextResponse.json({
      ok: true,
      id: checkin.id,
      zoneCode: bestCode,
      distanceKm: Math.round(bestKm * 100) / 100,
      at: checkin.createdAt,
    });
  } catch (e) {
    return fail(e);
  }
}
