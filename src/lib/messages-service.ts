import { db } from '@/lib/db';
import { haversineKm } from '@/lib/evacuation';

/**
 * Field messaging service — two-way comms between the field app and the
 * command center.
 *
 * Devices send messages (sos | help | status | info | gauge) with optional
 * position; the website inbox reads them, command replies, and the phone
 * polls its own thread to see the replies. Everything is a plain table —
 * no caching, so every side always sees live state.
 */

export const CATEGORIES = ['sos', 'help', 'status', 'info', 'gauge'] as const;
export type MessageCategory = (typeof CATEGORIES)[number];

export interface CreateMessageInput {
  deviceId?: string | null;
  authorName: string;
  authorRole?: 'field' | 'command';
  district?: string | null;
  category?: string;
  body: string;
  priority?: number;
  lat?: number | null;
  lon?: number | null;
  zoneCode?: string | null;
  replyToId?: string | null;
  handled?: boolean;
}

export async function createMessage(input: CreateMessageInput) {
  const category = CATEGORIES.includes(input.category as MessageCategory) ? input.category : 'info';
  const priority = Math.min(Math.max(input.priority ?? (category === 'sos' ? 1 : 0), 0), 1);
  const body = input.body.trim().slice(0, 1000);
  if (!body) throw new Error('empty message');

  // resolve zone from position when possible (nearest zone, same rule as reports)
  let zoneCode = input.zoneCode ?? null;
  let district = input.district ?? null;
  if (!zoneCode && typeof input.lat === 'number' && typeof input.lon === 'number') {
    const zones = await db.zone.findMany({ select: { zoneCode: true, district: true, centroidLat: true, centroidLon: true } });
    let best: { zoneCode: string; district: string } | null = null;
    let bestKm = Infinity;
    for (const z of zones) {
      const d = haversineKm(input.lat, input.lon, z.centroidLat, z.centroidLon);
      if (d < bestKm) { bestKm = d; best = { zoneCode: z.zoneCode, district: z.district }; }
    }
    if (best && bestKm < 25) { zoneCode = best.zoneCode; district = district ?? best.district; }
  }

  const msg = await db.fieldMessage.create({
    data: {
      deviceId: input.deviceId ?? null,
      authorName: input.authorName.slice(0, 80),
      authorRole: input.authorRole ?? 'field',
      district,
      category,
      body,
      priority,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      zoneCode,
      replyToId: input.replyToId ?? null,
      handled: input.handled ?? (input.authorRole === 'command'),
    },
  });
  return msg;
}

/** Website inbox shape: message + its replies (command side). */
export async function listInbox(limit = 60) {
  const roots = await db.fieldMessage.findMany({
    where: { replyToId: null },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      device: { select: { name: true, phone: true, lastSeenAt: true } },
      replies: { orderBy: { createdAt: 'asc' } },
    },
  });
  const open = roots.filter((m) => !m.handled).length;
  const sos = roots.filter((m) => m.category === 'sos' && !m.handled).length;
  return { messages: roots, open, sos };
}

/** Device thread shape: the phone's own messages + command replies.
 * `deviceId` is the logical device id (e.g. 'pwa-xxxx'); resolve to the row. */
export async function listDeviceThread(deviceId: string, limit = 50) {
  const dev = await db.device.findUnique({ where: { deviceId }, select: { id: true } });
  if (!dev) return [];
  const own = await db.fieldMessage.findMany({
    where: { OR: [{ deviceId: dev.id }, { replyTo: { deviceId: dev.id } }] },
    orderBy: { createdAt: 'asc' },
    take: limit * 3,
  });
  // newest-first for the phone UI
  const sorted = own.reverse().slice(0, limit);
  return sorted;
}
