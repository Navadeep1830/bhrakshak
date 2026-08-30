"""status.py - Autoresearch Telemetry & Leaderboard HUD
SIH26001: Prints live experiment metrics, winning model card, and optimization history.
"""

from datetime import datetime
import json
from pathlib import Path
import sys

AUTORESEARCH_DIR = Path(__file__).resolve().parent
EXPERIMENTS_FILE = AUTORESEARCH_DIR / "experiments.jsonl"
BEST_RESULT_FILE = AUTORESEARCH_DIR / "best_result.json"


def format_table(rows: list[list[str]], headers: list[str]) -> str:
    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(cell)))
            
    header_str = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    sep_str = "-+-".join("-" * col_widths[i] for i in range(len(headers)))
    
    body_lines = []
    for row in rows:
        body_lines.append(" | ".join(str(cell).ljust(col_widths[i]) for i, cell in enumerate(row)))
        
    return f"{header_str}\n{sep_str}\n" + "\n".join(body_lines)


def main() -> None:
    print("=" * 80)
    print("🏔️  BHURAKSHAK AUTORESEARCH TELEMETRY HUD  (SIH26001)")
    print("=" * 80)
    
    if not EXPERIMENTS_FILE.exists():
        print("No experiments logged yet.")
        return
        
    entries = []
    with open(EXPERIMENTS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    entries.append(json.loads(line.strip()))
                except Exception:
                    pass
                    
    total_experiments = len(entries)
    accepted_experiments = [e for e in entries if e.get("status") == "ACCEPTED"]
    reverted_experiments = [e for e in entries if e.get("status") == "REVERTED"]
    
    best_score = 0.0
    if BEST_RESULT_FILE.exists():
        try:
            best_data = json.loads(BEST_RESULT_FILE.read_text())
            best_score = float(best_data.get("composite_score", 0.0))
        except Exception:
            pass
            
    print(f"Total Runs: {total_experiments} | Accepted: {len(accepted_experiments)} | Reverted: {len(reverted_experiments)}")
    print(f"🌟 All-Time Champion Benchmark Score: {best_score:.5f}\n")
    
    # Recent 10 Experiments
    print("📋 RECENT EXPERIMENTS LEDGER:")
    table_rows = []
    for e in entries[-12:]:
        status_icon = "✅ ACCEPTED" if e.get("status") == "ACCEPTED" else "❌ REVERTED"
        score = f"{e.get('composite_score', 0.0):.5f}" if e.get('composite_score') else "ERR"
        hyp = e.get("hypothesis", "")[:42] + ("..." if len(e.get("hypothesis", "")) > 42 else "")
        time_str = e.get("timestamp", "")[11:19]
        hazard_m = e.get("hazard_test", {})
        csi = f"{hazard_m.get('csi', 0.0):.3f}" if hazard_m else "-"
        far = f"{hazard_m.get('far', 0.0):.3f}" if hazard_m else "-"
        pod = f"{hazard_m.get('pod', 0.0):.3f}" if hazard_m else "-"
        table_rows.append([str(e.get("iteration")), time_str, status_icon, score, csi, far, pod, hyp])
        
    headers = ["Iter", "Time", "Status", "Score", "CSI", "FAR", "POD", "Hypothesis Tested"]
    print(format_table(table_rows, headers))
    
    if BEST_RESULT_FILE.exists():
        print("\n🏆 CURRENT CHAMPION MODEL CARD:")
        b = json.loads(BEST_RESULT_FILE.read_text())
        s_m = b.get("susceptibility", {})
        h_m = b.get("hazard", {}).get("test", {})
        print(f"  • Model A Leave-One-District-Out Spatial AUC: {s_m.get('mean_lodo_auc', 0.0):.4f}")
        print(f"  • Model B Hazard Nowcast Test AUC:           {h_m.get('auc', 0.0):.4f}")
        print(f"  • Critical Success Index (CSI / Threat):      {h_m.get('csi', 0.0):.4f}")
        print(f"  • False Alarm Ratio (FAR):                    {h_m.get('far', 0.0):.4f}")
        print(f"  • Probability of Detection (POD):             {h_m.get('pod', 0.0):.4f}")
        print(f"  • Brier Score Loss:                           {h_m.get('brier', 0.0):.4f}")
        print(f"  • Expected Calibration Error (ECE):           {h_m.get('ece', 0.0):.4f}")
    print("=" * 80)


if __name__ == "__main__":
    main()
