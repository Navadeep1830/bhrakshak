/**
 * Shared citizen-report ingestion — used by the website field form, the
 * phone app live upload (multipart) and the offline-queue sync (base64).
 *
 * Pipeline: snap to nearest zone → heuristic pre-screen (+ VLM photo
 * pre-screen when a photo is attached) → persist report + photo asset →
 * fan out notifications/SMS when the AI flags it.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { createId } from '@/lib/utils-id';
import { db } from '@/lib/db';
import { preScreenPhoto } from '@/lib/vision';
import { fanOutReportFlagged } from '@/lib/notify';
import { haversineKm } from '@/lib/evacuation';

const UPLOAD_DIR = path.join(process.cwd(), 'upload');
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export const REPORT_CATEGORIES = ['crack', 'slope_movement', 'blocked_road', 'past_slide', 'water_seepage'] as const;

export interface IngestInput {
  category: string;
  notes?: string | null;
  lat: number;
  lon: number;
  photoBuffer?: Buffer | null;
  photoMime?: string | null;
  clientCreatedAt?: Date | null;
  offlineQueued?: boolean;
  deviceId?: string | null;
  submittedById?: string | null;
}

export interface IngestResult {
  id: string;
  category: string;
  zoneCode: string | null;
  zoneName: string | null;
  distanceKm: number;
  aiPreScreen: string;
  aiConfidence: number;
  aiSource: string;
  aiFindings: string | null;
  photoId: string | null;
  fanOut: { notifications: number; sms: number } | null;
}

async function savePhoto(buffer: Buffer, mime: string): Promise<string> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const filename = `${createId()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return filename;
}

/** text heuristic — Model V-style deterministic pre-screen */
async function heuristicScreen(zone: { id: string; suscMean: number } | null, notes: string | null) {
  const nearby = zone
    ? await db.citizenReport.count({
        where: { zoneId: zone.id, status: 'verified', createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } },
      })
    : 0;
  const detailed = !!notes && notes.length > 60;
  const flagged = nearby >= 1 || (zone != null && zone.suscMean >= 75) || detailed;
  const confidence = Math.round((0.5 + Math.min(nearby, 3) * 0.12 + (zone ? zone.suscMean / 400 : 0) + (detailed ? 0.08 : 0)) * 100) / 100;
  return { flagged, confidence: Math.min(confidence, 0.97) };
}

/**
 * Ingest one report. `photoDataUrl` variant is handled by the caller
 * (routes decode base64 → photoBuffer).
 */
export async function ingestReport(input: IngestInput): Promise<IngestResult> {
  if (!REPORT_CATEGORIES.includes(input.category as any)) {
    throw new Error(`category must be one of ${REPORT_CATEGORIES.join(', ')}`);
  }
  if (typeof input.lat !== 'number' || typeof input.lon !== 'number' || Math.abs(input.lat) > 90 || Math.abs(input.lon) > 180) {
    throw new Error('Valid lat/lon required');
  }

  // nearest zone by centroid distance
  const zones = await db.zone.findMany({ select: { id: true, zoneCode: true, name: true, district: true, centroidLat: true, centroidLon: true, suscMean: true } });
  let best: (typeof zones)[number] | null = null;
  let bestKm = Infinity;
  for (const z of zones) {
    const d = haversineKm(input.lat, input.lon, z.centroidLat, z.centroidLon);
    if (d < bestKm) {
      bestKm = d;
      best = z;
    }
  }

  // pre-screen: heuristic always; VLM when a photo is attached
  const heur = await heuristicScreen(best, input.notes ?? null);
  let flagged = heur.flagged;
  let confidence = heur.confidence;
  let aiSource = 'heuristic';
  let findings: string | null = null;
  let severity: string | null = null;

  if (input.photoBuffer && input.photoBuffer.length > 0) {
    if (input.photoBuffer.length > MAX_PHOTO_BYTES) throw new Error('Photo exceeds 8 MB limit');
    const mime = input.photoMime || 'image/jpeg';
    const dataUrl = `data:${mime};base64,${input.photoBuffer.toString('base64')}`;
    const vision = await preScreenPhoto(dataUrl);
    if (vision) {
      flagged = flagged || vision.flagged;
      confidence = Math.round(Math.max(confidence, vision.confidence) * 100) / 100;
      aiSource = 'vision+heuristic';
      findings = vision.findings;
      severity = vision.severity;
    }
  }

  const report = await db.citizenReport.create({
    data: {
      zoneId: best?.id ?? null,
      category: input.category,
      notes: input.notes?.slice(0, 2000) ?? null,
      lat: input.lat,
      lon: input.lon,
      aiPreScreen: flagged ? 'flagged' : 'ok',
      aiConfidence: confidence,
      aiSource,
      aiFindings: findings,
      status: 'pending',
      submittedById: input.submittedById ?? null,
      deviceId: input.deviceId ?? null,
      clientCreatedAt: input.clientCreatedAt ?? null,
      offlineQueued: input.offlineQueued ?? false,
    },
  });

  let photoId: string | null = null;
  if (input.photoBuffer && input.photoBuffer.length > 0) {
    const filename = await savePhoto(input.photoBuffer, input.photoMime || 'image/jpeg');
    const asset = await db.mediaAsset.create({
      data: {
        reportId: report.id,
        filename,
        mime: input.photoMime || 'image/jpeg',
        bytes: input.photoBuffer.length,
      },
    });
    photoId = asset.id;
  }

  // fan out when the AI flags it — citizen photos ARE early detection
  let fanOut: { notifications: number; sms: number } | null = null;
  if (flagged && confidence >= 0.5) {
    try {
      fanOut = await fanOutReportFlagged({
        zoneCode: best?.zoneCode ?? null,
        district: best?.district ?? null,
        confidence,
        findings,
        severity,
        reportId: report.id,
        reportTitle: `AI flagged: ${input.category.replace('_', ' ')} reported${best ? ` near ${best.name}` : ''}`,
      });
    } catch (e) {
      console.error('[notify] report fan-out failed', e);
    }
  }

  return {
    id: report.id,
    category: report.category,
    zoneCode: best?.zoneCode ?? null,
    zoneName: best?.name ?? null,
    distanceKm: Math.round(bestKm * 100) / 100,
    aiPreScreen: flagged ? 'flagged' : 'ok',
    aiConfidence: confidence,
    aiSource,
    aiFindings: findings,
    photoId,
    fanOut,
  };
}
