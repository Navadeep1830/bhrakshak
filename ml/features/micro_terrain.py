"""Tier-2 micro-terrain features from a REAL DEM grid (Model A v2).

Every feature here is computed with numpy/scipy from the terrarium elevation
mosaic (ml/ingest/dem_real.py). Nothing is random and nothing is invented:
these are the standard DEM derivatives a landslide-susceptibility study uses
(slope, aspect, curvature, TWI, SPI, TPI, relief, roughness, valley/ridge
distance), each traceable to a physical mechanism:

  slope            driving force        F_drive = W sin(theta)
  aspect (sin/cos) moisture/weathering exposure
  plan_curv        water convergence    concave = funnel -> pore pressure
  profile_curv     acceleration/deceleration of flow down-slope
  twi              wetness propensity   ln(a / tan(beta))
  spi              erosion power        a * tan(beta)
  tpi              ridge vs valley position
  relief_1km       local energy available to debris
  roughness        fracture/disaggregation proxy
  dist_valley      toe erosion / stream undercut proximity
  dist_ridge       scarp/crest proximity

Resolution note: shape features (slope/curvature/TPI/relief) run at full
~35 m cell size. Flow-routing features (TWI/SPI/valley distance) need a D8
accumulation pass which is O(n log n); that runs on a stride-4 (~140 m)
grid and is nearest-upsampled back. This is the standard coarse-DEM routing
trade and is documented in the model card.

All functions are pure: grid in, grid out. Tests build tiny synthetic DEMs.
"""

from __future__ import annotations

import heapq
import logging

import numpy as np
from scipy import ndimage

log = logging.getLogger("bhrakshak.micro_terrain")

FEATURE_NAMES = [
    "elevation_m",
    "slope_deg",
    "aspect_sin",
    "aspect_cos",
    "plan_curv",
    "profile_curv",
    "twi",
    "spi",
    "tpi",
    "relief_1km",
    "roughness",
    "dist_valley_km",
    "dist_ridge_km",
]

STRIDE = 4  # routing grid stride; 4 * ~35 m ~ 140 m


def _meters_per_cell(res_m: float) -> float:
    return float(res_m)


def slope_aspect(elev: np.ndarray, res_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Horn-style gradient -> slope degrees + aspect radians."""
    gy, gx = np.gradient(elev, res_m)
    slope_rad = np.arctan(np.hypot(gx, gy))
    slope_deg = np.degrees(slope_rad)
    # aspect: downslope direction, 0 = north, clockwise
    aspect = np.arctan2(-gx, -gy)  # -gy: north is -row
    aspect = (aspect + 2 * np.pi) % (2 * np.pi)
    return slope_deg, aspect


def curvatures(elev: np.ndarray, res_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Plan curvature (Laplacian) + profile curvature (2nd derivative along
    the steepest-descent direction). Units 1/m, scaled by 100 for model use."""
    gy, gx = np.gradient(elev, res_m)
    gyy, gyx = np.gradient(gy, res_m)
    gxy, gxx = np.gradient(gx, res_m)
    # Laplacian = plan curvature proxy
    plan = gxx + gyy
    # profile curvature: second derivative along the unit gradient direction
    mag = np.hypot(gx, gy) + 1e-9
    ux, uy = gx / mag, gy / mag
    profile = ux * ux * gxx + 2 * ux * uy * gxy + uy * uy * gyy
    return plan * 100.0, profile * 100.0


def tpi(elev: np.ndarray, res_m: float, radius_m: float = 1000.0) -> np.ndarray:
    """Topographic position index: elev minus mean elevation in a window."""
    r = max(1, int(round(radius_m / res_m)))
    footprint = np.ones((2 * r + 1, 2 * r + 1), dtype=bool)
    footprint[r, r] = False  # exclude the centre cell
    local_mean = ndimage.uniform_filter(elev, size=2 * r + 1, mode="nearest")
    # uniform_filter includes the centre; correct by subtracting it back
    n = (2 * r + 1) ** 2
    local_mean = (local_mean * n - elev) / (n - 1)
    return elev - local_mean


def relief(elev: np.ndarray, res_m: float, radius_m: float = 1000.0) -> np.ndarray:
    """Local topographic relief: max - min within ~1 km."""
    r = max(1, int(round(radius_m / res_m)))
    vmax = ndimage.maximum_filter(elev, size=2 * r + 1, mode="nearest")
    vmin = ndimage.minimum_filter(elev, size=2 * r + 1, mode="nearest")
    return vmax - vmin


def roughness(elev: np.ndarray, res_m: float, radius_m: float = 250.0) -> np.ndarray:
    """Local std-dev of elevation (~250 m window)."""
    r = max(1, int(round(radius_m / res_m)))
    local_mean = ndimage.uniform_filter(elev, size=2 * r + 1, mode="nearest")
    local_sq = ndimage.uniform_filter(elev * elev, size=2 * r + 1, mode="nearest")
    var = np.clip(local_sq - local_mean * local_mean, 0.0, None)
    return np.sqrt(var)


def _d8_accumulation(dem: np.ndarray, cell_m: float) -> np.ndarray:
    """D8 flow accumulation on a coarse routing grid (cell counts).

    Cells drain to their steepest lower neighbour; flats drain to the lowest
    neighbour (ties -> first found). Returns upstream cell counts (self
    inclusive). Heap processes cells high->low so every donor is resolved
    before its receiver accumulates.
    """
    h, w = dem.shape
    n = np.ones((h, w), dtype=np.float64)  # self counts
    # pad to handle borders cleanly
    P = np.pad(dem, 1, mode="edge")
    # steepest descent target per cell, -1 = none (sink)
    best_drop = np.full((h, w), -np.inf)
    target = np.full((h, w, 2), -1, dtype=np.int16)
    nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    dists = {(di, dj): np.hypot(di, dj) for di, dj in nbrs}
    for di, dj in nbrs:
        # drop > 0 when the neighbour is LOWER (water flows downhill)
        drop = (dem - P[1 + di : 1 + di + h, 1 + dj : 1 + dj + w]) / dists[(di, dj)]
        upd = drop > best_drop
        best_drop[upd] = drop[upd]
        target[..., 0][upd] = di
        target[..., 1][upd] = dj

    order = np.argsort(dem, axis=None)[::-1]  # high to low
    ti = target[..., 0]
    tj = target[..., 1]
    for idx in order:
        i, j = divmod(int(idx), w)
        di = int(ti[i, j])
        dj = int(tj[i, j])
        if di == -1 or i + di < 0 or i + di >= h or j + dj < 0 or j + dj >= w:
            continue
        n[i + di, j + dj] += n[i, j]
    return n


def _routing_features(elev: np.ndarray, res_m: float, stride: int = STRIDE) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """TWI, SPI, and the valley mask at routing resolution, upsampled to full.

    TWI  = ln(a / tan(beta)),  a = specific catchment area (m)
    SPI  = a * tan(beta)
    Streams = cells whose accumulation exceeds the 97th percentile of the
    routing grid (a self-calibrating stream threshold; no magic constant).
    """
    h, w = elev.shape
    H = h // stride
    W = w // stride
    if H < 8 or W < 8:
        # DEM too small to coarsen; run at full res
        coarse = elev
        cell_m = res_m
    else:
        coarse = elev[: H * stride, : W * stride].reshape(H, stride, W, stride).mean(axis=(1, 3))
        cell_m = res_m * stride

    slope_deg_c, _ = slope_aspect(coarse, cell_m)
    slope_rad_c = np.radians(np.clip(slope_deg_c, 0.05, 80.0))
    acc = _d8_accumulation(coarse, cell_m)
    spec_area = acc * cell_m  # m, contour-width assumption c = 1 m per cell

    with np.errstate(divide="ignore", invalid="ignore"):
        twi_c = np.log(spec_area / np.tan(slope_rad_c))
        spi_c = spec_area * np.tan(slope_rad_c)
    twi_c = np.nan_to_num(twi_c, nan=0.0, posinf=0.0, neginf=0.0)
    spi_c = np.nan_to_num(spi_c, nan=0.0, posinf=0.0, neginf=0.0)

    thr = np.percentile(acc, 97.0)
    stream_mask_c = acc >= max(thr, 8.0)  # >= 8 upstream cells: not a one-cell noise channel

    if coarse.shape == elev.shape:
        return twi_c, spi_c, stream_mask_c

    twi = ndimage.zoom(twi_c, (h / twi_c.shape[0], w / twi_c.shape[1]), order=1)[:h, :w]
    spi = ndimage.zoom(spi_c, (h / spi_c.shape[0], w / spi_c.shape[1]), order=1)[:h, :w]
    stream = ndimage.zoom(
        stream_mask_c.astype(np.float32), (h / stream_mask_c.shape[0], w / stream_mask_c.shape[1]),
        order=1,
    )[:h, :w] > 0.5
    return twi, spi, stream


def _distance_km(mask: np.ndarray, res_m: float) -> np.ndarray:
    """Euclidean distance (km) from every cell to the nearest True cell."""
    if not mask.any():
        return np.full(mask.shape, np.nan)
    dist_cells = ndimage.distance_transform_edt(~mask)
    return dist_cells * res_m / 1000.0


def build_features(elev: np.ndarray, res_m: float) -> dict[str, np.ndarray]:
    """Full micro-terrain feature stack from an elevation grid.

    Returns {feature_name: 2-D float32 grid} (all grids share elev.shape).
    """
    elev = elev.astype(np.float64)
    slope_deg, aspect = slope_aspect(elev, res_m)
    plan, profile = curvatures(elev, res_m)
    slope_rad = np.radians(np.clip(slope_deg, 0.05, 80.0))

    twi, spi, stream_mask = _routing_features(elev, res_m)
    # ridge mask: locally high TPI + not on a steep wall
    tpi_grid = tpi(elev, res_m)
    ridge_mask = (tpi_grid > np.nanpercentile(tpi_grid, 98.0)) & (slope_deg < 25.0)

    feats = {
        "elevation_m": elev,
        "slope_deg": slope_deg,
        "aspect_sin": np.sin(aspect),
        "aspect_cos": np.cos(aspect),
        "plan_curv": plan,
        "profile_curv": profile,
        "twi": twi,
        "spi": spi,
        "tpi": tpi_grid,
        "relief_1km": relief(elev, res_m),
        "roughness": roughness(elev, res_m),
        "dist_valley_km": _distance_km(stream_mask, res_m),
        "dist_ridge_km": _distance_km(ridge_mask, res_m),
    }
    out = {}
    for name, grid in feats.items():
        arr = np.nan_to_num(np.asarray(grid, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
        out[name] = arr.astype(np.float32)
    return out


def sample_at(feats: dict[str, np.ndarray], lat: float, lon: float,
              bbox: tuple[float, float, float, float]) -> dict[str, float]:
    """Sample the feature stack at a lat/lon. Row 0 = bbox max-lat (north)."""
    minx, miny, maxx, maxy = bbox
    h, w = next(iter(feats.values())).shape
    frac_x = (lon - minx) / (maxx - minx)
    frac_y = (maxy - lat) / (maxy - miny)
    r = int(np.clip(frac_y * h, 0, h - 1))
    c = int(np.clip(frac_x * w, 0, w - 1))
    return {name: float(grid[r, c]) for name, grid in feats.items()}


def latlon_to_rc(lat: float, lon: float, shape: tuple[int, int],
                 bbox: tuple[float, float, float, float]) -> tuple[int, int]:
    minx, miny, maxx, maxy = bbox
    h, w = shape
    frac_x = (lon - minx) / (maxx - minx)
    frac_y = (maxy - lat) / (maxy - miny)
    return (
        int(np.clip(frac_y * h, 0, h - 1)),
        int(np.clip(frac_x * w, 0, w - 1)),
    )


# ---------------------------------------------------------------------------
# multi-scale context (the 1 km unit of analysis)
# ---------------------------------------------------------------------------
def context_features(feats: dict[str, np.ndarray], res_m: float,
                     radius_m: float = 1000.0) -> dict[str, np.ndarray]:
    """Per-cell neighbourhood statistics at the block scale.

    The GLC label accuracy is 5-50 km, so a 35 m cell can carry a positive
    label only by luck. The honest unit of analysis is the ~1 km block: at
    training time each block contributes aggregated rows; at inference this
    function produces the identical aggregation centred on every cell
    (uniform_filter mean/std, maximum_filter for slope), so the model is
    applied to exactly the same feature space it was fitted on.

    Returns {f"{name}_mean"|"f{name}_std"|"slope_max": grid} for every base
    feature (aspect_sin/cos excluded from std - circular).
    """
    r = max(1, int(round(radius_m / (2 * res_m))))  # radius so the window ~ radius_m wide
    size = 2 * r + 1
    out: dict[str, np.ndarray] = {}
    for name, grid in feats.items():
        g = grid.astype(np.float64)
        mean = ndimage.uniform_filter(g, size=size, mode="nearest")
        out[f"{name}_mean"] = mean.astype(np.float32)
        if name in ("aspect_sin", "aspect_cos"):
            continue  # circular - std is meaningless
        var = np.clip(
            ndimage.uniform_filter(g * g, size=size, mode="nearest") - mean * mean,
            0.0, None,
        )
        out[f"{name}_std"] = np.sqrt(var).astype(np.float32)
    out["slope_max"] = ndimage.maximum_filter(
        feats["slope_deg"].astype(np.float64), size=size, mode="nearest"
    ).astype(np.float32)
    return out


def build_training_feature_names() -> list[str]:
    """The block-level feature contract: mean/std context per base feature
    plus slope_max."""
    names: list[str] = []
    for name in FEATURE_NAMES:
        names.append(f"{name}_mean")
        if name not in ("aspect_sin", "aspect_cos"):
            names.append(f"{name}_std")
    names.append("slope_max")
    return names


def sample_context(ctx: dict[str, np.ndarray], lat: float, lon: float,
                   bbox: tuple[float, float, float, float]) -> dict[str, float]:
    minx, miny, maxx, maxy = bbox
    h, w = next(iter(ctx.values())).shape
    r = int(np.clip((maxy - lat) / (maxy - miny) * h, 0, h - 1))
    c = int(np.clip((lon - minx) / (maxx - minx) * w, 0, w - 1))
    return {name: float(grid[r, c]) for name, grid in ctx.items()}
