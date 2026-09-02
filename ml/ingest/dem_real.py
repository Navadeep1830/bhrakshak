"""Real DEM ingest for Model A v2 (Tier-2 micro-susceptibility).

Terrain source: AWS Open Data "terrarium" elevation tiles
(https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png).
Free, key-less, global, derived from SRTM/ETOPO/NED mixtures -- the same
family of sources the GEE export in the reference project (SPY-Github22)
produced, but downloadable by a script instead of requiring a GEE account.

Encoding (terrarium): elevation_m = (R * 256 + G + B / 256) - 32768.

Zoom choice: z12 is ~38 m/px at these latitudes -- comparable to the 30 m
GLO-30/SRTM resolution the GEE script exported, without the 3.4 GB Drive
uploads the 30 m full-ROI export hit (their gee_retry_failed.js had to fall
back to 90 m for storage reasons; per-district z12 tiles total < 5 MB).

Cache: ml/cache/dem_{aoi_slug}.npz with the elevation grid + bbox so every
downstream stage is offline. Deterministic, provenance-tracked.

Run:
    python -m ml.ingest.dem_real              # all AOIs
    python -m ml.ingest.dem_real --aoi MZ-AIZ
    python -m ml.ingest.dem_real --report
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import time
from pathlib import Path

import numpy as np

from ml.config.aois import AOI, all_aois

log = logging.getLogger("bhrakshak.dem_real")

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = REPO_ROOT / "ml" / "cache"
ARTIFACTS = REPO_ROOT / "ml" / "artifacts"

TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
ZOOM = 12  # ~38 m/px at NER latitudes
TILE_PX = 256
PAUSE_S = 0.05  # polite pacing; the bucket is public Open Data


def _lon_to_tile(lon: float, z: int) -> int:
    return int((lon + 180.0) / 360.0 * (2 ** z))


def _lat_to_tile(lat: float, z: int) -> int:
    r = np.radians(lat)
    return int((1.0 - np.log(np.tan(r) + 1.0 / np.cos(r)) / np.pi) / 2.0 * (2 ** z))


def _tile_px_to_lonlat(x: float, y: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * y / n))))
    return lon, lat


def fetch_terrarium_tile(z: int, x: int, y: int, retries: int = 3) -> np.ndarray:
    """Download one terrarium tile and decode it to metres."""
    import requests

    from ml.util.http import _SESSION_DIRECT, _SESSION_ENV

    url = TERRARIUM_URL.format(z=z, x=x, y=y)
    last: Exception | None = None
    for attempt in range(retries):
        for session in (_SESSION_ENV, _SESSION_DIRECT):
            try:
                resp = session.get(url, timeout=20)
                resp.raise_for_status()
                from PIL import Image

                img = Image.open(io.BytesIO(resp.content)).convert("RGB")
                arr = np.asarray(img, dtype=np.float64)
                elev = (arr[:, :, 0] * 256.0 + arr[:, :, 1] + arr[:, :, 2] / 256.0) - 32768.0
                return elev
            except Exception as exc:  # noqa: BLE001 - retry across transports
                last = exc
        if attempt < retries:
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"terrarium tile {z}/{x}/{y} failed after {retries} attempts: {last}")


def fetch_aoi_dem(aoi: AOI, zoom: int = ZOOM) -> dict:
    """Mosaic terrarium tiles covering the AOI bbox into one elevation grid.

    Returns {"district", "elevation" (rows = north->south), "bbox",
    "zoom", "res_m", "source"} and caches to ml/cache/dem_{slug}.npz.
    """
    minx, miny, maxx, maxy = aoi.bbox
    x0, x1 = _lon_to_tile(minx, zoom), _lon_to_tile(maxx, zoom)
    y0, y1 = _lat_to_tile(maxy, zoom), _lat_to_tile(miny, zoom)

    cols = (x1 - x0 + 1) * TILE_PX
    rows = (y1 - y0 + 1) * TILE_PX
    mosaic = np.full((rows, cols), np.nan, dtype=np.float64)

    n_tiles = (x1 - x0 + 1) * (y1 - y0 + 1)
    done = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            tile = fetch_terrarium_tile(zoom, tx, ty)
            r = (ty - y0) * TILE_PX
            c = (tx - x0) * TILE_PX
            mosaic[r : r + TILE_PX, c : c + TILE_PX] = tile
            done += 1
            if done % 10 == 0 or done == n_tiles:
                log.info("  %s: %d/%d tiles", aoi.slug, done, n_tiles)
            time.sleep(PAUSE_S)

    # Crop to the exact bbox (tile grid overshoots). All edges measured from
    # the mosaic's top-left corner; clip inside the mosaic so a bbox that
    # merely grazes a tile edge cannot produce an empty crop.
    corner_lon, corner_lat = _tile_px_to_lonlat(x0, y0, zoom)
    lon_res = (_tile_px_to_lonlat(x0 + 1, y0, zoom)[0] - corner_lon) / TILE_PX
    lat_res = (corner_lat - _tile_px_to_lonlat(x0, y0 + 1, zoom)[1]) / TILE_PX
    r_top = int(np.clip(round((corner_lat - maxy) / lat_res), 0, mosaic.shape[0] - 2))
    r_bot = int(np.clip(round((corner_lat - miny) / lat_res), r_top + 1, mosaic.shape[0]))
    c_left = int(np.clip(round((minx - corner_lon) / lon_res), 0, mosaic.shape[1] - 2))
    c_right = int(np.clip(round((maxx - corner_lon) / lon_res), c_left + 1, mosaic.shape[1]))
    crop = mosaic[r_top:r_bot, c_left:c_right]

    # Terrarium artifacts: a handful of inland pixels decode to deep negatives
    # (ocean-mask bleed in the source mosaics, observed ~0.004% of cells in
    # East Khasi Hills). No NER terrain is below sea level; replace with the
    # local median instead of letting them poison slope gradients.
    bad = crop < 0
    if bad.any():
        med = float(np.nanmedian(crop[~bad])) if (~bad).any() else 0.0
        crop = np.where(bad, med, crop)
        log.info("  %s: replaced %d negative-elevation artifact px with %.0f m",
                 aoi.slug, int(bad.sum()), med)

    res_m = float(np.mean([lat_res * 111_320.0, lon_res * 111_320.0 * np.cos(np.radians(aoi.lat))]))
    return {
        "district": aoi.district,
        "aoi_code": aoi.code,
        "elevation": crop,
        "bbox": [minx, miny, maxx, maxy],
        "zoom": zoom,
        "res_m": round(res_m, 1),
        "source": "aws-terrarium-z12",
        "synthetic": False,
    }


def cache_path(aoi_slug: str) -> Path:
    return CACHE_DIR / f"dem_{aoi_slug}.npz"


def load_cached(aoi_slug: str) -> dict | None:
    p = cache_path(aoi_slug)
    if not p.exists():
        return None
    with np.load(p, allow_pickle=False) as z:
        return {
            "district": str(z["district"]),
            "aoi_code": str(z["aoi_code"]),
            "elevation": z["elevation"],
            "bbox": z["bbox"].tolist(),
            "zoom": int(z["zoom"]),
            "res_m": float(z["res_m"]),
            "source": str(z["source"]),
            "synthetic": False,
        }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--aoi", default=None, help="one AOI code, e.g. MZ-AIZ")
    ap.add_argument("--force", action="store_true", help="re-download even if cached")
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if args.aoi:
        from ml.config.aois import get_aoi

        aois = [get_aoi(args.aoi)]
    else:
        aois = all_aois()

    if args.report:
        for a in aois:
            d = load_cached(a.slug)
            if d is None:
                print(f"{a.district:>18}: NOT CACHED")
                continue
            e = d["elevation"]
            print(
                f"{a.district:>18}: {e.shape[0]}x{e.shape[1]} cells, "
                f"{d['res_m']} m/px, elev {e.min():.0f}-{e.max():.0f} m  ({d['source']})"
            )
        return

    summary = {}
    for a in aois:
        if cache_path(a.slug).exists() and not args.force:
            d = load_cached(a.slug)
            log.info("%s: cached (%s), skipping (use --force to refresh)", a.district, d["source"])
        else:
            log.info("%s: downloading terrarium z%d ...", a.district, ZOOM)
            d = fetch_aoi_dem(a)
            np.savez_compressed(
                cache_path(a.slug),
                elevation=d["elevation"],
                bbox=np.array(d["bbox"]),
                zoom=d["zoom"],
                res_m=d["res_m"],
                district=d["district"],
                aoi_code=d["aoi_code"],
                source=d["source"],
            )
        e = d["elevation"]
        summary[a.code] = {
            "district": d["district"],
            "shape": [int(e.shape[0]), int(e.shape[1])],
            "res_m": d["res_m"],
            "elev_min": float(np.nanmin(e)),
            "elev_max": float(np.nanmax(e)),
            "source": d["source"],
            "synthetic": False,
        }
        print(f"{a.district:>18}: {e.shape[0]}x{e.shape[1]} @ {d['res_m']} m/px, "
              f"{np.nanmin(e):.0f}-{np.nanmax(e):.0f} m")

    ARTIFACTS.mkdir(exist_ok=True)
    out = ARTIFACTS / "dem_real_summary.json"
    out.write_text(json.dumps({"source": "aws-terrarium", "zoom": ZOOM, "aois": summary,
                               "synthetic": False}, indent=2))
    print(f"summary -> {out}")


if __name__ == "__main__":
    main()
