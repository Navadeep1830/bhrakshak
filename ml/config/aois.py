"""Single source of truth for Areas of Interest.

Every ingest, feature and model module MUST import its geometry from here.
Hardcoding a latitude/longitude outside this file is a review blocker: the
whole point is that the pilot footprint can change (or grow to more NER
districts) without touching a line of model code.

The AOI polygons are read from ``data/pilot_districts.geojson`` at import time.
Override the path with the ``BHURAKSHAK_DISTRICTS_FILE`` environment variable
when running outside the repo root (e.g. inside a container).

Usage:
    from ml.config.aois import get_aoi, all_aois, ner_bbox

    aoi = get_aoi("MN-NON")          # by district code
    aoi = get_aoi("Noney")           # or by district name
    aoi.centroid                     # -> (lat, lon)
    aoi.bbox                         # -> (minx, miny, maxx, maxy) == (minlon, minlat, maxlon, maxlat)
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DISTRICTS_FILE = REPO_ROOT / "data" / "pilot_districts.geojson"


def districts_file() -> Path:
    """Resolve the AOI polygon file (env override first)."""
    override = os.environ.get("BHURAKSHAK_DISTRICTS_FILE")
    return Path(override) if override else DEFAULT_DISTRICTS_FILE


def _slug(value: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in value.strip().lower()).strip("_")


@dataclass(frozen=True)
class AOI:
    """One pilot district / Area of Interest."""

    code: str                       # e.g. "MN-NON"
    district: str                   # e.g. "Noney"
    state: str                      # e.g. "Manipur"
    state_code: str                 # e.g. "MN"
    context: str                    # why this district is in the pilot
    geometry: dict[str, Any]        # raw GeoJSON geometry
    centroid: tuple[float, float]   # (lat, lon) -- area-weighted approx via bbox centre
    bbox: tuple[float, float, float, float]  # (minlon, minlat, maxlon, maxlat)
    slug: str = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "slug", _slug(self.district))

    # -- convenience ------------------------------------------------------
    @property
    def lat(self) -> float:
        return self.centroid[0]

    @property
    def lon(self) -> float:
        return self.centroid[1]

    @property
    def bbox_str(self) -> str:
        """Comma-separated bbox, the form most tile/DEM APIs expect."""
        return ",".join(f"{v:.5f}" for v in self.bbox)

    def contains(self, lat: float, lon: float) -> bool:
        """Point-in-AOI test. Prefers Shapely; falls back to bbox test."""
        try:
            from shapely.geometry import shape

            return bool(shape(self.geometry).contains(__import__("shapely").geometry.Point(lon, lat)))
        except Exception:
            minlon, minlat, maxlon, maxlat = self.bbox
            return minlat <= lat <= maxlat and minlon <= lon <= maxlon

    def as_feature(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "properties": {
                "district": self.district,
                "state": self.state,
                "state_code": self.state_code,
                "code": self.code,
                "context": self.context,
                "slug": self.slug,
            },
            "geometry": self.geometry,
        }


def _centroid_and_bbox(geometry: dict[str, Any]) -> tuple[tuple[float, float], tuple[float, float, float, float]]:
    """Polygon centroid + bbox without requiring the geospatial stack.

    Uses the polygon-area-weighted centroid when Shapely is available and
    degrades to the bbox centre otherwise, so AOI loading never hard-fails on
    a machine without wheels for Shapely/GEOS.
    """
    rings = geometry.get("coordinates") or []
    if geometry.get("type") == "Polygon":
        rings = rings[:1]
    elif geometry.get("type") == "MultiPolygon":
        rings = [poly[0] for poly in rings]

    pts = [(float(x), float(y)) for ring in rings for x, y in ring]
    if not pts:
        raise ValueError("AOI geometry has no coordinates")

    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    bbox = (min(lons), min(lats), max(lons), max(lats))

    try:
        from shapely.geometry import shape

        c = shape(geometry).centroid
        centroid = (round(float(c.y), 6), round(float(c.x), 6))
    except Exception:
        centroid = (round((bbox[1] + bbox[3]) / 2, 6), round((bbox[0] + bbox[2]) / 2, 6))
    return centroid, bbox


def load_aois(path: Path | None = None) -> list[AOI]:
    """Load AOIs from the district GeoJSON. Deterministic order == file order."""
    src = path or districts_file()
    if not src.exists():
        raise FileNotFoundError(
            f"AOI file not found: {src}. Set BHURAKSHAK_DISTRICTS_FILE or restore data/pilot_districts.geojson."
        )
    data = json.loads(src.read_text(encoding="utf-8"))
    out: list[AOI] = []
    for feat in data.get("features", []):
        props = feat.get("properties", {}) or {}
        geometry = feat.get("geometry") or {}
        centroid, bbox = _centroid_and_bbox(geometry)
        out.append(
            AOI(
                code=props["code"],
                district=props["district"],
                state=props.get("state", ""),
                state_code=props.get("state_code", ""),
                context=props.get("context", ""),
                geometry=geometry,
                centroid=centroid,
                bbox=bbox,
            )
        )
    return out


_AOIS: list[AOI] | None = None


def all_aois(force_reload: bool = False) -> list[AOI]:
    """Cached load of every AOI."""
    global _AOIS
    if _AOIS is None or force_reload:
        _AOIS = load_aois()
    return _AOIS


def aoi_codes() -> list[str]:
    return [a.code for a in all_aois()]


def get_aoi(key: str) -> AOI:
    """Look up an AOI by district code or district name (case/format tolerant)."""
    target = _slug(key)
    for a in all_aois():
        if _slug(a.code) == target or _slug(a.district) == target:
            return a
    raise KeyError(f"Unknown AOI {key!r}. Known: {aoi_codes()}")


def ner_bbox(pad_deg: float = 0.0) -> tuple[float, float, float, float]:
    """Bounding box covering every AOI, optionally padded."""
    boxes = [a.bbox for a in all_aois()]
    return (
        min(b[0] for b in boxes) - pad_deg,
        min(b[1] for b in boxes) - pad_deg,
        max(b[2] for b in boxes) + pad_deg,
        max(b[3] for b in boxes) + pad_deg,
    )


def iter_aois(names: Iterator[str] | list[str] | None = None) -> Iterator[AOI]:
    """Yield AOIs, optionally restricted to a subset of codes/names."""
    if not names:
        yield from all_aois()
        return
    for n in names:
        yield get_aoi(n)


# --- domain constants shared by feature engineering -------------------------
# Indian summer monsoon over the North Eastern Region. Kept here (not in a
# model file) because both the rainfall features and the label generation need
# to agree on what "monsoon" means.
MONSOON_MONTHS: tuple[int, ...] = (5, 6, 7, 8, 9)  # May-Sep

# Half-life (hours) for the Kohler-Linsley antecedent rainfall decay.
EFFECTIVE_RAIN_HALF_LIFE_H: float = 48.0

# Anchor event used for pre-event retraining in the backtest. Keeping the date
# here means the "train only on data before the event" rule cannot silently
# drift out of sync with the event definition.
ANCHOR_EVENTS: dict[str, dict[str, Any]] = {
    "noney_2022": {
        "label": "Noney / Tupul, Manipur - June 2022",
        "district": "Noney",
        "date": "2022-06-29",
        "fatalities": 58,
        "note": "Railway construction camp slope failure. Backtest anchor: models are "
                "retrained on data strictly before this date and evaluated on the run-up.",
    }
}


if __name__ == "__main__":
    for a in all_aois():
        print(f"{a.code:8} {a.district:20} {a.state:12} centroid={a.centroid} bbox={a.bbox_str}")
    print("\nNER bbox:", ", ".join(f"{v:.4f}" for v in ner_bbox()))
