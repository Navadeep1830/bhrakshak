import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireSession, ApiError } from '@/lib/auth';
import { listInbox, createMessage } from '@/lib/messages-service';

/**
 * GET /api/messages — command-center inbox of field messages
 * (SOS / help / status / info / gauge reports), with replies + open counts.
 *
 * POST /api/messages — reply from the command center to a field message.
 * Body: { replyToId, body }. The reply lands on the phone's thread.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const inbox = await listInbox(60);
    return NextResponse.json({
      messages: inbox.messages.map((m) => ({
        id: m.id,
        deviceId: m.deviceId,
        authorName: m.authorName,
        authorRole: m.authorRole,
        deviceName: m.device?.name ?? null,
        devicePhone: m.device?.phone ?? null,
        deviceOnline: m.device ? Date.now() - new Date(m.device.lastSeenAt).getTime() < 2 * 60_000 : false,
        district: m.district,
        category: m.category,
        body: m.body,
        priority: m.priority,
        lat: m.lat,
        lon: m.lon,
        zoneCode: m.zoneCode,
        handled: m.handled,
        handledAt: m.handledAt,
        createdAt: m.createdAt,
        replies: m.replies.map((r) => ({
          id: r.id,
          authorName: r.authorName,
          authorRole: r.authorRole,
          body: r.body,
          createdAt: r.createdAt,
        })),
      })),
      open: inbox.open,
      sos: inbox.sos,
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSession();
    if (user.role !== 'admin' && user.role !== 'district_admin') {
      throw new ApiError(403, 'Only command staff can reply to field messages');
    }
    const { replyToId, body: text } = await body<{ replyToId: string; body: string }>(req);
    if (!replyToId) throw new ApiError(400, 'replyToId required');
    if (!text?.trim()) throw new ApiError(400, 'body required');

    const parent = await db.fieldMessage.findUnique({ where: { id: replyToId } });
    if (!parent) throw new ApiError(404, 'message not found');
    if (parent.authorRole !== 'field') throw new ApiError(400, 'can only reply to field messages');

    const msg = await createMessage({
      authorName: user.fullName,
      authorRole: 'command',
      district: parent.district,
      category: 'info',
      body: text,
      replyToId,
      handled: true,
    });

    // a reply IS the handling — close it out
    await db.fieldMessage.update({
      where: { id: parent.id },
      data: { handled: true, handledAt: new Date(), handledBy: user.fullName },
    });

    return NextResponse.json({ ok: true, id: msg.id, at: msg.createdAt });
  } catch (e) {
    return fail(e);
  }
}
