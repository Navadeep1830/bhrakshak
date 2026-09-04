import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireAppAuth, ApiError } from '@/lib/auth';
import { ingestReport } from '@/lib/reports-service';

interface SyncItem {
  clientCreatedAt: string;
  category: string;
  notes?: string;
  lat: number;
  lon: number;
  photoDataUrl?: string; // data:image/jpeg;base64,...
}

/**
 * POST /api/app/sync — offline-queue batch sync. The phone app captured
 * crack photos + text while offline; when the network returns it pushes
 * the whole batch here. Each item runs the full ingest pipeline (zone
 * snap, VLM + heuristic pre-screen, fan-out) and returns per-item results.
 * Body: { deviceId, reports: SyncItem[] }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAppAuth(req);
    const { deviceId, reports } = await body<{ deviceId?: string; reports: SyncItem[] }>(req);
    if (!Array.isArray(reports) || reports.length === 0) throw new ApiError(400, 'reports[] required');
    if (reports.length > 25) throw new ApiError(400, 'Max 25 items per sync batch');

    const dev = deviceId ?? (auth.kind === 'device' ? auth.deviceId : null);
    const results: Array<Record<string, unknown>> = [];

    for (const item of reports) {
      try {
        let photoBuffer: Buffer | null = null;
        let photoMime = 'image/jpeg';
        if (item.photoDataUrl?.startsWith('data:')) {
          const m = item.photoDataUrl.match(/^data:([^;]+);base64,(.*)$/);
          if (m) {
            photoMime = m[1];
            photoBuffer = Buffer.from(m[2], 'base64');
          }
        }
        const r = await ingestReport({
          category: item.category,
          notes: item.notes ?? null,
          lat: item.lat,
          lon: item.lon,
          photoBuffer,
          photoMime,
          clientCreatedAt: new Date(item.clientCreatedAt),
          offlineQueued: true,
          deviceId: dev,
          submittedById: auth.kind === 'user' ? auth.user.id : null,
        });
        results.push({ ok: true, clientCreatedAt: item.clientCreatedAt, ...r });
      } catch (e) {
        results.push({ ok: false, clientCreatedAt: item.clientCreatedAt, error: (e as Error).message });
      }
    }

    const synced = results.filter((r) => r.ok).length;
    if (dev) await db.device.updateMany({ where: { deviceId: dev }, data: { lastSeenAt: new Date() } });

    return NextResponse.json({ ok: true, synced, failed: results.length - synced, results });
  } catch (e) {
    return fail(e);
  }
}
