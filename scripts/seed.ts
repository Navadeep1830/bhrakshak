/**
 * BhuRakshak idempotent seed (CLI wrapper around src/lib/seed-core.ts).
 * Run: bunx tsx scripts/seed.ts   (or: npm run seed)
 */
import { ensureSeeded } from '../src/lib/seed-core';
import { db } from '../src/lib/db';

async function main() {
  await ensureSeeded();
  const zones = await db.zone.count();
  const alerts = await db.alert.count();
  console.log(`Seed check complete: ${zones} zones, ${alerts} alerts, ${await db.rainfallObs.count()} rainfall rows.`);
  console.log('Login: admin@bhrakshak.in / Admin@123');
}

main()
  .catch((e) => {
    console.error('SEED FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
