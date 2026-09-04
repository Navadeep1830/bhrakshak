import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireRoles, ApiError } from '@/lib/auth';
import { evaluateAllZones } from '@/lib/engine';

/**
 * POST /api/demo/storm — admin demo control: inject a synthetic monsoon
 * storm cell over a district, then run the real risk engine (2 ticks) so
 * zones escalate through genuine I-D thresholds + hysteresis.
 * Body: { district: string, peakMmPerH?: number (default 34), hours?: number (default 6) }
 */
export async function POST(req: NextRequest) {
  try {
    await requireRoles('admin', 'district_admin');
    const { district, peakMmPerH, hours } = await body<{
      district: string;
      peakMmPerH?: number;
      hours?: number;
    }>(req);
    if (!district) throw new ApiError(400, 'district required');

    const peak = Math.min(Math.max(peakMmPerH ?? 34, 5), 80);
    const hrs = Math.min(Math.max(hours ?? 6, 1), 12);

    const zones = await db.zone.findMany({ where: { district } });
    if (!zones.length) throw new ApiError(404, `No zones for district "${district}"`);

    // ramp rainfall: each of the last `hrs` hours gets an escalating amount,
    // update rolling windows honestly from the seeded history
    const now = Date.now();
    for (const z of zones) {
      const recent = await db.rainfallObs.findMany({
        where: { zoneId: z.id },
        orderBy: { ts: 'desc' },
        take: 72,
      });
      const prev24 = recent[0]?.rain24h ?? 0;
      const prev72 = recent[0]?.rain72h ?? prev24 * 1.42;
      const prev7d = recent[0]?.rain7d ?? prev24 * 1.9;
      const prevEff = recent[0]?.effRain ?? prev24 * 0.62;
      const prevSoil = recent[0]?.soilMoisture ?? 55;

      for (let h = hrs; h >= 1; h--) {
        const ramp = (hrs - h + 1) / hrs; // 1/n → 1
        const rain1h = Math.round(peak * ramp * 10) / 10;
        const add24 = rain1h;
        const rain24h = Math.round(Math.min((prev24 * 0.96 + add24) * 1.18, 320) * 10) / 10;
        const effRain = Math.round((prevEff * 0.96 + rain1h * 0.62) * 10) / 10;
        await db.rainfallObs.create({
          data: {
            zoneId: z.id,
            ts: new Date(now - (h - 1) * 1800_000),
            rain1h,
            rain24h,
            rain48h: Math.round(rain24h * 1.25 * 10) / 10,
            rain72h: Math.round(Math.max(prev72 * 0.97 + add24, rain24h * 1.4) * 10) / 10,
            rain7d: Math.round(Math.max(prev7d * 0.985 + add24, rain24h * 1.9) * 10) / 10,
            effRain,
            soilMoisture: Math.round(Math.min(96, prevSoil * 0.97 + rain1h * 0.45 + 1) * 10) / 10,
            source: 'storm',
          },
        });
      }
    }

    // real engine, two ticks so hysteresis escalates immediately (same as reference)
    const t0 = new Date();
    const results = await evaluateAllZones({ tickCount: 2 });
    const affected = results.filter((r) => r.escalated && r.newLevel >= 2);

    // comms fan-out happened inside the engine — report the counts
    const [notificationsSent, smsSent] = await Promise.all([
      db.notificationEvent.count({ where: { createdAt: { gte: t0 } } }),
      db.smsMessage.count({ where: { queuedAt: { gte: t0 } } }),
    ]);

    return NextResponse.json({
      ok: true,
      district,
      zonesUpdated: zones.length,
      escalatedToL2plus: affected.length,
      maxLevel: results.reduce((m, r) => Math.max(m, r.newLevel), 0),
      notificationsSent,
      smsSent,
      escalationSummary: {
        toL2: results.filter((r) => r.escalated && r.newLevel === 2).length,
        toL3: results.filter((r) => r.escalated && r.newLevel === 3).length,
        toL4: results.filter((r) => r.escalated && r.newLevel === 4).length,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
