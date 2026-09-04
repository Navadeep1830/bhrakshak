import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireSession, ApiError } from '@/lib/auth';


/**
 * POST /api/ingest/sensor — IoT sensor HTTP ingest (MQTT bridge fallback).
 * Body: { zoneCode, soilMoisture?, tiltDeg?, rainMm?, battery? }
 */
export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const { zoneCode, soilMoisture, tiltDeg, rainMm, battery } = await body<{
      zoneCode: string;
      soilMoisture?: number;
      tiltDeg?: number;
      rainMm?: number;
      battery?: number;
    }>(req);
    if (!zoneCode) throw new ApiError(400, 'zoneCode required');

    const zone = await db.zone.findUnique({ where: { zoneCode: zoneCode.toUpperCase() } });
    if (!zone) throw new ApiError(404, `Unknown zone ${zoneCode}`);

    const reading = await db.sensorReading.create({
      data: {
        zoneId: zone.id,
        soilMoisture: soilMoisture ?? null,
        tiltDeg: tiltDeg ?? null,
        rainMm: rainMm ?? null,
        battery: battery ?? null,
      },
    });

    // a rainfall reading also feeds the rainfall series so the engine sees it
    if (typeof rainMm === 'number' && rainMm > 0) {
      const recent = await db.rainfallObs.findFirst({
        where: { zoneId: zone.id },
        orderBy: { ts: 'desc' },
      });
      await db.rainfallObs.create({
        data: {
          zoneId: zone.id,
          ts: new Date(),
          rain1h: rainMm,
          rain24h: Math.round(((recent?.rain24h ?? 0) + rainMm) * 10) / 10,
          rain48h: recent?.rain48h ?? null,
          rain72h: recent?.rain72h ?? null,
          rain7d: recent?.rain7d ?? null,
          effRain: recent?.effRain ?? null,
          soilMoisture: soilMoisture ?? recent?.soilMoisture ?? null,
          source: 'sim',
        },
      });
    }

    return NextResponse.json({ ok: true, readingId: reading.id, zoneCode: zone.zoneCode });
  } catch (e) {
    return fail(e);
  }
}

export const dynamic = 'force-dynamic';
