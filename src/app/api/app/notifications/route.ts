import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireAppAuth } from '@/lib/auth';
import { settleSms } from '@/lib/notify';

/**
 * GET /api/app/notifications?since=<iso> — phone polling endpoint.
 * Returns notification events newer than `since` (+ this device's SMS
 * delivery state). Driving the toast / browser-notification / SMS inbox
 * in the app.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAppAuth(req);
    await settleSms();

    const { searchParams } = new URL(req.url);
    const sinceParam = searchParams.get('since');
    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 12 * 3600_000);
    const validSince = Number.isNaN(since.getTime()) ? new Date(Date.now() - 12 * 3600_000) : since;

    const [events, sms] = await Promise.all([
      db.notificationEvent.findMany({
        where: { createdAt: { gt: validSince } },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      db.smsMessage.findMany({ orderBy: { queuedAt: 'desc' }, take: 40 }),
    ]);

    return NextResponse.json({
      serverTime: new Date().toISOString(),
      notifications: events.map((n) => ({
        id: n.id, kind: n.kind, level: n.level, title: n.title, body: n.body,
        zoneCode: n.zoneCode, district: n.district, probability: n.probability,
        channels: JSON.parse(n.channels), reportId: n.reportId, createdAt: n.createdAt,
      })),
      sms: sms.map((s) => ({
        id: s.id, phone: s.phone, body: s.body, status: s.status,
        queuedAt: s.queuedAt, deliveredAt: s.deliveredAt,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * POST /api/app/notifications — heartbeat + mark device seen.
 * Body: { deviceId } → bumps lastSeenAt so the website shows the phone live.
 */
export async function POST(req: NextRequest) {
  try {
    const { deviceId } = await body<{ deviceId?: string }>(req).catch(() => ({ deviceId: undefined }));
    if (deviceId) {
      await db.device.updateMany({ where: { deviceId }, data: { lastSeenAt: new Date() } });
    }
    return NextResponse.json({ ok: true, serverTime: new Date().toISOString() });
  } catch (e) {
    return fail(e);
  }
}
