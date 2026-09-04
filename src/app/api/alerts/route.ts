import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';

/**
 * GET /api/alerts?status=active|all&limit=50 → alert console feed.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') ?? 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '60', 10) || 60, 200);
    const district = searchParams.get('district');

    const where: any = {};
    if (status === 'active') where.status = 'active';
    if (district && district !== 'all') where.zone = { district };

    const alerts = await db.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        zone: { select: { zoneCode: true, name: true, district: true, state: true, centroidLat: true, centroidLon: true } },
        acks: { include: { user: { select: { fullName: true, role: true } } } },
      },
    });

    return NextResponse.json({
      alerts: alerts.map((a) => ({
        id: a.id,
        level: a.level,
        title: a.title,
        message: a.message,
        status: a.status,
        probability: a.probability,
        channels: JSON.parse(a.channels || '[]'),
        languages: JSON.parse(a.languages || '{}'),
        createdAt: a.createdAt,
        zone: a.zone,
        acks: a.acks.map((k) => ({ by: k.user.fullName, role: k.user.role, at: k.createdAt, note: k.note })),
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
