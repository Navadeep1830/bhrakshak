import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { enrichRoadsWithDetours } from '@/lib/roads';

/**
 * GET /api/kpis → live command-center KPIs (computed, never hardcoded).
 */
export async function GET() {
  try {
    await requireSession();
    const [zones, activeAlerts, l3plus, pendingReports, verifiedReports, sensors, roads, checkins] =
      await Promise.all([
        db.zone.findMany({ include: { riskCell: true } }),
        db.alert.count({ where: { status: 'active' } }),
        db.riskCell.count({ where: { hazardLevel: { gte: 3 } } }),
        db.citizenReport.count({ where: { status: 'pending' } }),
        db.citizenReport.count({ where: { status: 'verified' } }),
        db.sensorReading.findMany({ orderBy: { ts: 'desc' }, take: 500 }),
        enrichRoadsWithDetours(),
        db.safeCheckin.count({ where: { createdAt: { gte: new Date(Date.now() - 86400_000) } } }),
      ]);

    // roads blocked = live corridor-hazard view (DB status + ML-predicted blockage)
    const roadsBlocked = roads.filter((r) => r.status === 'blocked').length;
    const detoursActive = roads.filter((r) => r.detour?.available).length;

    const popAtRisk = zones
      .filter((z) => (z.riskCell?.hazardLevel ?? 0) >= 3)
      .reduce((s, z) => s + z.population, 0);
    const exposed = zones
      .filter((z) => (z.riskCell?.hazardLevel ?? 0) >= 2)
      .reduce((s, z) => s + z.population, 0);

    const recentSensorSet = new Set<string>();
    for (const s of sensors) {
      if (!recentSensorSet.has(s.zoneId)) recentSensorSet.add(s.zoneId);
    }

    const [sms24h, devicesOnline] = await Promise.all([
      db.smsMessage.count({ where: { queuedAt: { gte: new Date(Date.now() - 86400_000) } } }),
      db.device.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 70_000) } } }),
    ]);

    return NextResponse.json({
      zonesTotal: zones.length,
      populationMonitored: zones.reduce((s, z) => s + z.population, 0),
      populationAtRiskL3: popAtRisk,
      populationExposedL2: exposed,
      activeAlerts,
      l3plusZones: l3plus,
      pendingReports,
      verifiedReports,
      sensorsOnline: recentSensorSet.size,
      roadsBlocked,
      detoursActive,
      checkins24h: checkins,
      smsSent24h: sms24h,
      devicesOnline,
      districts: [...new Set(zones.map((z) => z.district))].length,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}
