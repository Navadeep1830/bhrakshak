import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { ApiError } from '@/lib/auth';
import { ensureDemoDevices } from '@/lib/notify';

/**
 * POST /api/app/register — register/refresh a field device (the phone app).
 * Body: { deviceId, name, phone?, district? }
 * Devices are the SMS/notification fan-out targets.
 */
export async function POST(req: NextRequest) {
  try {
    const { deviceId, name, phone, district } = await body<{
      deviceId: string;
      name?: string;
      phone?: string;
      district?: string | null;
    }>(req);
    if (!deviceId || deviceId.length < 4) throw new ApiError(400, 'deviceId required');

    await ensureDemoDevices();

    const device = await db.device.upsert({
      where: { deviceId },
      create: {
        deviceId,
        name: name?.slice(0, 80) || 'Field phone',
        phone: phone?.slice(0, 20) || null,
        district: district ?? null,
        lastSeenAt: new Date(),
      },
      update: {
        name: name?.slice(0, 80) ?? undefined,
        phone: phone?.slice(0, 20),
        district: district ?? null,
        lastSeenAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, device: { deviceId: device.deviceId, name: device.name, phone: device.phone, district: device.district } });
  } catch (e) {
    return fail(e);
  }
}
