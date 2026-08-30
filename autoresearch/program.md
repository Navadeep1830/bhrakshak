# BhuRakshak Autoresearch Program

> **SIH26001**: AI-Based Early Warning and Landslide Risk Monitoring System in NER  
> **Target**: Autonomous Optimization of Landslide Susceptibility (Model A) & Hazard Nowcast (Model B)

---

## 🎯 Primary Objective

Maximize the **Composite Benchmark Score**:

$$\text{Score} = 0.40 \times \text{LODO\_Mean\_AUC} + 0.30 \times \text{Hazard\_Test\_AUC} + 0.15 \times \text{CSI} - 0.10 \times \text{FAR} - 0.05 \times \text{Brier}$$

### Key Target Thresholds
* **Leave-One-District-Out (LODO) Spatial Generalization**: Mean AUC $\ge 0.96$
* **Hazard Nowcast Test ROC-AUC**: $\ge 0.95$
* **Critical Success Index (CSI / Threat Score)**: $\ge 0.65$
* **False Alarm Ratio (FAR)**: $\le 0.20$
* **Probability of Detection (POD)**: $\ge 0.85$
* **Brier Score Loss**: $\le 0.055$

---

## 🔬 Search Space & Hypotheses to Explore

### 1. Advanced Hydrology & Non-Linear Physics Interactions
- Multi-scale antecedent precipitation decay (e.g. 12h rapid infiltration, 48h soil capacity, 14-day deep groundwater accumulation).
- Intensity-Duration (I-D) power-law interactions ($I = \alpha \cdot D^{-\beta}$).
- Compound trigger indices: $\text{Trigger} = \frac{\text{rain\_1h} \times \text{rain\_24h}}{\text{dist\_stream\_km} + \epsilon} \times \text{susc\_p90}$.
- Non-linear slope curvature amplification: convex profile curvature combined with high slope acceleration.

### 2. Deep Tabular & Neural Architectures (PyTorch CUDA)
- PyTorch Tabular ResNet with residual skip connections, LayerNorm, and Swish/Mish activations.
- Specialized loss functions: **Focal Loss** ($\gamma \in [1.5, 3.0]$), **Asymmetric Cost-Sensitive Loss** (penalizing false negatives $4\times$ heavier than false alarms).
- Cosine Annealing learning rate schedulers with warm restarts.

### 3. Ensembling & Stacking
- Weighted blends of LightGBM + XGBoost + PyTorch Neural Tabular.
- Out-of-fold stacking meta-learner with Ridge / ElasticNet logistic regression.
- Rank averaging vs probability averaging.

### 4. Probability Calibration & Dynamic Thresholding
- Compare **Isotonic Regression** vs **Beta Calibration** vs **Platt Sigmoid Scaling**.
- Asymmetric threshold search targeting maximum CSI and minimum FAR on validation set.

---

## ⚠️ Hard Rules & Boundaries

1. **Immutable Ground Truth**: NEVER modify `prepare.py`, `evaluate.py`, or any file in `data/`.
2. **Single Mutable Target**: ALL model logic, feature engineering, architectures, and hyperparameters MUST reside in `train.py`.
3. **Compute Budget**: Every single experiment run must execute within **45 seconds** wall-clock time on the local machine (RTX 4050 / CPU).
4. **Git Protocol**:
   - If `new_score > best_score`: The runner automatically commits with a detailed message and logs to `experiments.jsonl`.
   - If `new_score <= best_score` or the script crashes: The runner automatically reverts via `git reset --hard HEAD`.
