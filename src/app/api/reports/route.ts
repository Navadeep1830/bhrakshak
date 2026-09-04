import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { ingestReport } from '@/lib/reports-service';

/**
 * GET /api/reports?status=pending|verified|all → field-report inbox
 * (includes photo ids for the website viewer).
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') ?? 'all';
    const where: any = {};
    if (status !== 'all') where.status = status;

    const reports = await db.citizenReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 80,
      include: {
        zone: { select: { zoneCode: true, name: true, district: true } },
        submitter: { select: { fullName: true, role: true } },
        photo: { select: { id: true } },
      },
    });

    return NextResponse.json({
      reports: reports.map((r) => ({
        id: r.id,
        category: r.category,
        notes: r.notes,
        lat: r.lat,
        lon: r.lon,
        status: r.status,
        aiPreScreen: r.aiPreScreen,
        aiConfidence: r.aiConfidence,
        aiSource: r.aiSource,
        aiFindings: r.aiFindings,
        photoId: r.photo?.id ?? null,
        offlineQueued: r.offlineQueued,
        createdAt: r.createdAt,
        verifiedAt: r.verifiedAt,
        zone: r.zone,
        submitter: r.submitter,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

/**
 * POST /api/reports — submit a geo-tagged hazard report from the website
 * (any role; the citizen PWA flow). Uses the same shared ingestion
 * pipeline as the phone app: zone snap → AI pre-screen → fan-out.
 * Body: { category, notes?, lat, lon }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSession();
    const { category, notes, lat, lon } = await body<{
      category: string;
      notes?: string;
      lat: number;
      lon: number;
    }>(req);

    const result = await ingestReport({
      category,
      notes,
      lat,
      lon,
      submittedById: user.id,
    });

    return NextResponse.json({ ok: true, report: result });
  } catch (e) {
    return fail(e);
  }
}
