/**
 * Idempotent seed core — shared by `scripts/seed.ts` (CLI) and the
 * instrumentation hook (auto-seed on server boot). A fresh clone with an
 * empty database seeds itself on first start, so localhost opens exactly
 * as alive as the hosted preview: 621 zones, users, shelters, roads,
 * sensors, 48 h rainfall history and a live monsoon state.
 */
import { buildZones, PILOT_DISTRICTS, sha256Int } from './hex-grid';
import { hashPassword } from './auth';
import { I18N_TEMPLATES } from './risk-engine';
import { evaluateAllZones } from './engine';
import { db } from './db';

export const DEMO_USERS: Array<{ email: string; fullName: string; role: string; district: string | null; pw: string }> = [
  { email: 'admin@bhrakshak.in', fullName: 'Platform Admin', role: 'admin', district: null, pw: 'Admin@123' },
  { email: 'dc.aizawl@bhrakshak.in', fullName: 'DC Aizawl', role: 'district_admin', district: 'Aizawl', pw: 'District@123' },
  { email: 'dc.ekh@bhrakshak.in', fullName: 'DC East Khasi Hills', role: 'district_admin', district: 'East Khasi Hills', pw: 'District@123' },
  { email: 'dc.imphalwest@bhrakshak.in', fullName: 'DC Imphal West', role: 'district_admin', district: 'Imphal West', pw: 'District@123' },
  { email: 'field.noney@bhrakshak.in', fullName: 'Field Official Noney', role: 'field_official', district: 'Noney', pw: 'Field@123' },
  { email: 'citizen@bhrakshak.in', fullName: 'Demo Citizen', role: 'citizen', district: 'Aizawl', pw: 'Citizen@123' },
];

const SHELTERS: Array<{
  name: string; district: string; lat: number; lon: number; type: string;
  capacity: number; occupancy: number; medical: boolean; slopeDeg: number; distSlope: number;
}> = [
  { name: 'Aizawl Civil Relief Camp', district: 'Aizawl', lat: 23.7271, lon: 92.7179, type: 'relief_camp', capacity: 1200, occupancy: 210, medical: true, slopeDeg: 8, distSlope: 720 },
  { name: 'Zemabawk Community Hall', district: 'Aizawl', lat: 23.7519, lon: 92.7236, type: 'community_hall', capacity: 400, occupancy: 60, medical: false, slopeDeg: 11, distSlope: 480 },
  { name: 'Tanhril School Shelter', district: 'Aizawl', lat: 23.7729, lon: 92.6946, type: 'school', capacity: 600, occupancy: 95, medical: false, slopeDeg: 6, distSlope: 640 },
  { name: 'Shillong Indoor Stadium Camp', district: 'East Khasi Hills', lat: 25.5788, lon: 91.8933, type: 'relief_camp', capacity: 2000, occupancy: 340, medical: true, slopeDeg: 5, distSlope: 810 },
  { name: 'Sohra Community Shelter', district: 'East Khasi Hills', lat: 25.2779, lon: 91.7248, type: 'community_hall', capacity: 350, occupancy: 82, medical: false, slopeDeg: 14, distSlope: 260 },
  { name: 'Mawphlang School Hall', district: 'East Khasi Hills', lat: 25.4457, lon: 91.7497, type: 'school', capacity: 450, occupancy: 51, medical: false, slopeDeg: 9, distSlope: 560 },
  { name: 'Noney Town Relief Camp', district: 'Noney', lat: 24.9887, lon: 93.6838, type: 'relief_camp', capacity: 800, occupancy: 150, medical: true, slopeDeg: 12, distSlope: 380 },
  { name: 'Longmai Community Hall', district: 'Noney', lat: 25.0167, lon: 93.7200, type: 'community_hall', capacity: 300, occupancy: 44, medical: false, slopeDeg: 10, distSlope: 450 },
  { name: 'Imphal West District Camp', district: 'Imphal West', lat: 24.8074, lon: 93.9398, type: 'relief_camp', capacity: 1500, occupancy: 190, medical: true, slopeDeg: 3, distSlope: 900 },
  { name: 'Lamphel School Shelter', district: 'Imphal West', lat: 24.8170, lon: 93.9200, type: 'school', capacity: 500, occupancy: 65, medical: false, slopeDeg: 4, distSlope: 700 },
  { name: 'Gangtok Indoor Stadium Camp', district: 'Gangtok', lat: 27.3320, lon: 88.6120, type: 'relief_camp', capacity: 1800, occupancy: 260, medical: true, slopeDeg: 7, distSlope: 690 },
  { name: 'Tadong Community Shelter', district: 'Gangtok', lat: 27.3512, lon: 88.6300, type: 'community_hall', capacity: 420, occupancy: 58, medical: false, slopeDeg: 9, distSlope: 520 },
];

const ROADS: Array<{ name: string; district: string; coords: Array<[number, number]>; status: string }> = [
  { name: 'NH-54 Aizawl corridor', district: 'Aizawl', coords: [[92.62, 23.6], [92.72, 23.74], [92.85, 23.86]], status: 'open' },
  { name: 'NH-6 Shillong–Sohra', district: 'East Khasi Hills', coords: [[91.58, 25.52], [91.7, 25.42], [91.72, 25.28]], status: 'watch' },
  { name: 'NH-37 Jiribam–Imphal', district: 'Noney', coords: [[93.68, 24.92], [93.8, 24.98], [93.95, 24.9]], status: 'open' },
  { name: 'NH-10 Sikkim corridor', district: 'Gangtok', coords: [[88.48, 27.3], [88.56, 27.42], [88.62, 27.55]], status: 'open' },
  { name: 'Old Haflong–Noney road', district: 'Noney', coords: [[93.55, 24.98], [93.62, 25.04], [93.68, 25.1]], status: 'blocked' },
];

function prand(seed: string): number {
  return (sha256Int(seed) % 10000) / 10000;
}

let seeding: Promise<void> | null = null;

/** Ensure the database holds the full demo state (idempotent, safe to re-run). */
export function ensureSeeded(): Promise<void> {
  if (!seeding) {
    seeding = seedNow().catch((e) => {
      seeding = null; // allow retry on next call after a failure
      throw e;
    });
  }
  return seeding;
}

async function seedNow(): Promise<void> {
  const zoneCount = await db.zone.count();
  if (zoneCount > 0) return; // already seeded

  console.log('[seed] empty database detected — seeding BhuRakshak demo state…');

  // 1) hex zones
  const zones = buildZones(PILOT_DISTRICTS);
  for (const z of zones) {
    await db.zone.create({
      data: {
        zoneCode: z.zoneCode,
        name: z.name,
        district: z.district,
        state: z.state,
        geom: JSON.stringify(z.ring),
        centroidLat: z.centroidLat,
        centroidLon: z.centroidLon,
        radiusKm: 3.0,
        suscMean: z.suscMean,
        suscP90: z.suscP90,
        population: z.population,
        roadKm: z.roadKm,
        criticalInfra: JSON.stringify(z.criticalInfra),
      },
    });
  }
  console.log(`[seed] ${zones.length} hex zones across ${PILOT_DISTRICTS.length} districts`);

  // 2) users
  for (const u of DEMO_USERS) {
    await db.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email, fullName: u.fullName, role: u.role, district: u.district,
        hashedPassword: await hashPassword(u.pw),
      },
      update: {},
    });
  }

  // 3) i18n templates
  for (const [key, tpl] of Object.entries(I18N_TEMPLATES)) {
    const [msgKey, lang] = key.split('|');
    await db.i18nTemplate.upsert({
      where: { key_lang: { key: msgKey, lang } },
      create: { key: msgKey, lang, template: tpl },
      update: {},
    });
  }

  // 4) shelters + 5) roads
  if ((await db.shelter.count()) === 0) {
    for (const s of SHELTERS) {
      await db.shelter.create({
        data: {
          name: s.name, district: s.district, lat: s.lat, lon: s.lon,
          shelterType: s.type, capacity: s.capacity, occupancy: s.occupancy,
          hasMedical: s.medical, slopeDeg: s.slopeDeg, distToSlopeM: s.distSlope,
        },
      });
    }
  }
  if ((await db.roadStatus.count()) === 0) {
    for (const r of ROADS) {
      await db.roadStatus.create({
        data: { roadName: r.name, district: r.district, coords: JSON.stringify(r.coords), status: r.status, source: 'seed' },
      });
    }
  }

  // 6) baseline rainfall + sensors + realistic monsoon state
  const zoneRows = await db.zone.findMany();
  const now = Date.now();
  for (const z of zoneRows) {
    const p = prand(z.zoneCode);
    const districtStormy =
      z.district === 'East Khasi Hills' ? 1.0 :
      z.district === 'Noney' ? 0.55 :
      z.district === 'Aizawl' ? 0.2 : 0.05;
    for (let hAgo = 48; hAgo >= 1; hAgo--) {
      const recent = hAgo <= 10 ? (10 - hAgo) / 10 : 0;
      const intensity = p * districtStormy * (0.3 + 0.7 * recent);
      const rain1h = Math.round(intensity * 34 * 10) / 10;
      const rain24h = Math.round(intensity * 165 * 10) / 10;
      await db.rainfallObs.create({
        data: {
          zoneId: z.id,
          ts: new Date(now - hAgo * 3600_000),
          rain1h,
          rain24h,
          rain48h: Math.round(rain24h * 1.25 * 10) / 10,
          rain72h: Math.round(rain24h * 1.42 * 10) / 10,
          rain7d: Math.round(rain24h * 1.9 * 10) / 10,
          effRain: Math.round(rain24h * 0.62 * 10) / 10,
          soilMoisture: Math.round(Math.min(92, 38 + intensity * 48 + p * 8) * 10) / 10,
          source: 'poll',
        },
      });
    }
    if (sha256Int(z.zoneCode + 's') % 3 === 0) {
      await db.sensorReading.create({
        data: {
          zoneId: z.id,
          ts: new Date(now - 1800_000),
          soilMoisture: Math.round((44 + prand(z.zoneCode + 'm') * 40) * 10) / 10,
          tiltDeg: Math.round(prand(z.zoneCode + 't') * 24 * 10) / 10,
          rainMm: Math.round(prand(z.zoneCode + 'r') * 20 * 10) / 10,
          battery: Math.round((60 + prand(z.zoneCode + 'b') * 38) * 10) / 10,
        },
      });
    }
  }

  // first engine pass → live hazard levels + alerts + SMS fan-out
  await evaluateAllZones({ tickCount: 3 });

  // starter citizen reports
  const ekh = await db.zone.findMany({ where: { district: 'East Khasi Hills' }, take: 3 });
  const noney = await db.zone.findMany({ where: { district: 'Noney' }, take: 2 });
  const citizen = await db.user.findUnique({ where: { email: 'citizen@bhrakshak.in' } });
  const fieldOff = await db.user.findUnique({ where: { email: 'field.noney@bhrakshak.in' } });
  const demoReports: Array<{ zoneId: string; category: string; notes: string; dLat: number; dLon: number; status: string; uid: string | null }> = [];
  ekh.forEach((z, i) => demoReports.push({
    zoneId: z.id, category: 'crack', notes: 'Wide tension crack near the school slope edge, widening since yesterday.',
    dLat: z.centroidLat + 0.02 * (i + 1), dLon: z.centroidLon + 0.02 * (i + 1), status: i === 0 ? 'verified' : 'pending', uid: citizen?.id ?? null,
  }));
  if (noney[0]) demoReports.push({
    zoneId: noney[0].id, category: 'slope_movement', notes: 'Bulge visible on the cut slope above NH-37; soil creeping downhill.',
    dLat: noney[0].centroidLat, dLon: noney[0].centroidLon + 0.01, status: 'verified', uid: fieldOff?.id ?? null,
  });
  if (noney[1]) demoReports.push({
    zoneId: noney[1].id, category: 'water_seepage', notes: 'Muddy water seeping at the slope base after last night rain.',
    dLat: noney[1].centroidLat - 0.015, dLon: noney[1].centroidLon, status: 'pending', uid: citizen?.id ?? null,
  });
  for (const r of demoReports) {
    await db.citizenReport.create({
      data: {
        zoneId: r.zoneId, category: r.category, notes: r.notes,
        lat: r.dLat, lon: r.dLon, status: r.status, submittedById: r.uid,
        aiPreScreen: r.status === 'verified' ? 'ok' : 'pending',
        aiConfidence: r.status === 'verified' ? 0.87 : 0.5,
        verifiedAt: r.status === 'verified' ? new Date() : null,
      },
    });
  }

  console.log(`[seed] complete: ${zoneRows.length} zones · login admin@bhrakshak.in / Admin@123`);
}
