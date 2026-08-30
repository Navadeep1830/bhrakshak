"""ledger.py - Experiment Ledger & Git Controller for BhuRakshak Autoresearch
SIH26001: Tracks every experiment iteration, maintains best score, and logs progress.
"""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
from typing import Any

AUTORESEARCH_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = AUTORESEARCH_DIR.parent
TRAIN_FILE = AUTORESEARCH_DIR / "train.py"
BACKUP_FILE = AUTORESEARCH_DIR / "train.py.best_backup"
EXPERIMENTS_FILE = AUTORESEARCH_DIR / "experiments.jsonl"
BEST_RESULT_FILE = AUTORESEARCH_DIR / "best_result.json"


def get_git_sha() -> str:
    """Returns current git commit short SHA."""
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            check=True,
        )
        return res.stdout.strip()
    except Exception:
        return "local"


def backup_best_state() -> None:
    """Saves disk-level backup of known best train.py."""
    if TRAIN_FILE.exists():
        shutil.copy2(TRAIN_FILE, BACKUP_FILE)


def restore_best_state() -> None:
    """Restores disk-level backup of known best train.py and git checkout."""
    if BACKUP_FILE.exists():
        shutil.copy2(BACKUP_FILE, TRAIN_FILE)
    try:
        subprocess.run(
            ["git", "checkout", "HEAD", "--", "autoresearch/train.py"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            check=False,
        )
    except Exception:
        pass


def git_commit(message: str) -> str:
    """Stages and commits changes in autoresearch/train.py."""
    backup_best_state()
    try:
        subprocess.run(["git", "add", "autoresearch/train.py"], cwd=str(PROJECT_ROOT), check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", message], cwd=str(PROJECT_ROOT), check=True, capture_output=True)
        return get_git_sha()
    except Exception as exc:
        print(f"Git commit notice: {exc}")
        return get_git_sha()


def git_revert() -> None:
    """Reverts changes in autoresearch/train.py back to best state."""
    restore_best_state()


def load_best_score() -> float:
    """Loads the current best composite score."""
    if BEST_RESULT_FILE.exists():
        try:
            data = json.loads(BEST_RESULT_FILE.read_text())
            return float(data.get("composite_score", 0.0))
        except Exception:
            return 0.0
    return 0.0


def record_experiment(
    iteration: int,
    hypothesis: str,
    results: dict[str, Any] | None,
    accepted: bool,
    error_msg: str | None = None,
) -> None:
    """Appends an experiment record to experiments.jsonl and updates best_result.json if accepted."""
    entry = {
        "iteration": iteration,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "hypothesis": hypothesis,
        "status": "ACCEPTED" if accepted else "REVERTED",
        "git_sha": get_git_sha(),
    }
    
    if results is not None:
        entry["composite_score"] = results.get("composite_score", 0.0)
        entry["elapsed_seconds"] = results.get("elapsed_seconds", 0.0)
        entry["susceptibility"] = {
            "mean_lodo_auc": results.get("susceptibility", {}).get("mean_lodo_auc", 0.0),
            "std_lodo_auc": results.get("susceptibility", {}).get("std_lodo_auc", 0.0),
        }
        test_hazard = results.get("hazard", {}).get("test", {})
        entry["hazard_test"] = {
            "auc": test_hazard.get("auc", 0.0),
            "csi": test_hazard.get("csi", 0.0),
            "far": test_hazard.get("far", 0.0),
            "pod": test_hazard.get("pod", 0.0),
            "brier": test_hazard.get("brier", 0.0),
            "ece": test_hazard.get("ece", 0.0),
        }
    else:
        entry["composite_score"] = 0.0
        entry["error"] = error_msg
        
    with open(EXPERIMENTS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
        
    if accepted and results is not None:
        backup_best_state()
        BEST_RESULT_FILE.write_text(json.dumps(results, indent=2))
        print(f"🌟 NEW ALL-TIME BEST SCORE: {entry['composite_score']:.5f} (Iteration {iteration})")
