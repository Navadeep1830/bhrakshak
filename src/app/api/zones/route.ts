import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { floodIndex, isolationScore } from '@/lib/risk-engine';

/**
 * GET /api/zones → GeoJSON FeatureCollection of all response zones with live
 * fused hazard state (this is what the map hexagons render).
 * Requires any authenticated session.
 */
export async function GET() {
  try {
    await requireSession();
    const zones = await db.zone.findMany({
      include: { riskCell: true },
      orderBy: { zoneCode: 'asc' },
    });

    // latest rainfall per zone (windowed to 7 days — only the newest row matters)
    const obs = await db.rainfallObs.findMany({
      where: { ts: { gte: new Date(Date.now() - 7 * 86400_000) } },
      orderBy: { ts: 'desc' },
      select: { zoneId: true, rain1h: true, rain24h: true, soilMoisture: true },
    });
    const rainByZone = new Map<string, { rain1h: number; rain24h: number; soil: number | null }>();
    for (const o of obs) {
      if (!rainByZone.has(o.zoneId)) {
        rainByZone.set(o.zoneId, { rain1h: o.rain1h, rain24h: o.rain24h, soil: o.soilMoisture });
      }
    }

    const features = zones.map((z) => {
      const level = z.riskCell?.hazardLevel ?? 0;
      const rain = rainByZone.get(z.id);
      const flood = floodIndex(rain?.rain1h ?? 0, rain?.rain24h ?? 0, rain?.soil ?? null);
      // top driver (real, from the ML driver breakdown — not a canned string)
      let topDriver: { name: string; sharePct: number } | null = null;
      try {
        const drivers = z.riskCell?.drivers ? (JSON.parse(z.riskCell.drivers) as Array<{ name: string; contribution: number }>) : [];
        const top = drivers[0];
        if (top) topDriver = { name: top.name.replace(/ \(.*\)$/, ''), sharePct: Math.round((top.contribution || 0) * 100) };
      } catch { /* drivers unparsable — leave null */ }
      return {
        type: 'Feature',
        id: z.zoneCode,
        geometry: { type: 'Polygon', coordinates: [JSON.parse(z.geom)] },
        properties: {
          zoneCode: z.zoneCode,
          name: z.name,
          district: z.district,
          state: z.state,
          hazardLevel: level,
          probability: z.riskCell?.probability ?? 0,
          suscMean: z.suscMean,
          suscP90: z.suscP90,
          population: z.population,
          roadKm: z.roadKm,
          criticalInfra: JSON.parse(z.criticalInfra || '{}'),
          centroidLat: z.centroidLat,
          centroidLon: z.centroidLon,
          rain1h: rain?.rain1h ?? 0,
          rain24h: rain?.rain24h ?? 0,
          soilMoisture: rain?.soil ?? null,
          floodLevel: flood,
          isolation: isolationScore(z.population, z.roadKm, z.zoneCode),
          topDriver,
          modelVersion: z.riskCell?.modelVersion ?? 'physical-prior-v1',
          updatedAt: z.riskCell?.updatedAt ?? null,
        },
      };
    });

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      generatedAt: new Date().toISOString(),
      engine: 'physical-prior-v1 (I-D thresholds + hysteresis fusion)',
    });
  } catch (e) {
    return fail(e);
  }
}
