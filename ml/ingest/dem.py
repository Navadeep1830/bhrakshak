"""DEM ingest: Copernicus GLO-30 download hook + synthetic fallback.

Real mode (needs network + rasterio):
    python -m ml.ingest.dem --real
Synthetic mode (offline-safe, deterministic):
    python -m ml.ingest.dem --synthetic
"""

import argparse
import json
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parents[2] / "data"
ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"

DISTRICTS = {
    "aizawl": {"lat": 23.73, "lon": 92.72},
    "east_khasi_hills": {"lat": 25.45, "lon": 91.60},
    "noney_imphal_west": {"lat": 24.90, "lon": 93.87},
    "gangtok": {"lat": 27.42, "lon": 88.55},
}


def synthetic_dem(name: str, seed: int, size: int = 256) -> dict:
    """Fractal-ish terrain with realistic slope stats for NER hills."""
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 4 * np.pi, size)
    base = 800 + 600 * np.abs(np.sin(x))[:, None] * np.cos(x)[None, :]
    noise = np.zeros((size, size))
    for amp, freq in [(120, 8), (60, 17), (25, 41), (10, 97)]:
        noise += amp * rng.standard_normal((size // freq or 1, size // freq or 1)).repeat(
            size // (size // freq or 1), axis=0
        )[:, :size].repeat(size // (size // freq or 1), axis=1)[:size, :size]
    dem = base + noise
    gy, gx = np.gradient(dem, 30.0)  # 30m cells
    slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))
    return {
        "district": name,
        "elevation_m": dem,
        "slope_deg": slope_deg,
        "stats": {
            "mean_slope_deg": float(slope_deg.mean()),
            "p90_slope_deg": float(np.percentile(slope_deg, 90)),
            "elev_range_m": [float(dem.min()), float(dem.max())],
        },
        "synthetic": True,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--synthetic", action="store_true")
    ap.add_argument("--real", action="store_true", help="download GLO-30 (requires network + rasterio)")
    args = ap.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)

    out = {}
    for i, name in enumerate(DISTRICTS):
        if args.real:
            raise SystemExit("GLO-30 download lands in ML phase week 2 - use --synthetic for now")
        out[name] = synthetic_dem(name, seed=100 + i)
        print(f"{name:>18}: mean slope {out[name]['stats']['mean_slope_deg']:.1f} deg (synthetic)")

    (ARTIFACTS / "dem_summary.json").write_text(json.dumps(out, default=str)[:200000])
    print(f"artifacts -> {ARTIFACTS/'dem_summary.json'}")


if __name__ == "__main__":
    main()
