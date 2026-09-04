import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireSession, ApiError } from '@/lib/auth';

/**
 * PATCH /api/messages/[id] — mark a field message handled (or reopen).
 * Body: { handled: boolean }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    if (user.role !== 'admin' && user.role !== 'district_admin') {
      throw new ApiError(403, 'Only command staff can update messages');
    }
    const { id } = await params;
    const { handled } = await body<{ handled: boolean }>(req);

    const msg = await db.fieldMessage.update({
      where: { id },
      data: {
        handled: !!handled,
        handledAt: handled ? new Date() : null,
        handledBy: handled ? user.fullName : null,
      },
    });
    return NextResponse.json({ ok: true, id: msg.id, handled: msg.handled });
  } catch (e) {
    return fail(e);
  }
}
