import { NextRequest, NextResponse } from 'next/server';
import { fail } from '@/lib/api';
import { requireRoles } from '@/lib/auth';
import { evaluateAllZones } from '@/lib/engine';

/**
 * POST /api/demo/tick — run one evaluation tick over all zones (no rain
 * injection). Refreshes risk cells, drivers and snapshots; alerts only
 * fire on genuine level transitions.
 */
export async function POST(req: NextRequest) {
  try {
    await requireRoles('admin');
    const results = await evaluateAllZones({ tickCount: 1 });
    return NextResponse.json({
      ok: true,
      zones: results.length,
      escalated: results.filter((r) => r.escalated).length,
      deescalated: results.filter((r) => r.deescalated).length,
    });
  } catch (e) {
    return fail(e);
  }
}
