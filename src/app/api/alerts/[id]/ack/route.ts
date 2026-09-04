import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireRoles, ApiError } from '@/lib/auth';

/**
 * POST /api/alerts/[id]/ack — acknowledge an alert (DC / admin).
 * Body: { note?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRoles('admin', 'district_admin', 'field_official');
    const { id } = await params;
    const { note } = await body<{ note?: string }>(req).catch(() => ({ note: undefined }));

    const alert = await db.alert.findUnique({ where: { id } });
    if (!alert) throw new ApiError(404, 'Alert not found');

    await db.alertAck.upsert({
      where: { alertId_userId: { alertId: id, userId: user.id } },
      create: { alertId: id, userId: user.id, note: note ?? null },
      update: { note: note ?? null },
    });
    await db.alert.update({ where: { id }, data: { status: 'acked' } });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
