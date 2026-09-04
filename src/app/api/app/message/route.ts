import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireAppAuth, ApiError } from '@/lib/auth';
import { createMessage } from '@/lib/messages-service';

/**
 * POST /api/app/message — field app sends a message to the command center.
 * Device auth (x-device-id) or website session. Body:
 *   { category: sos|help|status|info, body, lat?, lon?, zoneCode? }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAppAuth(req);
    const { category, body: text, lat, lon, zoneCode } = await body<{
      category?: string;
      body: string;
      lat?: number;
      lon?: number;
      zoneCode?: string;
    }>(req);
    if (!text || !text.trim()) throw new ApiError(400, 'body required');

    let devId: string | null = null; // Device row id (FK) — NOT the logical deviceId string
    let authorName = 'Field official';
    let district: string | null = null;
    if (auth.kind === 'device') {
      const dev = await db.device.findUnique({ where: { deviceId: auth.deviceId } });
      if (dev) { devId = dev.id; authorName = dev.name; district = dev.district; }
    } else {
      authorName = auth.user.fullName;
      district = auth.user.district;
    }

    const msg = await createMessage({
      deviceId: devId,
      authorName,
      authorRole: 'field',
      district,
      category,
      body: text,
      lat: typeof lat === 'number' ? lat : null,
      lon: typeof lon === 'number' ? lon : null,
      zoneCode: zoneCode ?? null,
    });

    return NextResponse.json({
      ok: true,
      id: msg.id,
      zoneCode: msg.zoneCode,
      priority: msg.priority,
      at: msg.createdAt,
    });
  } catch (e) {
    return fail(e);
  }
}
