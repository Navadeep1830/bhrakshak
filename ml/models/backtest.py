"""Backtest: POD / FAR / CSI per level + lead-time histogram -> demo/backtest_fixture.json.
This file OWNS the numbers on the pitch slide."""

import json
from pathlib import Path

import numpy as np

DEMO_DIR = Path(__file__).resolve().parents[2] / "demo"


def pod_far_csi(hits: int, misses: int, false_alarms: int) -> dict:
    pod = hits / (hits + misses) if hits + misses else 0.0
    far = false_alarms / (hits + false_alarms) if hits + false_alarms else 0.0
    csi = hits / (hits + misses + false_alarms) if hits + misses + false_alarms else 0.0
    bias = (hits + false_alarms) / (hits + misses) if hits + misses else 0.0
    return {"pod": round(pod, 2), "far": round(far, 2), "csi": round(csi, 2), "bias": round(bias, 2)}


def synthetic_backtest(seed: int = 33) -> dict:
    """Deterministic placeholder evaluation until the real temporal backtest runs."""
    rng = np.random.default_rng(seed)
    per_level = []
    for level, base_pod, base_far in [(2, 0.78, 0.31), (3, 0.71, 0.24), (4, 0.64, 0.18)]:
        hits = int(rng.integers(60, 120))
        misses = int((hits / base_pod) - hits)
        fa = int((hits * base_far) / (1 - base_far))
        per_level.append({"level": level, **pod_far_csi(hits, misses, fa)})
    lead_times = np.clip(rng.normal(31, 12, 200), 2, 72)
    return {
        "generated_by": "ml/models/backtest.py",
        "note": "SYNTHETIC placeholder - replace by running the real temporal backtest",
        "metrics": {
            "period": {"train": "<=2019", "val": "2020-2022", "test": "2023-2024"},
            "per_level": per_level,
            "lead_time_h": {
                "median": round(float(np.median(lead_times)), 1),
                "p25": round(float(np.percentile(lead_times, 25)), 1),
                "p75": round(float(np.percentile(lead_times, 75)), 1),
                "histogram": np.histogram(lead_times, bins=[0, 6, 12, 24, 36, 48, 60, 72])[0].tolist(),
            },
        },
        "events": {
            "noney_2022": {
                "name": "Noney (Tupul) landslide",
                "date": "2022-06-30",
                "fatalities": 58,
                "anchor_zone": "MN-NON-002",
                "timeline": [
                    {"t_hours": -72, "rain_24h_mm": 42, "level": 0, "note": "monsoon background"},
                    {"t_hours": -48, "rain_24h_mm": 96, "level": 1, "note": "antecedent buildup"},
                    {"t_hours": -36, "rain_24h_mm": 148, "level": 3, "note": "SYSTEM HITS L3 WARNING - lead time anchor"},
                    {"t_hours": -24, "rain_24h_mm": 187, "level": 4, "note": "emergency"},
                    {"t_hours": -12, "rain_24h_mm": 214, "level": 4, "note": "slope failure imminent"},
                    {"t_hours": 0, "rain_24h_mm": 231, "level": 4, "note": "landslide event"},
                ],
            }
        },
    }


def main() -> None:
    DEMO_DIR.mkdir(exist_ok=True)
    out = DEMO_DIR / "backtest_fixture.json"
    out.write_text(json.dumps(synthetic_backtest(), indent=2))
    m = json.loads(out.read_text())["metrics"]
    print(f"backtest fixture -> {out}")
    for r in m["per_level"]:
        print(f"  L{r['level']}: POD {r['pod']:.2f} FAR {r['far']:.2f} CSI {r['csi']:.2f}")
    print(f"  median lead time: {m['lead_time_h']['median']} h")


if __name__ == "__main__":
    main()
