import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  let zones = await db.zone.count();
  if (zones === 0) {
    // lazy auto-seed: covers the case where the DB was pushed after boot
    try {
      const { ensureSeeded } = await import('@/lib/seed-core');
      await ensureSeeded();
      zones = await db.zone.count();
    } catch { /* instrumentation reports the setup hint */ }
  }
  return NextResponse.json(
    {
      status: 'ok',
      engine: 'bhrakshak-v3',
      zones,
      time: new Date().toISOString(),
    },
    {
      // CORS: lets the Android app's connect screen (a local asset page)
      // probe this endpoint before switching the WebView to /mobile.
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
      },
    },
  );
}

export const dynamic = 'force-dynamic';
