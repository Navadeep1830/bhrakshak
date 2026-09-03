"""GeoJSON endpoints for the Command Center map (live parity with the demo).

The dashboard consumes /api/v1/geo/{zones,roads,reports} as GeoJSON
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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models import CitizenReport, RiskCell, RoadStatus, Zone

router = APIRouter(prefix="/geo", tags=["geo"])


def _feature(props: dict[str, Any], geom) -> dict:
    return {"type": "Feature", "properties": props, "geometry": mapping(to_shape(geom))}


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
