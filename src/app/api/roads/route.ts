import { NextRequest, NextResponse } from 'next/server';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';
import { enrichRoadsWithDetours } from '@/lib/roads';

/**
 * GET /api/roads → road network status board with live corridor hazard
 * (ML-predicted blockage) and synthesised alternative routes (detours).
 */
export async function GET() {
  try {
    await requireSession();
    const roads = await enrichRoadsWithDetours();
    return NextResponse.json({
      roads,
      engine: 'corridor-hazard-v1 (fused zone hazard → predicted blockage + A*-style bypass synthesis)',
    });
  } catch (e) {
    return fail(e);
  }
}
