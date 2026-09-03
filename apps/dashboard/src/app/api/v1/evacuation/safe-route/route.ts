// GET /api/v1/evacuation/safe-route?lat=&lon=[&population=] —
// hazard-avoiding route from the nearest zone to the best shelter
// (public — citizens need it most). Accepts lat/lon (the live FastAPI
// contract); ?zone=CODE still works for older callers.
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/server/store";
import { safeRoute } from "@/lib/server/evacuation";
import { haversineKm } from "@/lib/server/rng";

export async function GET(req: NextRequest) {
  const store = getStore();
  const sp = req.nextUrl.searchParams;
  let code = sp.get("zone");
  if (!code) {
    const lat = Number(sp.get("lat"));
    const lon = Number(sp.get("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      let best: { code: string; d: number } | null = null;
      for (const z of store.zones) {
        const d = haversineKm([lon, lat], z.center);
        if (!best || d < best.d) best = { code: z.zone_code, d };
      }
      code = best?.code ?? null;
    }
  }
  if (!code) return NextResponse.json({ detail: "lat/lon (or zone) required" }, { status: 422 });
  const out = safeRoute(store, code);
  if (!out) return NextResponse.json({ detail: "Zone not found" }, { status: 404 });
  return NextResponse.json(out);
}
