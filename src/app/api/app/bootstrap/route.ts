import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireAppAuth } from '@/lib/auth';
import { enrichRoadsWithDetours } from '@/lib/roads';
import { settleSms } from '@/lib/notify';

/**
 * GET /api/app/bootstrap — one-shot payload for the phone app (online mode):
 *   compact zone risk grid (hexes + levels + probability), active alerts,
 *   road status + detours, recent notifications, this device's SMS,
 *   shelters near, server time. The app caches this for offline mode.
 */
export async function GET(req: NextRequest) {
  try {
    await requireAppAuth(req);
    await settleSms();

    const deviceId = req.headers.get('x-device-id');
    const since = new Date(Date.now() - 24 * 3600_000);

    const [zones, alerts, roads, notifications, sms, shelters] = await Promise.all([
      db.zone.findMany({
        select: {
          zoneCode: true, name: true, district: true, centroidLat: true, centroidLon: true,
          suscMean: true, population: true, geom: true,
          riskCell: { select: { hazardLevel: true, probability: true, drivers: true } },
        },
      }),
      db.alert.findMany({ where: { status: 'active' }, orderBy: { createdAt: 'desc' }, take: 25 }),
      enrichRoadsWithDetours(),
      db.notificationEvent.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 40 }),
      deviceId
        ? db.smsMessage.findMany({
            where: { OR: [{ status: 'sent' }, { status: 'delivered' }] },
            orderBy: { queuedAt: 'desc' },
            take: 25,
          })
        : Promise.resolve([]),
      db.shelter.findMany({ select: { name: true, district: true, lat: true, lon: true, capacity: true, occupancy: true } }),
    ]);

    return NextResponse.json({
      serverTime: new Date().toISOString(),
      zones: zones.map((z) => ({
        zoneCode: z.zoneCode,
        name: z.name,
        district: z.district,
        lat: z.centroidLat,
        lon: z.centroidLon,
        geom: JSON.parse(z.geom),
        level: z.riskCell?.hazardLevel ?? 0,
        probability: z.riskCell?.probability ?? 0,
        drivers: z.riskCell?.drivers ? JSON.parse(z.riskCell.drivers).slice(0, 5) : [],
        population: z.population,
        suscMean: z.suscMean,
      })),
      alerts: alerts.map((a) => ({
        id: a.id, level: a.level, title: a.title, message: a.message,
        probability: a.probability, createdAt: a.createdAt,
      })),
      roads: roads.map((r) => ({
        roadName: r.roadName, district: r.district, status: r.status, coords: r.coords,
        note: r.note,
        detour: r.detour ? { polyline: r.detour.polyline, extraKm: r.detour.extraKm, delayMinutes: r.detour.delayMinutes, reason: r.detour.reason } : null,
      })),
      notifications: notifications.map((n) => ({
        id: n.id, kind: n.kind, level: n.level, title: n.title, body: n.body,
        zoneCode: n.zoneCode, district: n.district, probability: n.probability,
        channels: JSON.parse(n.channels), createdAt: n.createdAt,
      })),
      sms: sms.map((s) => ({
        id: s.id, phone: s.phone, body: s.body, status: s.status,
        queuedAt: s.queuedAt, sentAt: s.sentAt, deliveredAt: s.deliveredAt,
      })),
      shelters,
    });
  } catch (e) {
    return fail(e);
  }
}
