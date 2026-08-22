"""Model registry: persists trained model metadata to the API database's
model_registry table and writes docs/model-cards/*.md templates."""

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ARTIFACTS = Path(__file__).resolve().parents[1] / "artifacts"
DOCS = Path(__file__).resolve().parents[2] / "docs" / "model-cards"


def git_sha() -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return None


def save_artifact_meta(name: str, version: str, metrics: dict, notes: str = "") -> Path:
    ARTIFACTS.mkdir(exist_ok=True)
    payload = {
        "name": name,
        "version": version,
        "git_sha": git_sha(),
        "metrics": metrics,
        "notes": notes,
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    out = ARTIFACTS / f"{name}_{version}.json"
    out.write_text(json.dumps(payload, indent=2))
    print(f"registry artifact -> {out}")
    return out


def write_model_card(name: str, purpose: str, features: list[str], metrics: dict, limitations: str) -> Path:
    DOCS.mkdir(parents=True, exist_ok=True)
    card = DOCS / f"model-card-{name}.md"
    card.write_text(
        f"# Model Card - {name}\n\n"
        f"- **Purpose:** {purpose}\n"
        f"- **Trained:** {datetime.now(timezone.utc).isoformat()}\n"
        f"- **Git SHA:** {git_sha() or 'n/a'}\n\n"
        f"## Features ({len(features)})\n" + "\n".join(f"- {f}" for f in features) +
        f"\n\n## Metrics (COMPUTED)\n```json\n{json.dumps(metrics, indent=2)}\n```\n\n"
        f"## Limitations & Ethics\n{limitations}\n"
    )
    print(f"model card -> {card}")
    return card
