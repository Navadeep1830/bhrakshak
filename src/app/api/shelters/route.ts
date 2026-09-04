import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';

/**
 * GET /api/shelters → evacuation shelter registry.
 */
export async function GET() {
  try {
    await requireSession();
    const shelters = await db.shelter.findMany({ orderBy: { name: 'asc' } });
    return NextResponse.json({ shelters });
  } catch (e) {
    return fail(e);
  }
}
