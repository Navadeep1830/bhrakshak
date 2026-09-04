import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail } from '@/lib/api';
import { requireSession } from '@/lib/auth';

interface DriverRow {
  feature: string;
  name: string;
  contribution: number;
  description?: string;
}

/**
 * GET /api/factors?district= — landslide driver aggregation for the Risk
 * Explorer: average driver contribution (normalised to %) across zones in
 * scope, plus per-district hazard summaries. This is the "what factors
 * are driving the landslide risk, and by how much" answer.
 */
export async function GET(req: NextRequest) {
  try {
    await requireSession();
    const district = new URL(req.url).searchParams.get('district');

    const zones = await db.zone.findMany({
      where: district ? { district } : undefined,
      select: {
        zoneCode: true, name: true, district: true, population: true, suscMean: true,
        centroidLat: true, centroidLon: true,
        riskCell: { select: { hazardLevel: true, probability: true, drivers: true } },
      },
    });

    // ── aggregate driver contributions (weighted by zone population) ──
    const acc = new Map<string, { feature: string; name: string; desc: string; weighted: number; weight: number; max: number }>();
    for (const z of zones) {
      if (!z.riskCell) continue;
      const w = Math.max(1, Math.log10(10 + z.population));
      let drivers: DriverRow[] = [];
      try {
        drivers = JSON.parse(z.riskCell.drivers) as DriverRow[];
      } catch {
        continue;
      }
      for (const d of drivers) {
        const key = d.feature ?? d.name;
        const cur = acc.get(key) ?? { feature: key, name: d.name, desc: d.description ?? '', weighted: 0, weight: 0, max: 0 };
        cur.weighted += (d.contribution || 0) * w;
        cur.weight += w;
        cur.max = Math.max(cur.max, d.contribution || 0);
        cur.name = d.name;
        if (d.description) cur.desc = d.description;
        acc.set(key, cur);
      }
    }
    const agg = [...acc.values()].map((a) => ({
      feature: a.feature,
      name: a.name,
      description: a.desc,
      avgContribution: a.weight ? Math.round((a.weighted / a.weight) * 100) / 100 : 0,
      peakContribution: Math.round(a.max * 100) / 100,
    }));
    const total = agg.reduce((s, a) => s + a.avgContribution, 0) || 1;
    const factors = agg
      .map((a) => ({ ...a, sharePct: Math.round((a.avgContribution / total) * 1000) / 10 }))
      .sort((a, b) => b.sharePct - a.sharePct);

    // ── per-district summaries ──
    const byDistrict = new Map<string, { district: string; zones: number; levels: number[]; population: number; atRiskL3: number; avgSusc: number; suscW: number; worst: { zoneCode: string; name: string; level: number; probability: number } | null }>();
    for (const z of zones) {
      const d = byDistrict.get(z.district) ?? {
        district: z.district, zones: 0, levels: [0, 0, 0, 0, 0], population: 0, atRiskL3: 0, avgSusc: 0, suscW: 0, worst: null,
      };
      const lvl = z.riskCell?.hazardLevel ?? 0;
      d.zones++;
      d.levels[lvl]++;
      d.population += z.population;
      if (lvl >= 3) d.atRiskL3 += z.population;
      d.avgSusc += z.suscMean * z.population;
      d.suscW += z.population;
      if (!d.worst || lvl > d.worst.level || (lvl === d.worst.level && (z.riskCell?.probability ?? 0) > d.worst.probability)) {
        d.worst = { zoneCode: z.zoneCode, name: z.name, level: lvl, probability: z.riskCell?.probability ?? 0 };
      }
      byDistrict.set(z.district, d);
    }
    const districts = [...byDistrict.values()]
      .map((d) => ({
        district: d.district,
        zones: d.zones,
        levels: d.levels,
        l3plus: d.levels[3] + d.levels[4],
        l4: d.levels[4],
        population: d.population,
        atRiskL3: d.atRiskL3,
        avgSusc: d.suscW ? Math.round(d.avgSusc / d.suscW) : 0,
        worst: d.worst,
      }))
      .sort((a, b) => b.l3plus - a.l3plus || b.atRiskL3 - a.atRiskL3);

    return NextResponse.json({
      scope: district ?? 'Northeast Region (all districts)',
      zones: zones.length,
      factors,
      districts,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return fail(e);
  }
}
