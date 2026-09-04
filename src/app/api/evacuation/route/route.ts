import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fail, body } from '@/lib/api';
import { requireSession, ApiError } from '@/lib/auth';
import { planEvacuation, haversineKm, shelterSafetyScore } from '@/lib/evacuation';

/**
 * POST /api/evacuation/route — A* hazard-weighted safest-route to the best
 * shelter, plus ranked alternatives. THE alternate-route feature.
 * Body: { lat, lon, district?: string }
 */
export async function POST(req: NextRequest) {
  try {
    await requireSession();
    const { lat, lon, district } = await body<{ lat: number; lon: number; district?: string }>(req);
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      throw new ApiError(400, 'lat and lon required');
    }

    // hazard field context: zones within ~15 km of the origin
    const zones = await db.zone.findMany({
      where: district ? { district } : undefined,
      include: { riskCell: true },
    });
    const zoneRows = zones
      .map((z) => ({
        zoneCode: z.zoneCode,
        name: z.name,
        centroidLat: z.centroidLat,
        centroidLon: z.centroidLon,
        hazardLevel: z.riskCell?.hazardLevel ?? 0,
        suscMean: z.suscMean,
        radiusKm: z.radiusKm,
      }))
      .filter((z) => haversineKm(lat, lon, z.centroidLat, z.centroidLon) < 16);

    // shelters in the caller's district or nearby districts
    const allShelters = await db.shelter.findMany();
    const nearShelters = allShelters
      .map((s) => ({
        ...s,
        km: haversineKm(lat, lon, s.lat, s.lon),
      }))
      .filter((s) => s.km < 40)
      .sort((a, b) => shelterSafetyScore(b, b.km) - shelterSafetyScore(a, a.km))
      .slice(0, 8);

    const plan = planEvacuation(
      lat,
      lon,
      zoneRows,
      nearShelters.map(({ km, ...s }) => s)
    );
    if ('error' in plan) return NextResponse.json(plan, { status: 400 });

    return NextResponse.json({
      ...plan,
      shelters: nearShelters.map((s) => ({
        id: s.id,
        name: s.name,
        district: s.district,
        lat: s.lat,
        lon: s.lon,
        shelterType: s.shelterType,
        capacity: s.capacity,
        occupancy: s.occupancy,
        free: Math.max(0, s.capacity - s.occupancy),
        hasMedical: s.hasMedical,
        safety: shelterSafetyScore(s, s.km),
        distanceKm: Math.round(s.km * 100) / 100,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
