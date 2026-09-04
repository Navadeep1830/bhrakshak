import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireAppAuth, ApiError } from '@/lib/auth';
import { injectConditions } from '@/lib/simulate';
import { createMessage } from '@/lib/messages-service';

/**
 * POST /api/app/gauge — manual rain-gauge reading from the FIELD.
 *
 * This is the citizen-side manual data upload: a field official in the
 * valley reads their gauge and submits real numbers (mm). The reading is
 * written as genuine RainfallObs rows through injectConditions() and the
 * PRODUCTION risk engine runs over it — same thresholds, hysteresis, alert
 * + SMS fan-out as any other telemetry. No presets, no canned data.
 *
 * Body: { zoneCode? | lat, lon, rain1h, rain24h?, rain72h?, soilMoisture? }
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAppAuth(req);
    const input = await body<{
      zoneCode?: string;
      lat?: number;
      lon?: number;
      rain1h: number;
      rain24h?: number;
      rain72h?: number;
      soilMoisture?: number;
    }>(req);

    const rain1h = Number(input.rain1h);
    if (!Number.isFinite(rain1h)) throw new ApiError(400, 'rain1h (mm) required');

    // resolve zone: explicit code, else nearest to the position
    let zoneCode = input.zoneCode ?? null;
    let district: string | null = null;
    if (!zoneCode) {
      if (typeof input.lat !== 'number' || typeof input.lon !== 'number') {
        throw new ApiError(400, 'zoneCode or lat/lon required');
      }
      const zones = await db.zone.findMany({
        select: { zoneCode: true, district: true, centroidLat: true, centroidLon: true },
      });
      let bestKm = Infinity;
      for (const z of zones) {
        const R = 6371;
        const dLat = ((input.lat - z.centroidLat) * Math.PI) / 180;
        const dLon = ((input.lon - z.centroidLon) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((z.centroidLat * Math.PI) / 180) * Math.cos((input.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
        const d = 2 * R * Math.asin(Math.sqrt(a));
        if (d < bestKm) { bestKm = d; zoneCode = z.zoneCode; district = z.district; }
      }
    }
    if (!zoneCode) throw new ApiError(404, 'no zone near this position');

    const zone = await db.zone.findUnique({ where: { zoneCode }, select: { district: true, name: true } });

    // real engine pass with the field official's numbers
    const report = await injectConditions({
      district: zone?.district ?? district,
      zoneCode,
      rain1h,
      rain24h: input.rain24h ?? rain1h * 6,
      rain72h: input.rain72h ?? null,
      soilMoisture: input.soilMoisture ?? null,
      hours: 1,
      label: 'field-gauge',
    });

    // log it in the command inbox too — the gauge reading is a field message
    let authorName = 'Field official';
    let devId: string | null = null; // Device row id (FK)
    if (auth.kind === 'device') {
      const dev = await db.device.findUnique({ where: { deviceId: auth.deviceId } });
      if (dev) { devId = dev.id; authorName = dev.name; district = district ?? dev.district; }
    } else {
      authorName = auth.user.fullName;
      district = district ?? auth.user.district;
    }

    const escalated = report.escalated;
    await createMessage({
      deviceId: devId,
      authorName,
      authorRole: 'field',
      district: zone?.district ?? district,
      category: 'gauge',
      body: `Rain-gauge reading at ${zoneCode}${zone ? ` (${zone.name})` : ''}: ${Math.round(rain1h)} mm/1h` +
        `${input.rain24h ? `, ${Math.round(input.rain24h)} mm/24h` : ''}` +
        `${input.soilMoisture != null ? `, soil ${Math.round(input.soilMoisture * 100)}%` : ''}.` +
        ` Engine pass: ${escalated} zone${escalated === 1 ? '' : 's'} escalated, ${report.alertsFired} alert${report.alertsFired === 1 ? '' : 's'} fired.`,
      priority: escalated > 0 ? 1 : 0,
      zoneCode,
    });

    return NextResponse.json({
      ok: true,
      zoneCode,
      zoneName: zone?.name ?? null,
      district: zone?.district ?? district,
      escalated: report.escalated,
      alertsFired: report.alertsFired,
      notifications: report.notifications,
      sms: report.sms,
      maxLevel: report.maxLevel,
    });
  } catch (e) {
    return fail(e);
  }
}
