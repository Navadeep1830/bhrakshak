/**
 * Next.js instrumentation — auto-seed on server boot.
 *
 * A fresh clone (empty SQLite file) seeds itself the first time the dev
 * server starts, so localhost opens with the exact same live state as the
 * hosted preview. Runs once per server process; failures are non-fatal.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { ensureSeeded } = await import('@/lib/seed-core');
    await ensureSeeded();
  } catch (e) {
    console.warn(
      '[instrumentation] auto-seed skipped — run `npm run db:push && npm run seed` once:',
      (e as Error).message
    );
  }
}
