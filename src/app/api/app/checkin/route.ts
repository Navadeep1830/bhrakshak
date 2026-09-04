import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireAppAuth, ApiError } from '@/lib/auth';
import { haversineKm } from '@/lib/evacuation';

/**
 * POST /api/app/checkin — "I'M SAFE" check-in from the field app.
 * Device auth (no website login needed). Attributes the nearest zone,
 * same as the website check-in route.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAppAuth(req);
    const { lat, lon, message } = await body<{ lat: number; lon: number; message?: string }>(req);
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      throw new ApiError(400, 'lat/lon required');
    }

    const zones = await db.zone.findMany({ select: { zoneCode: true, centroidLat: true, centroidLon: true } });
    let bestCode: string | null = null;
    let bestKm = Infinity;
    for (const z of zones) {
      const d = haversineKm(lat, lon, z.centroidLat, z.centroidLon);
      if (d < bestKm) { bestKm = d; bestCode = z.zoneCode; }
    }

    let userId: string | null = null;
    let deviceId: string | null = null;
    let authorName: string | null = null;
    if (auth.kind === 'user') {
      userId = auth.user.id;
      authorName = auth.user.fullName;
    } else {
      deviceId = auth.deviceId;
      const dev = await db.device.findUnique({ where: { deviceId } });
      authorName = dev?.name ?? 'Field official';
    }

    const checkin = await db.safeCheckin.create({
      data: {
        userId,
        deviceId,
        authorName,
        lat,
        lon,
        zoneCode: bestCode,
        message: message?.slice(0, 300) ?? null,
      },
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
