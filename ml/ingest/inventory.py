"""Landslide inventory ingest: GSI Bhukosh + NASA COOLR loader with bundled
synthetic fallback. Real shapefiles drop into data/inventory/ and are picked up
automatically; synthetic events are generated deterministically otherwise.
"""

import argparse
import json
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parents[2] / "data"
ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"

DISTRICT_BBOXES = {
    "aizawl": (92.50, 23.40, 93.10, 24.05),
    "east_khasi_hills": (91.20, 25.00, 92.00, 25.80),
    "noney_imphal_west": (93.50, 24.66, 94.08, 25.25),
    "gangtok": (88.32, 27.20, 88.70, 27.65),
}


def load_real() -> list[dict]:
    events = []
    for f in sorted((DATA / "inventory").glob("*.geojson")):
        gj = json.loads(f.read_text())
        for feat in gj.get("features", []):
            lon, lat = feat["geometry"]["coordinates"][:2]
            events.append({"lon": lon, "lat": lat, "source": f.stem})
    return events


def synthetic_inventory(n_per_district: int = 40) -> list[dict]:
    rng = np.random.default_rng(7)
    events = []
    for name, (minx, miny, maxx, maxy) in DISTRICT_BBOXES.items():
        # cluster near steep "urban slope" side of the bbox
        for _ in range(n_per_district):
            u = rng.beta(1.6, 1.6)
            v = rng.beta(1.6, 1.6)
            events.append({
                "lon": round(minx + u * (maxx - minx), 5),
                "lat": round(miny + v * (maxy - miny), 5),
                "district": name,
                "year": int(rng.integers(2004, 2025)),
                "fatalities": int(rng.poisson(0.4)),
                "source": "synthetic",
            })
    return events


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--synthetic", action="store_true")
    args = ap.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)

    real = [] if args.synthetic else load_real()
    events = real if real else synthetic_inventory()
    tag = "real" if real else "SYNTHETIC"
    out = ARTIFACTS / "inventory.json"
    out.write_text(json.dumps(events))
    print(f"inventory: {len(events)} events [{tag}] -> {out}")


if __name__ == "__main__":
    main()
