import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';

interface FeedItem {
  id: string;
  kind: 'report' | 'alert' | 'sms' | 'checkin' | 'message';
  ts: string;
  title: string;
  detail: string;
  photoId?: string | null;
  zoneCode?: string | null;
  district?: string | null;
  level?: number;
  aiFlagged?: boolean;
  offline?: boolean;
}

/**
 * GET /api/activity — merged live activity feed (website side): citizen
 * reports (incl. synced offline photos), alerts, SMS dispatch, safe
 * check-ins. Makes the phone-app ↔ website communication visible.
 */
export async function GET(_req: NextRequest) {
  try {
    await requireSession();

    const since = new Date(Date.now() - 48 * 3600_000);
    const [reports, alerts, sms, checkins, messages] = await Promise.all([
      db.citizenReport.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 40,
        include: { zone: { select: { zoneCode: true, district: true } }, photo: { select: { id: true } } },
      }),
      db.alert.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 30, include: { zone: { select: { zoneCode: true, district: true } } } }),
      db.smsMessage.findMany({ where: { queuedAt: { gte: since } }, orderBy: { queuedAt: 'desc' }, take: 30 }),
      db.safeCheckin.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 15, include: { user: { select: { fullName: true } } } }),
      db.fieldMessage.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ]);

    const items: FeedItem[] = [];

    for (const r of reports) {
      items.push({
        id: `rep-${r.id}`,
        kind: 'report',
        ts: (r.clientCreatedAt ?? r.createdAt).toISOString(),
        title: `${r.offlineQueued ? 'Offline-synced report' : 'Citizen report'} — ${r.category.replace(/_/g, ' ')}${r.photo ? ' 📷' : ''}`,
        detail: r.notes?.slice(0, 120) ?? '(no notes)',
        photoId: r.photo?.id ?? null,
        zoneCode: r.zone?.zoneCode ?? null,
        district: r.zone?.district ?? null,
        aiFlagged: r.aiPreScreen === 'flagged',
        offline: r.offlineQueued,
      });
    }
    for (const a of alerts) {
      items.push({
        id: `ale-${a.id}`,
        kind: 'alert',
        ts: a.createdAt.toISOString(),
        title: `L${a.level} alert — ${a.title}`,
        detail: a.message.slice(0, 120),
        zoneCode: a.zone?.zoneCode ?? null,
        district: a.zone?.district ?? null,
        level: a.level,
      });
    }
    for (const s of sms) {
      items.push({
        id: `sms-${s.id}`,
        kind: 'sms',
        ts: s.queuedAt.toISOString(),
        title: `SMS ${s.status} → ${s.phone}`,
        detail: s.body.slice(0, 120),
      });
    }
    for (const c of checkins) {
      items.push({
        id: `chk-${c.id}`,
        kind: 'checkin',
        ts: c.createdAt.toISOString(),
        title: `Safe check-in — ${c.authorName ?? c.user?.fullName ?? 'field staff'}`,
        detail: c.message?.slice(0, 120) ?? `${c.zoneCode ?? 'field'} · ${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`,
        zoneCode: c.zoneCode ?? null,
      });
    }
    for (const m of messages) {
      items.push({
        id: `msg-${m.id}`,
        kind: 'message',
        ts: m.createdAt.toISOString(),
        title:
          m.authorRole === 'command'
            ? `Command reply → ${m.authorName}`
            : m.category === 'sos'
              ? `SOS — ${m.authorName}`
              : m.category === 'gauge'
                ? `Rain gauge — ${m.authorName}`
                : `Field message — ${m.authorName}`,
        detail: m.body.slice(0, 120),
        zoneCode: m.zoneCode ?? null,
        district: m.district ?? null,
        level: m.priority > 0 ? 3 : undefined,
      });
    }

    items.sort((a, b) => (a.ts < b.ts ? 1 : -1));

    return NextResponse.json({ items: items.slice(0, 80) });
  } catch (e) {
    return fail(e);
  }
}
