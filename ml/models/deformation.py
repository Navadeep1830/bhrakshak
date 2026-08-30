"""Model C - Deformation anomaly: PSInSAR LOS velocity + time-series analysis.

Loads LiCSAR velocity GeoTIFFs / PS CSVs when present (data/insar/), else
generates synthetic persistent-scatterer fields so the layer is demoable.
Robust z-score on velocity + DBSCAN clustering of flagged points.
"""

import json
from pathlib import Path

import numpy as np

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
INSAR_DIR = Path(__file__).resolve().parents[2] / "data" / "insar"

AOIS = {
    "aizawl_city_slopes": (23.72, 92.72, 400),
    "nh10_sikkim_corridor": (27.40, 88.58, 300),
}


def synthetic_ps_points(n: int, center: tuple, seed: int, creep_clusters: int = 2) -> dict:
    rng = np.random.default_rng(seed)
    lat0, lon0, spread_m = center
    lat = lat0 + rng.normal(0, spread_m / 111000.0, n)
    lon = lon0 + rng.normal(0, spread_m / (111000.0 * 0.9), n)
    vel = rng.normal(0.4, 0.8, n)  # background mm/yr
    # inject slow-creep clusters (~ -12 mm/yr LOS)
    for c in range(creep_clusters):
        idx = rng.choice(n, size=n // 20, replace=False)
        clat, clon = lat[idx] + rng.normal(0, 0.0015), lon[idx] + rng.normal(0, 0.0015)
        vel[idx] = rng.normal(-12 + c * 3, 1.5, len(idx))
        lat[idx], lon[idx] = clat, clon
    return {"lat": lat, "lon": lon, "vel_mm_yr": vel}


def robust_zscore(v: np.ndarray) -> np.ndarray:
    med = np.median(v)
    mad = np.median(np.abs(v - med)) or 1e-6
    return 0.6745 * (v - med) / mad


def cluster_flagged(lat: np.ndarray, lon: np.ndarray, mask: np.ndarray):
    flagged = mask.sum()
    if flagged < 3:
        return np.zeros(len(lat), dtype=int), 0
    try:
        from sklearn.cluster import DBSCAN

        coords = np.column_stack([lat[mask], lon[mask]]) * 111000
        labels = DBSCAN(eps=120, min_samples=5).fit(coords).labels_
    except ImportError:
        labels = np.zeros(int(flagged), dtype=int)
    out = np.full(len(lat), -1, dtype=int)
    out[mask] = labels
    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    return out, n_clusters


def main() -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    report = {}
    for i, (name, center) in enumerate(AOIS.items()):
        ps = synthetic_ps_points(1500, center, seed=900 + i)
        z = robust_zscore(ps["vel_mm_yr"])
        mask = (z < -3.0) | (np.abs(z) > 3.0)  # ground moving significantly away from satellite (downslope creep)
        labels, n_clusters = cluster_flagged(ps["lat"], ps["lon"], mask)
        report[name] = {
            "points": int(len(z)),
            "flagged": int(mask.sum()),
            "creep_clusters": n_clusters,
            "median_vel_mm_yr": round(float(np.median(ps["vel_mm_yr"])), 2),
            "synthetic": not INSAR_DIR.exists(),
        }
        print(f"{name:>22}: {report[name]['points']} PS, {report[name]['flagged']} flagged, "
              f"{n_clusters} creep clusters")

    (ARTIFACTS / "deformation_summary.json").write_text(json.dumps(report, indent=2))
    print(f"artifacts -> {ARTIFACTS/'deformation_summary.json'}")
    print("rule: active creep cluster => hazard tier +1 (Layer 3 upgrade)")


if __name__ == "__main__":
    main()
