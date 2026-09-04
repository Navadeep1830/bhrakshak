import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { settleSms, ensureDemoDevices } from '@/lib/notify';

/**
 * GET /api/comms — website comms panel: SMS gateway outbox (simulated),
 * notification events, registered devices (with live/online state).
 */
export async function GET(_req: NextRequest) {
  try {
    await requireSession();
    await ensureDemoDevices();
    await settleSms();

    const [sms, events, devices] = await Promise.all([
      db.smsMessage.findMany({ orderBy: { queuedAt: 'desc' }, take: 120, include: { device: true } }),
      db.notificationEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
      db.device.findMany({ orderBy: { lastSeenAt: 'desc' } }),
    ]);

    const now = Date.now();
    const delivered = sms.filter((s) => s.status === 'delivered').length;
    const inFlight = sms.filter((s) => s.status === 'sent').length;

    return NextResponse.json({
      stats: {
        total: sms.length,
        delivered,
        inFlight,
        devices: devices.length,
        devicesOnline: devices.filter((d) => now - d.lastSeenAt.getTime() < 70_000).length,
        notifications24h: events.length,
      },
      sms: sms.map((s) => ({
        id: s.id, phone: s.phone, body: s.body, status: s.status,
        deviceName: s.device?.name ?? null, notificationId: s.notificationId,
        queuedAt: s.queuedAt, sentAt: s.sentAt, deliveredAt: s.deliveredAt,
      })),
      notifications: events.map((n) => ({
        id: n.id, kind: n.kind, level: n.level, title: n.title, body: n.body.slice(0, 200),
        zoneCode: n.zoneCode, district: n.district, probability: n.probability,
        channels: JSON.parse(n.channels), createdAt: n.createdAt,
      })),
      devices: devices.map((d) => ({
        id: d.id, deviceId: d.deviceId, name: d.name, phone: d.phone, district: d.district,
        lastSeenAt: d.lastSeenAt, online: now - d.lastSeenAt.getTime() < 70_000,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
