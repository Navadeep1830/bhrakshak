"""GeoJSON endpoints for the Command Center map (live parity with the demo).

The dashboard consumes /api/v1/geo/{zones,roads,reports,ops,radar} as GeoJSON
FeatureCollections whose property contract matches the dashboard's
built-in demo API exactly — so the same frontend runs unchanged against
the standalone demo instance OR this backend with real PostGIS data
(the Martin vector-tile path stays available for heavy clients).

DB-free by design: when Postgres is unreachable the endpoints return
deterministic demo FeatureCollections instead of 500s (same pattern as
zones.py / mesh.py), so the map keeps working on venue WiFi.
"""
from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, Depends
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.roads import BLOCKING_STATUSES, CORRIDOR_PROFILES, _haversine_km, calculate_debris_clearance_estimate
from app.db.session import get_db
from app.models import CitizenReport, RainfallObs, RiskCell, RoadStatus, Zone

router = APIRouter(prefix="/geo", tags=["geo"])


def _feature(props: dict[str, Any], geom) -> dict:
    return {"type": "Feature", "properties": props, "geometry": mapping(to_shape(geom))}


def _raw_feature(props: dict[str, Any], geom: dict) -> dict:
    return {"type": "Feature", "properties": props, "geometry": geom}


# ----------------------------------------------------------------- zones
@router.get("/zones")
async def geo_zones(
    district: str | None = None,
    horizon: int = 0,  # accepted for contract parity; live projection via recompute
    db: AsyncSession | None = Depends(get_db),
):
    """Hex risk zones as GeoJSON (hazard fill + outline + click dossier)."""
    if db is not None:
        try:
            q = select(RiskCell, Zone).join(Zone, RiskCell.zone_id == Zone.id, isouter=True)
            if district:
                q = q.where(RiskCell.district == district)
            rows = (await db.execute(q)).all()
            features = []
            for cell, zone in rows:
                props = {
                    "zone_id": str(cell.zone_id),
                    "zone_code": cell.zone_code,
                    "name": cell.name,
                    "district": cell.district,
                    "state": cell.state,
                    "hazard_level": cell.hazard_level,
                    "prob_24h": cell.prob_24h,
                    "susc_mean": zone.susc_mean if zone else None,
                    "susc_p90": zone.susc_p90 if zone else None,
                    "population": zone.population if zone else None,
                    "road_km": zone.road_km if zone else None,
                    "creep_mm_year": (zone.critical_infra or {}).get("creep_mm_year", 0)
                    if zone and isinstance(zone.critical_infra, dict)
                    else 0,
                }
                features.append(_feature(props, cell.geom))
            if features:
                return {"type": "FeatureCollection", "features": features}
        except Exception:
            pass  # DB hiccup — fall through to the demo shapes
    return _demo_zone_fc(district)


# ----------------------------------------------------------------- roads
@router.get("/roads")
async def geo_roads(db: AsyncSession | None = Depends(get_db)):
    """Road corridor status as GeoJSON LineStrings (blocked / watch / open)."""
    if db is not None:
        try:
            rows = (await db.execute(select(RoadStatus))).scalars().all()
            features = [
                _feature(
                    {
                        "osm_way_id": r.osm_way_id,
                        "name": r.road_name,
                        "status": (
                            "blocked" if r.status in ("confirmed_blocked", "predicted_blocked")
                            else "watch" if r.status == "risk"
                            else "open"
                        ),
                        "delay_min": r.delay_min,
                    },
                    r.segment_geom,
                )
                for r in rows
            ]
            if features:
                return {"type": "FeatureCollection", "features": features}
        except Exception:
            pass
    return {"type": "FeatureCollection", "features": []}


# ----------------------------------------------------------------- reports
@router.get("/reports")
async def geo_reports(db: AsyncSession | None = Depends(get_db)):
    """Citizen / field reports as GeoJSON Points (verified / pending)."""
    if db is not None:
        try:
            rows = (await db.execute(select(CitizenReport))).scalars().all()
            features = []
            for r in rows:
                if r.geom is None:
                    continue
                features.append(
                    _feature(
                        {
                            "id": str(r.id),
                            "status": r.status,
                            "type": r.category,
                            "note": (r.description or "")[:140],
                        },
                        r.geom,
                    )
                )
            return {"type": "FeatureCollection", "features": features}
        except Exception:
            pass
    return {"type": "FeatureCollection", "features": []}


# ----------------------------------------------------------------- ops overlay
# Staging base coordinates for the corridors (the names live in
# CORRIDOR_PROFILES; coordinates are pinned here so the map can draw them).
_STAGING_COORDS = {
    "NH-29": (93.87, 25.755),
    "NH-102": (94.02, 24.52),
    "NH-6": (92.20, 25.45),
}


def _ops_demo_fc() -> dict:
    """Deterministic ops overlay: detours, blockages, staging (DB-free)."""
    features = []
    for corridor, prof in CORRIDOR_PROFILES.items():
        est = calculate_debris_clearance_estimate(corridor)
        wps = [list(w) for w in prof["bypass_waypoints"]]
        # detour delay = extra travel time on the bypass itself (hill-road
        # average ~26 km/h + turnaround overhead), NOT the clearance ETA
        bypass_km = sum(
            _haversine_km(a[1], a[0], b[1], b[0]) for a, b in zip(wps, wps[1:])
        )
        delay_min = int(round(bypass_km / 26.0 * 60 + 20))
        features.append(_raw_feature(
            {
                "type": "detour_route",
                "name": f"{corridor} Emergency Bypass",
                "corridor": corridor,
                "delay": f"+{delay_min} min",
                "staging": prof["default_staging"],
            },
            {"type": "LineString", "coordinates": wps},
        ))
        # blockage sits at the choke point (first leg midpoint)
        bx = (wps[0][0] + wps[1][0]) / 2
        by = (wps[0][1] + wps[1][1]) / 2
        features.append(_raw_feature(
            {
                "type": "blockage",
                "name": f"{corridor} landslide choke point",
                "corridor": corridor,
                "eta": f"Clearance ETA: {est.full_reopening_eta_hours} h",
                "debris_m3": est.estimated_debris_volume_m3,
            },
            {"type": "Point", "coordinates": [round(bx, 4), round(by, 4)]},
        ))
        sx, sy = _STAGING_COORDS.get(corridor, (wps[0][0], wps[0][1]))
        features.append(_raw_feature(
            {
                "type": "machinery_base",
                "name": prof["default_staging"],
                "corridor": corridor,
                "jcb_count": 4 if corridor == "NH-102" else 2,
            },
            {"type": "Point", "coordinates": [round(sx, 4), round(sy, 4)]},
        ))
    return {"type": "FeatureCollection", "features": features}


@router.get("/ops")
async def geo_ops(db: AsyncSession | None = Depends(get_db)):
    """Operational overlay: active detours, blockage points, machinery staging.

    Live: blocked RoadStatus segments (with geometry) replace the demo
    choke points; detours come from the calibrated corridor profiles.
    """
    fc = _ops_demo_fc()
    if db is not None:
        try:
            rows = (
                await db.execute(select(RoadStatus).where(RoadStatus.status.in_(BLOCKING_STATUSES)))
            ).scalars().all()
            live_blockages = []
            for r in rows:
                if r.segment_geom is None:
                    continue
                line = to_shape(r.segment_geom)
                pt = line.interpolate(0.5, normalized=True)
                live_blockages.append(_raw_feature(
                    {
                        "type": "blockage",
                        "name": f"{r.road_name or 'Road ' + str(r.osm_way_id)} — {r.status.replace('_', ' ')}",
                        "corridor": (r.road_name or "").upper()[:5],
                        "eta": f"Clearance ETA: {(r.delay_min or 240) / 60:.1f} h",
                        "debris_m3": None,
                    },
                    {"type": "Point", "coordinates": [round(pt.x, 5), round(pt.y, 5)]},
                ))
            if live_blockages:
                # swap the demo choke points for real ones
                fc["features"] = [
                    f for f in fc["features"] if f["properties"]["type"] != "blockage"
                ] + live_blockages
        except Exception:
            pass  # DB hiccup — demo overlay already in place
    return fc


# ----------------------------------------------------------------- radar cells
_DEMO_RAIN_CELLS = [
    (62.0, "Sohra cloudburst cell", 91.72, 25.27, 0.13, 0.08),
    (48.0, "Tupul convective band", 93.68, 24.81, 0.11, 0.09),
    (36.0, "Aizawl ridge downpour", 92.72, 23.76, 0.08, 0.09),
    (42.0, "Kohima-Zubza cell", 94.09, 25.67, 0.09, 0.08),
]


def _cell_polygon(cx: float, cy: float, w: float, h: float) -> list:
    return [[
        [round(cx - w, 5), round(cy - h, 5)],
        [round(cx + w, 5), round(cy - h, 5)],
        [round(cx + w, 5), round(cy + h, 5)],
        [round(cx - w, 5), round(cy + h, 5)],
        [round(cx - w, 5), round(cy - h, 5)],
    ]]


def _radar_demo_fc() -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            _raw_feature(
                {"intensity_mm_h": i, "name": n, "kind": "rain_cell"},
                {"type": "Polygon", "coordinates": _cell_polygon(x, y, w, h)},
            )
            for i, n, x, y, w, h in _DEMO_RAIN_CELLS
        ],
    }


@router.get("/radar")
async def geo_radar(db: AsyncSession | None = Depends(get_db)):
    """Rainfall radar cells as GeoJSON polygons, sized by intensity.

    Live: latest rain_1h per zone (Timescale) drawn as cells over the zone
    centroid; only cells with rain_1h >= 5 mm/h. Falls back to the
    calibrated demo storm cells when the DB is unreachable.
    """
    if db is not None:
        try:
            latest = (
                select(RainfallObs.zone_id, func.max(RainfallObs.ts).label("ts"))
                .group_by(RainfallObs.zone_id)
                .subquery()
            )
            rows = (
                await db.execute(
                    select(RainfallObs.rain_1h, RiskCell.name, RiskCell.zone_code, RiskCell.geom)
                    .join(latest, (RainfallObs.zone_id == latest.c.zone_id) & (RainfallObs.ts == latest.c.ts))
                    .join(RiskCell, RainfallObs.zone_id == RiskCell.zone_id)
                    .where(RainfallObs.rain_1h >= 5.0)
                )
            ).all()
            features = []
            for rain_1h, name, zone_code, geom in rows:
                centroid = to_shape(geom).centroid
                w = 0.035 + (rain_1h or 0) * 0.0008
                features.append(_raw_feature(
                    {
                        "intensity_mm_h": round(float(rain_1h or 0), 1),
                        "name": f"Rain cell — {name}",
                        "kind": "rain_cell",
                        "zone_code": zone_code,
                    },
                    {"type": "Polygon", "coordinates": _cell_polygon(centroid.x, centroid.y, w, w * 0.75)},
                ))
            if features:
                return {"type": "FeatureCollection", "features": features}
        except Exception:
            pass
    return _radar_demo_fc()


# ----------------------------------------------------------------- demo fallback
_DEMO_DISTRICTS = [
    ("MH-EKH", "East Khasi Hills", 91.88, 25.52),
    ("MN-NON", "Noney", 93.58, 24.90),
    ("MZ-AIZ", "Aizawl", 92.72, 23.73),
]


def _hex_ring(cx: float, cy: float, r: float) -> list[list[float]]:
    pts = []
    for k in range(6):
        a = math.pi / 3 * k
        pts.append([round(cx + r * math.cos(a), 5), round(cy + r * 0.82 * math.sin(a), 5)])
    pts.append(pts[0])
    return [pts]


def _demo_zone_fc(district: str | None) -> dict:
    features = []
    for code, dname, cx, cy in _DEMO_DISTRICTS:
        if district and dname != district:
            continue
        for i in range(6):
            ox, oy = (i % 3 - 1) * 0.055, (i // 3 - 0.5) * 0.09
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "zone_id": f"{code}-{i + 1:03d}",
                        "zone_code": f"{code}-{i + 1:03d}",
                        "name": f"{dname} hex {i + 1}",
                        "district": dname,
                        "state": "NER",
                        "hazard_level": max(0, min(4, i - 2)),
                        "prob_24h": 0.1 + 0.12 * i,
                        "susc_mean": 40 + 6 * i,
                        "susc_p90": 60 + 5 * i,
                        "population": 500 + 300 * i,
                        "road_km": 2 + i,
                        "creep_mm_year": 5 + 3 * i,
                    },
                    "geometry": {"type": "Polygon", "coordinates": _hex_ring(cx + ox, cy + oy, 0.03)},
                }
            )
    return {"type": "FeatureCollection", "features": features}
