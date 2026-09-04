import { NextRequest, NextResponse } from 'next/server';
import { fail } from '@/lib/api';
import { requireAppAuth, ApiError } from '@/lib/auth';
import { ingestReport } from '@/lib/reports-service';

/**
 * POST /api/app/report — phone app live report with photo (multipart/form-data).
 * Fields: category, notes, lat, lon, deviceId?, clientCreatedAt? (iso),
 * offlineQueued? ('1'), photo (file, optional).
 * Runs the full pipeline: zone snap → VLM + heuristic pre-screen →
 * notification/SMS fan-out when flagged.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAppAuth(req);
    const form = await req.formData().catch(() => null);
    if (!form) throw new ApiError(400, 'multipart/form-data body required');

    const category = String(form.get('category') ?? '');
    const notes = form.get('notes') != null ? String(form.get('notes')) : null;
    const lat = Number(form.get('lat'));
    const lon = Number(form.get('lon'));
    const deviceId = form.get('deviceId') != null ? String(form.get('deviceId')) : auth.kind === 'device' ? auth.deviceId : null;
    const clientCreatedAt = form.get('clientCreatedAt') != null ? new Date(String(form.get('clientCreatedAt'))) : null;
    const offlineQueued = String(form.get('offlineQueued') ?? '') === '1';

    let photoBuffer: Buffer | null = null;
    let photoMime: string | null = null;
    const photo = form.get('photo');
    if (photo && typeof photo !== 'string') {
      photoBuffer = Buffer.from(await photo.arrayBuffer());
      photoMime = photo.type || 'image/jpeg';
    }

    const result = await ingestReport({
      category,
      notes,
      lat,
      lon,
      photoBuffer,
      photoMime,
      clientCreatedAt: clientCreatedAt && !Number.isNaN(clientCreatedAt.getTime()) ? clientCreatedAt : null,
      offlineQueued,
      deviceId,
      submittedById: auth.kind === 'user' ? auth.user.id : null,
    });

    return NextResponse.json({ ok: true, report: result });
  } catch (e) {
    return fail(e);
  }
}
