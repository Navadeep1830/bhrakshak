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

interface SyncMessage {
  clientCreatedAt: string;
  category: string;
  body: string;
  lat?: number | null;
  lon?: number | null;
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
    const { deviceId, reports, messages } = await body<{
      deviceId?: string;
      reports?: SyncItem[];
      messages?: SyncMessage[];
    }>(req);
    if ((!Array.isArray(reports) || reports.length === 0) && (!Array.isArray(messages) || messages.length === 0)) {
      throw new ApiError(400, 'reports[] or messages[] required');
    }
    if ((reports?.length ?? 0) > 25) throw new ApiError(400, 'Max 25 items per sync batch');
    if ((messages?.length ?? 0) > 50) throw new ApiError(400, 'Max 50 messages per sync batch');

    const dev = deviceId ?? (auth.kind === 'device' ? auth.deviceId : null);
    const results: Array<Record<string, unknown>> = [];

    // ── queued field messages (SOS etc. captured while offline) ──
    let devName = 'Field official';
    let devDistrict: string | null = null;
    let devRowId: string | null = null; // Device row id (FK)
    if (dev) {
      const d = await db.device.findUnique({ where: { deviceId: dev } });
      if (d) { devName = d.name; devDistrict = d.district; devRowId = d.id; }
    } else if (auth.kind === 'user') {
      devName = auth.user.fullName;
      devDistrict = auth.user.district;
    }
    for (const m of messages ?? []) {
      try {
        const { createMessage } = await import('@/lib/messages-service');
        const msg = await createMessage({
          deviceId: devRowId,
          authorName: devName,
          authorRole: 'field',
          district: devDistrict,
          category: m.category,
          body: m.body,
          lat: m.lat ?? null,
          lon: m.lon ?? null,
        });
        results.push({ ok: true, kind: 'message', clientCreatedAt: m.clientCreatedAt, id: msg.id });
      } catch (e) {
        results.push({ ok: false, kind: 'message', clientCreatedAt: m.clientCreatedAt, error: (e as Error).message });
      }
    }

    for (const item of reports ?? []) {
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

    return NextResponse.json({
      ok: true,
      synced,
      failed: results.length - synced,
      reportsSynced: (reports?.length ?? 0) > 0 ? results.filter((r) => r.ok && r.kind !== 'message').length : undefined,
      messagesSynced: (messages?.length ?? 0) > 0 ? results.filter((r) => r.ok && r.kind === 'message').length : undefined,
      results,
    });
  } catch (e) {
    return fail(e);
  }
}
