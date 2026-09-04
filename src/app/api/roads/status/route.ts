import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireRoles, ApiError } from '@/lib/auth';

/**
 * POST /api/roads/status — update a road segment state (ops console).
 * Body: { roadId: string, status: 'open'|'watch'|'blocked', note?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireRoles('admin', 'district_admin', 'field_official');
    const { roadId, status, note } = await body<{
      roadId: string;
      status: string;
      note?: string;
    }>(req);

    const VALID = ['open', 'watch', 'blocked'];
    if (!VALID.includes(status)) throw new ApiError(400, `status must be one of ${VALID.join(', ')}`);

    const road = await db.roadStatus.findUnique({ where: { id: roadId } });
    if (!road) throw new ApiError(404, 'Road segment not found');

    await db.roadStatus.update({
      where: { id: roadId },
      data: {
        status,
        note: note?.slice(0, 500) ?? null,
        source: user.role === 'field_official' ? 'report' : 'model',
      },
    });

    return NextResponse.json({ ok: true, roadId, status, updatedBy: user.fullName });
  } catch (e) {
    return fail(e);
  }
}
