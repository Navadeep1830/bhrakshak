import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireRoles, ApiError } from '@/lib/auth';

/**
 * POST /api/reports/[id]/verify — approve/reject a report (field official+).
 * Body: { approve: boolean, note?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRoles('admin', 'district_admin', 'field_official');
    const { id } = await params;
    const { approve } = await body<{ approve: boolean }>(req);
    if (typeof approve !== 'boolean') throw new ApiError(400, 'approve (boolean) required');

    const report = await db.citizenReport.findUnique({ where: { id } });
    if (!report) throw new ApiError(404, 'Report not found');

    await db.citizenReport.update({
      where: { id },
      data: {
        status: approve ? 'verified' : 'rejected',
        verifiedAt: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      status: approve ? 'verified' : 'rejected',
      verifiedBy: user.fullName,
    });
  } catch (e) {
    return fail(e);
  }
}
