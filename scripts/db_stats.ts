/** Quick DB stats for the ELI5 explanation — grounded numbers only. */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:' + process.cwd() + '/db/custom.db' } },
});

async function main() {
  const zones = await db.zone.groupBy({ by: ['district'], _count: true, orderBy: { district: 'asc' } });
  const totalZones = await db.zone.count();
  const rainfall = await db.rainfallObs.count();
  const alerts = await db.alert.count();
  const sensors = await db.sensorReading.count();
  const reports = await db.citizenReport.count();
  const messages = await db.fieldMessage.count();
  const devices = await db.device.count();
  const shelters = await db.shelter.count();
  const roads = await db.roadStatus.count();
  const snapshots = await db.riskSnapshot.count();
  const runs = await db.modelRun.count();
  const riskCells = await db.riskCell.count();
  const levels = await db.riskCell.groupBy({ by: ['hazardLevel'], _count: true });

  console.log('zones by district:', zones.map((z) => `${z.district}=${z._count}`).join(' | '));
  console.log('totalZones:', totalZones);
  console.log('rainfallObs:', rainfall);
  console.log('alerts:', alerts);
  console.log('sensorReadings:', sensors);
  console.log('citizenReports:', reports);
  console.log('fieldMessages:', messages);
  console.log('devices:', devices);
  console.log('shelters:', shelters);
  console.log('roads:', roads);
  console.log('riskSnapshots:', snapshots);
  console.log('modelRuns:', runs);
  console.log('riskCells:', riskCells);
  console.log('hazardLevel distribution:', levels.map((l) => `L${l.hazardLevel}=${l._count}`).join(' | '));

  // hex area math verification (pointy-top, R = 3.0 km circumradius)
  const R = 3.0;
  const width = Math.sqrt(3) * R;
  const height = 2 * R;
  const area = (3 * Math.sqrt(3) / 2) * R * R;
  console.log(`hex width flat-to-flat: ${width.toFixed(2)} km, height vertex-to-vertex: ${height.toFixed(1)} km, area: ${area.toFixed(2)} km2`);
  console.log(`total coverage approx: ${(area * totalZones).toFixed(0)} km2 over 5 districts`);

  // sample zone to show what a zone row actually looks like
  const sample = await db.zone.findFirst({ where: { zoneCode: 'ML-EKH-001' } });
  if (sample) {
    console.log('sample ML-EKH-001:', JSON.stringify({
      zoneCode: sample.zoneCode, name: sample.name, district: sample.district,
      suscMean: sample.suscMean, suscP90: sample.suscP90,
      population: sample.population, roadKm: sample.roadKm, criticalInfra: sample.criticalInfra,
    }));
  }
  const latest = await db.rainfallObs.findFirst({ where: { zone: { zoneCode: 'ML-EKH-001' } }, orderBy: { ts: 'desc' } });
  if (latest) {
    console.log('latest obs ML-EKH-001:', JSON.stringify({
      rain1h: latest.rain1h, rain24h: latest.rain24h, rain72h: latest.rain72h,
      rain7d: latest.rain7d, soilMoisture: latest.soilMoisture, source: latest.source,
    }));
  }
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
