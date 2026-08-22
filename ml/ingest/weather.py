"""Weather ingest: Open-Meteo Archive puller (hourly rain + soil moisture) with
deterministic offline fallback. Computes rain_1h/24h/48h/72h/7d and
Kohler-Linsley exponential-decay effective rainfall (half-life 48h).
"""

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"

DISTRICT_CENTROIDS = {
    "aizawl": (23.73, 92.72),
    "east_khasi_hills": (25.45, 91.60),
    "noney_imphal_west": (24.90, 93.87),
    "gangtok": (27.42, 88.55),
}

HALF_LIFE_H = 48.0


def effective_rainfall(hourly_mm: np.ndarray) -> np.ndarray:
    """Kohler-Linsley API-style antecedent precipitation index."""
    decay = 0.5 ** (1.0 / HALF_LIFE_H)
    eff = np.zeros_like(hourly_mm)
    acc = 0.0
    for i, mm in enumerate(hourly_mm):
        acc = acc * decay + float(mm)
        eff[i] = acc
    return eff


def fetch_open_meteo(lat: float, lon: float, days: int = 365 * 3) -> dict | None:
    import requests

    end = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    start = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    url = (
        "https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat}&longitude={lon}"
        "&hourly=precipitation,soil_moisture_3_to_9cm"
        f"&start_date={start}&end_date={end}&timezone=UTC"
    )
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  open-meteo unavailable ({e}) - synthetic fallback")
        return None


def synthetic_hourly(days: int, seed: int, monsoon_factor: float) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    n = days * 24
    months = np.tile(np.repeat(np.arange(12), 30 * 24 // 12)[: n // 30], 30)[:n]
    monsoon = np.isin(months % 12, [5, 6, 7, 8, 9]).astype(float)
    rain = rng.gamma(0.35, 3.0, n) * monsoon * monsoon_factor
    soil = np.clip(30 + 55 * monsoon + rng.normal(0, 5, n), 5, 98)
    return rain, soil


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--synthetic", action="store_true")
    args = ap.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)

    summary = {}
    for i, (name, (lat, lon)) in enumerate(DISTRICT_CENTROIDS.items()):
        data = None if args.synthetic else fetch_open_meteo(lat, lon)
        if data and "hourly" in data:
            rain = np.array(data["hourly"]["precipitation"], dtype=float)
            soil = np.array(data["hourly"].get("soil_moisture_3_to_9cm") or [0], dtype=float)
            src = "open-meteo-archive"
        else:
            factor = {"aizawl": 1.0, "east_khasi_hills": 2.2, "noney_imphal_west": 1.1, "gangtok": 1.3}[name]
            rain, soil = synthetic_hourly(365 * 3, seed=500 + i, monsoon_factor=factor)
            src = "SYNTHETIC"
        eff = effective_rainfall(rain)
        summary[name] = {
            "source": src,
            "hours": int(len(rain)),
            "annual_rain_mm": round(float(rain[-24 * 365:].sum()), 0),
            "max_eff_rain_mm": round(float(eff.max()), 1),
            "mean_soil_moisture_pct": round(float(soil.mean()), 1),
        }
        print(f"{name:>18}: {summary[name]['annual_rain_mm']:>6} mm/yr [{src}]")

    (ARTIFACTS / "weather_summary.json").write_text(json.dumps(summary, indent=2))
    print(f"artifacts -> {ARTIFACTS/'weather_summary.json'}")


if __name__ == "__main__":
    main()
