# Model Card - B-hazard-nowcast

- **Purpose:** Dynamic WHEN: P(landslide in zone within 24h); fused with interpretable I-D thresholds; hysteresis escalate x2 / de-escalate x3
- **Trained:** 2026-09-02T15:18:48.824449+00:00
- **Git SHA:** cf37615

## Features (12)
- rain_1h
- rain_24h
- rain_48h
- rain_72h
- rain_7d
- eff_rain
- soil_moisture
- susc_mean
- susc_p90
- susc_high_frac
- seismic_flag
- verified_reports_7d

## Metrics (COMPUTED)
```json
{
  "split": {
    "train": "<=2019",
    "val": "2020-2022",
    "test": "2023-2024"
  },
  "test_auc": 0.848,
  "test_brier": 0.1388,
  "calibration": "isotonic",
  "fusion_rule": "level = max(threshold_tier, calibrated_ml_tier)"
}
```

## Limitations & Ethics
Temporal split guards against leakage but event counts are small per district; probabilities are calibrated only for the pilot domain.
