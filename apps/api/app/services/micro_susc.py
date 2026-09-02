"""Micro-susceptibility (Model A v2) serving layer.

Two things:

1. ``load_micro_heatmap()`` -- the downsampled per-AOI percentile grids built
   by ``ml/models/micro_susceptibility.py`` (real terrarium DEM terrain),
   served by GET /api/v1/analytics/micro-heatmap.

2. ``refresh_zone_susceptibility()`` -- replaces the seed's hash-based
   pseudo-random zone susceptibility with REAL terrain statistics: every
   zone's polygon is intersected with its district heatmap grid and
   susc_mean / susc_p90 become the actual mean / 90th percentile of the
   micro-susceptibility index inside the zone. Model B (which reads
   susc_mean / susc_p90 through the I-D threshold bands and the fused
   probability) and the response-priority queue both pick the real values
   up on their next evaluation tick. Provenance is stamped on the zone's
   critical_infra JSONB under ``susc_model``.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

log = logging.getLogger("bhrakshak.micro_susc")

_FALLBACKS = [
    Path("/srv/ml/artifacts/micro_heatmap.json"),
    Path(__file__).resolve().parents[3] / "ml" / "artifacts" / "micro_heatmap.json",
    Path("ml/artifacts/micro_heatmap.json"),
]

_CACHED: tuple[float, dict] | None = None  # (mtime, payload)


def heatmap_path() -> Path | None:
    for p in _FALLBACKS:
        if p.exists():
            return p
    return None


def load_micro_heatmap() -> dict | None:
    """Parse + cache the artifact; reload when the file changes on disk."""
    global _CACHED
    path = heatmap_path()
    if path is None:
        return None
    mtime = path.stat().st_mtime
    if _CACHED is not None and _CACHED[0] == mtime:
        return _CACHED[1]
    try:
        payload = json.loads(path.read_text())
    except Exception as exc:  # noqa: BLE001 - artifact is developer-generated
        log.error("micro_heatmap.json unreadable at %s: %s", path, exc)
        return None
    _CACHED = (mtime, payload)
    return payload


def _aoi_for_bbox(payload: dict, lon: float, lat: float) -> dict | None:
    for hm in payload.values():
        minx, miny, maxx, maxy = hm["bbox"]
        if minx <= lon <= maxx and miny <= lat <= maxy:
            return hm
    return None


def _grid_cells_in_polygon(hm: dict, polygon) -> list[tuple[int, int]]:
    """Heatmap (row, col) cells whose centres fall inside the polygon."""
    from shapely.geometry import Point
    from shapely.prepared import prep

    minx, miny, maxx, maxy = hm["bbox"]
    h, w = hm["shape"]
    prepared = prep(polygon)
    lons = minx + (np.arange(w) + 0.5) / w * (maxx - minx)
    lats = maxy - (np.arange(h) + 0.5) / h * (maxy - miny)

    # zone bbox clipped to grid limits; lats are descending (row 0 = north)
    lo_c = int(np.clip(np.searchsorted(lons, polygon.bounds[0]) - 1, 0, w - 1))
    hi_c = int(np.clip(np.searchsorted(lons, polygon.bounds[2]) + 1, 0, w - 1))
    lo_r = int(np.clip(np.searchsorted(lats[::-1], polygon.bounds[3]) - 1, 0, h - 1))
    hi_r = int(np.clip(np.searchsorted(lats[::-1], polygon.bounds[1]) + 1, 0, h - 1))

    hits: list[tuple[int, int]] = []
    for r in range(h - 1 - hi_r, h - 1 - lo_r + 1):
        lat = lats[r]
        for c in range(lo_c, hi_c + 1):
            if prepared.covers(Point(lons[c], lat)):
                hits.append((r, c))
    return hits


def zone_susceptibility_from_grid(hm: dict, polygon) -> tuple[float, float] | None:
    """Mean / p90 of the micro index inside the zone polygon (0-100)."""
    vals_all = np.asarray(hm["values_u8"], dtype=np.float32)
    h, w = hm["shape"]
    vals2d = vals_all.reshape(h, w)

    hits = _grid_cells_in_polygon(hm, polygon)
    if hits:
        picked = np.array([vals2d[r, c] for r, c in hits], dtype=np.float64)
    else:
        # zone smaller than one heatmap cell: nearest-cell fallback
        from shapely.geometry import Point

        minx, miny, maxx, maxy = hm["bbox"]
        h_, w_ = hm["shape"]
        c = polygon.centroid
        col = int(np.clip((c.x - minx) / (maxx - minx) * w_, 0, w_ - 1))
        row = int(np.clip((maxy - c.y) / (maxy - miny) * h_, 0, h_ - 1))
        picked = np.array([vals2d[row, col]], dtype=np.float64)

    return float(picked.mean()), float(np.percentile(picked, 90))


async def refresh_zone_susceptibility(db, recompute: bool = False) -> dict:
    """Update every zone's susc_mean/susc_p90 from the micro heatmap grid.

    Returns a summary; per-zone failures are logged, not raised, so one bad
    geometry cannot blank the whole pass.
    """
    from shapely import wkb
    from sqlalchemy import select

    from app.models import Zone

    payload = load_micro_heatmap()
    if payload is None:
        return {
            "updated": 0, "skipped_no_artifact": True,
            "note": "micro_heatmap.json missing - run `python -m ml.ingest.dem_real` "
                    "then `python -m ml.models.micro_susceptibility`",
        }

    zones = (await db.execute(select(Zone))).scalars().all()
    version = next(iter(payload.values()), {}).get("model_version", "unknown")
    updated = 0
    failed = 0
    for zone in zones:
        try:
            polygon = wkb.loads(bytes(zone.geom.data))
        except Exception as exc:  # noqa: BLE001
            log.warning("zone %s: unreadable geometry (%s)", zone.zone_code, exc)
            failed += 1
            continue
        hm = _aoi_for_bbox(payload, polygon.centroid.x, polygon.centroid.y)
        if hm is None:
            failed += 1
            continue
        try:
            mean, p90 = zone_susceptibility_from_grid(hm, polygon)
        except Exception as exc:  # noqa: BLE001
            log.warning("zone %s: susceptibility sampling failed (%s)", zone.zone_code, exc)
            failed += 1
            continue
        zone.susc_mean = round(mean, 1)
        zone.susc_p90 = round(p90, 1)
        infra = dict(zone.critical_infra or {})
        infra["susc_model"] = version
        infra["susc_refreshed_at"] = datetime.now(timezone.utc).isoformat()
        zone.critical_infra = infra
        updated += 1
    await db.commit()

    out = {
        "updated": updated,
        "failed": failed,
        "total_zones": len(zones),
        "susc_model": version,
        "recompute_triggered": False,
    }
    if recompute and updated:
        try:
            from app.services.risk_engine import evaluate_all_zones

            await evaluate_all_zones(db)
            out["recompute_triggered"] = True
        except Exception as exc:  # noqa: BLE001
            log.warning("post-refresh risk recompute failed: %s", exc)
    return out
