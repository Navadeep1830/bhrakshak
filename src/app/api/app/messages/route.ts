import { NextRequest, NextResponse } from 'next/server';
import { fail } from '@/lib/api';
import { requireAppAuth } from '@/lib/auth';
import { listDeviceThread } from '@/lib/messages-service';

/**
 * GET /api/app/messages — the phone's message thread: messages this device
 * sent + command replies to them. Device auth.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAppAuth(req);
    const deviceId = auth.kind === 'device' ? auth.deviceId : auth.deviceId ?? '';
    if (!deviceId) return NextResponse.json({ messages: [] });
    const messages = await listDeviceThread(deviceId);
    return NextResponse.json({ messages, serverTime: new Date().toISOString() });
  } catch (e) {
    return fail(e);
  }
}
