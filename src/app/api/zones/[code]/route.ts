import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import {
  buildDrivers,
  floodIndex,
  isolationScore,
  recommendedAction,
  generateDcDirective,
  LEVEL_NAMES,
  physicalProb,
  thresholdTier,
} from '@/lib/risk-engine';

/**
 * GET /api/zones/[code] → full dossier: zone meta, rainfall series (48 h),
 * driver breakdown (SHAP-style), alerts, verified reports, latest sensors,
 * flood/isolation, DC directive SOP.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await requireSession();
    const { code } = await params;
    const zone = await db.zone.findUnique({
      where: { zoneCode: code.toUpperCase() },
      include: { riskCell: true },
    });
    if (!zone) return NextResponse.json({ error: 'Zone not found' }, { status: 404 });

    const [rain, alerts, reports, sensors] = await Promise.all([
      db.rainfallObs.findMany({
        where: { zoneId: zone.id },
        orderBy: { ts: 'desc' },
        take: 48,
      }),
      db.alert.findMany({
        where: { zoneId: zone.id },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      db.citizenReport.findMany({
        where: { zoneId: zone.id },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      db.sensorReading.findMany({
        where: { zoneId: zone.id },
        orderBy: { ts: 'desc' },
        take: 12,
      }),
    ]);

    const latest = rain[0] ?? null;
    const level = zone.riskCell?.hazardLevel ?? 0;
    const prob = latest
      ? physicalProb(latest.rain1h, latest.rain24h, zone.suscP90)
      : 0;
    const drivers = latest
      ? buildDrivers(
          latest.rain1h,
          latest.rain24h,
          latest.rain72h,
          latest.rain7d,
          latest.soilMoisture,
          zone.suscP90,
          false,
          zone.zoneCode
        )
      : [];
    const flood = floodIndex(latest?.rain1h ?? 0, latest?.rain24h ?? 0, latest?.soilMoisture ?? null);
    const iso = isolationScore(zone.population, zone.roadKm, zone.zoneCode);
    const tier = thresholdTier(latest?.rain1h ?? 0, latest?.rain24h ?? 0, zone.suscMean);

    return NextResponse.json({
      zone: {
        zoneCode: zone.zoneCode,
        name: zone.name,
        district: zone.district,
        state: zone.state,
        centroidLat: zone.centroidLat,
        centroidLon: zone.centroidLon,
        suscMean: zone.suscMean,
        suscP90: zone.suscP90,
        population: zone.population,
        roadKm: zone.roadKm,
        criticalInfra: JSON.parse(zone.criticalInfra || '{}'),
      },
      hazard: {
        level,
        levelName: LEVEL_NAMES[level],
        probability: Math.round(prob * 10000) / 10000,
        idThresholdTier: tier,
        floodLevel: flood,
        isolation: iso,
        recommendedAction: recommendedAction(Math.max(level, flood), iso),
        modelVersion: zone.riskCell?.modelVersion ?? 'physical-prior-v1',
        updatedAt: zone.riskCell?.updatedAt ?? null,
      },
      drivers,
      rainfall: rain
        .slice()
        .reverse()
        .map((r) => ({
          ts: r.ts,
          rain1h: r.rain1h,
          rain24h: r.rain24h,
          soilMoisture: r.soilMoisture,
        })),
      alerts: alerts.map((a) => ({
        id: a.id,
        level: a.level,
        title: a.title,
        message: a.message,
        status: a.status,
        channels: JSON.parse(a.channels || '[]'),
        createdAt: a.createdAt,
      })),
      reports: reports.map((r) => ({
        id: r.id,
        category: r.category,
        notes: r.notes,
        status: r.status,
        lat: r.lat,
        lon: r.lon,
        createdAt: r.createdAt,
      })),
      sensors: sensors.map((s) => ({
        ts: s.ts,
        soilMoisture: s.soilMoisture,
        tiltDeg: s.tiltDeg,
        rainMm: s.rainMm,
        battery: s.battery,
      })),
      directive: generateDcDirective(zone.name, zone.district, level, prob, zone.population),
    });
  } catch (e) {
    return fail(e);
  }
}
