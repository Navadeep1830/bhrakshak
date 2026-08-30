# 🏔️ BhuRakshak Autoresearch

> **SIH26001**: AI-Based Early Warning and Landslide Risk Monitoring System in NER  
> **Autonomous Machine Learning Research & Model Optimization Suite**

---

## ⚡ Overview

`autoresearch` brings Andrej Karpathy's autonomous propose-train-evaluate-revert loop directly into **BhuRakshak**. It continuously designs, trains, tests, and validates landslide prediction models overnight without human intervention.

### The Continuous Loop
1. **Explore Hypothesis**: Generates mathematical feature interactions, hyperparameter configurations, ensemble blends (LightGBM + XGBoost + PyTorch CUDA Neural Networks), and probability calibrators.
2. **Execute under Budget**: Trains Model A (Leave-One-District-Out Spatial Susceptibility) and Model B (Temporal Hazard Nowcast).
3. **Strict Evaluation**: Calculates validation & test ROC-AUC, Critical Success Index (CSI), False Alarm Ratio (FAR), and Brier score loss.
4. **Git Versioning**: If composite score sets a new record, it automatically commits the code to Git and logs to `experiments.jsonl`. If it regresses, it cleanly reverts.

---

## 🚀 Quick Commands

### View Live Telemetry & Leaderboard
```bash
.venv/bin/python autoresearch/status.py
```

### Run a Fixed Batch of Experiments
```bash
.venv/bin/python autoresearch/run_loop.py --iterations 20
```

### Start Continuous Overnight Daemon
```bash
./autoresearch/start_overnight.sh
```

### Stop Daemon
```bash
./autoresearch/stop_overnight.sh
```

### View Live Training Logs
```bash
tail -f autoresearch/daemon.log
```

---

## 📂 Architecture Layout

| File | Purpose |
| :--- | :--- |
| **`prepare.py`** | *Fixed Ground Truth*: Fetches 10-year Open-Meteo weather series, NASA/GSI landslide points, generates LODO and temporal dataset splits in `data/`. |
| **`evaluate.py`** | *Fixed Evaluation*: Leave-One-District-Out spatial CV metrics, early-warning POD/FAR/CSI calculation, and composite scoring. |
| **`train.py`** | *AI Canvas*: The mutable model architecture, feature engineering, neural network, and training loops. |
| **`program.md`** | *Human Directives*: Research goals, physical domain hypotheses, and optimization constraints. |
| **`run_loop.py`** | *Autonomous Daemon*: Evolutionary hypothesis mutator, Git commit controller, and execution harness. |
| **`status.py`** | *Telemetry HUD*: Terminal dashboard rendering live experiment counts and champion model cards. |
| **`experiments.jsonl`**| *Immutable Ledger*: Full record of every hypothesis tested, timestamp, score, and commit SHA. |
| **`best_result.json`** | *Champion Snapshot*: Metrics and configuration of the highest-performing model achieved so far. |
