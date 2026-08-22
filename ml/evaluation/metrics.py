"""Evaluation metrics for early-warning systems: POD, FAR, CSI, bias, lead time."""

import numpy as np


def confusion(hits: int, misses: int, false_alarms: int, correct_negatives: int = 0) -> dict:
    return {"hits": hits, "misses": misses, "false_alarms": false_alarms,
            "correct_negatives": correct_negatives}


def pod(hits: int, misses: int) -> float:
    return hits / (hits + misses) if (hits + misses) else 0.0


def far(hits: int, false_alarms: int) -> float:
    return false_alarms / (hits + false_alarms) if (hits + false_alarms) else 0.0


def csi(hits: int, misses: int, false_alarms: int) -> float:
    d = hits + misses + false_alarms
    return hits / d if d else 0.0


def frequency_bias(hits: int, misses: int, false_alarms: int) -> float:
    return (hits + false_alarms) / (hits + misses) if (hits + misses) else 0.0


def lead_time_stats(hours_before_event: list[float]) -> dict:
    a = np.asarray(hours_before_event, dtype=float)
    if a.size == 0:
        return {"median": None, "p25": None, "p75": None}
    return {
        "median": round(float(np.median(a)), 1),
        "p25": round(float(np.percentile(a, 25)), 1),
        "p75": round(float(np.percentile(a, 75)), 1),
    }


def score_level(hits: int, misses: int, false_alarms: int) -> dict:
    return {
        **confusion(hits, misses, false_alarms),
        "pod": round(pod(hits, misses), 3),
        "far": round(far(hits, false_alarms), 3),
        "csi": round(csi(hits, misses, false_alarms), 3),
        "bias": round(frequency_bias(hits, misses, false_alarms), 3),
    }
