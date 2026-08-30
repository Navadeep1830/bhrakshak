"""evaluate.py - BhuRakshak Autoresearch Evaluation & Scoring Harness
SIH26001: Standardized Metric Evaluation for Model A (Susceptibility) & Model B (Hazard Nowcast).

DO NOT MODIFY DURING AUTORESEARCH LOOPS. This ensures fair, un-gamed evaluation across all iterations.
"""

from typing import Any
import numpy as np
from sklearn.metrics import (
    roc_auc_score,
    average_precision_score,
    brier_score_loss,
    confusion_matrix,
)


def compute_ece(y_true: np.ndarray, y_prob: np.ndarray, n_bins: int = 10) -> float:
    """Expected Calibration Error (ECE)."""
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    n = len(y_true)
    for i in range(n_bins):
        bin_lower = bin_boundaries[i]
        bin_upper = bin_boundaries[i + 1]
        in_bin = (y_prob > bin_lower) & (y_prob <= bin_upper) if i > 0 else (y_prob >= bin_lower) & (y_prob <= bin_upper)
        prop_in_bin = np.mean(in_bin)
        if prop_in_bin > 0:
            accuracy_in_bin = np.mean(y_true[in_bin])
            avg_confidence_in_bin = np.mean(y_prob[in_bin])
            ece += np.abs(avg_confidence_in_bin - accuracy_in_bin) * prop_in_bin
    return float(ece)


def compute_early_warning_metrics(y_true: np.ndarray, y_prob: np.ndarray, threshold: float = 0.5) -> dict[str, float]:
    """Computes operational early-warning metrics: POD, FAR, CSI, Frequency Bias."""
    y_pred = (y_prob >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    
    hits = int(tp)
    misses = int(fn)
    false_alarms = int(fp)
    correct_negatives = int(tn)
    
    pod = hits / (hits + misses) if (hits + misses) > 0 else 0.0
    far = false_alarms / (hits + false_alarms) if (hits + false_alarms) > 0 else 0.0
    csi = hits / (hits + misses + false_alarms) if (hits + misses + false_alarms) > 0 else 0.0
    bias = (hits + false_alarms) / (hits + misses) if (hits + misses) > 0 else 0.0
    
    return {
        "hits": hits,
        "misses": misses,
        "false_alarms": false_alarms,
        "correct_negatives": correct_negatives,
        "pod": round(float(pod), 4),
        "far": round(float(far), 4),
        "csi": round(float(csi), 4),
        "bias": round(float(bias), 4),
    }


def compute_composite_score(
    lodo_mean_auc: float,
    hazard_test_auc: float,
    hazard_test_csi: float,
    hazard_test_far: float,
    hazard_test_brier: float,
) -> float:
    """Composite optimization metric for BhuRakshak Autoresearch.
    
    Weights:
    - 40%: Model A Leave-One-District-Out Spatial Generalization AUC
    - 30%: Model B Hazard Nowcast Test ROC-AUC
    - 15%: Critical Success Index (CSI / Threat Score)
    - -10%: Penalty on False Alarm Ratio (FAR)
    - -5%: Penalty on Brier Score (Uncalibrated probabilities)
    
    Higher score is strictly better.
    """
    score = (
        0.40 * float(lodo_mean_auc)
        + 0.30 * float(hazard_test_auc)
        + 0.15 * float(hazard_test_csi)
        - 0.10 * float(hazard_test_far)
        - 0.05 * float(hazard_test_brier)
    )
    return round(float(score), 5)


def evaluate_susceptibility(
    fold_predictions: dict[str, tuple[np.ndarray, np.ndarray]],
) -> dict[str, Any]:
    """Evaluates Model A Leave-One-District-Out Spatial Cross Validation."""
    fold_metrics = {}
    aucs = []
    aps = []
    
    for district, (y_true, y_prob) in fold_predictions.items():
        auc = float(roc_auc_score(y_true, y_prob))
        ap = float(average_precision_score(y_true, y_prob))
        aucs.append(auc)
        aps.append(ap)
        fold_metrics[district] = {
            "auc": round(auc, 4),
            "ap": round(ap, 4),
            "n_test": len(y_true),
            "n_pos": int(np.sum(y_true)),
        }
        
    mean_auc = float(np.mean(aucs))
    mean_ap = float(np.mean(aps))
    std_auc = float(np.std(aucs))
    
    return {
        "fold_metrics": fold_metrics,
        "mean_lodo_auc": round(mean_auc, 4),
        "mean_lodo_ap": round(mean_ap, 4),
        "std_lodo_auc": round(std_auc, 4),
    }


def evaluate_hazard(
    val_true: np.ndarray,
    val_prob: np.ndarray,
    test_true: np.ndarray,
    test_prob: np.ndarray,
    threshold: float = 0.5,
) -> dict[str, Any]:
    """Evaluates Model B Hazard Nowcast on Validation and Held-Out Test years."""
    val_auc = float(roc_auc_score(val_true, val_prob))
    val_ap = float(average_precision_score(val_true, val_prob))
    val_brier = float(brier_score_loss(val_true, val_prob))
    val_ece = compute_ece(val_true, val_prob)
    val_ew = compute_early_warning_metrics(val_true, val_prob, threshold=threshold)
    
    test_auc = float(roc_auc_score(test_true, test_prob))
    test_ap = float(average_precision_score(test_true, test_prob))
    test_brier = float(brier_score_loss(test_true, test_prob))
    test_ece = compute_ece(test_true, test_prob)
    test_ew = compute_early_warning_metrics(test_true, test_prob, threshold=threshold)
    
    return {
        "val": {
            "auc": round(val_auc, 4),
            "ap": round(val_ap, 4),
            "brier": round(val_brier, 4),
            "ece": round(val_ece, 4),
            **val_ew,
        },
        "test": {
            "auc": round(test_auc, 4),
            "ap": round(test_ap, 4),
            "brier": round(test_brier, 4),
            "ece": round(test_ece, 4),
            **test_ew,
        },
    }
