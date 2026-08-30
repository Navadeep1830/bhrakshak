# Model Card - B-hazard-nowcast

- **Purpose:** Dynamic WHEN: probability of a rainfall-triggered landslide in the next 24 h
- **Trained:** 2026-08-29T17:58:45.859974+00:00
- **Git SHA:** ace9660

## Features (8)
- rain_24h
- rain_72h
- rain_7d
- rain_max_1h
- eff_rain
- is_monsoon
- sin_doy
- cos_doy

## Metrics (COMPUTED)
```json
{
  "model": "hazard_nowcast",
  "backend": "lightgbm",
  "n_train": 9126,
  "n_test": 12783,
  "n_positive_train": 20,
  "n_positive_test": 10,
  "split": "temporal: train <= 2014, test > 2014",
  "label_definition": "event in (t, t+24h]",
  "calibration": "isotonic",
  "scale_pos_weight": 15.0,
  "scale_pos_weight_selection": "out-of-fold average precision over [1.0, 5.0, 15.0, 40.0, 100.0]",
  "level_definition": "operational alert budget (fraction of days allowed at that level); thresholds frozen on the calibration split",
  "per_level": [
    {
      "pod": 1.0,
      "far": 0.999,
      "csi": 0.001,
      "bias": 1139.1,
      "tp": 10,
      "fp": 11381,
      "fn": 0,
      "level": 1,
      "name": "L1",
      "alert_budget": 0.2,
      "threshold": 0.0014,
      "alert_days_per_year": 73.0
    },
    {
      "pod": 0.1,
      "far": 0.999,
      "csi": 0.001,
      "bias": 84.4,
      "tp": 1,
      "fp": 843,
      "fn": 9,
      "level": 2,
      "name": "L2",
      "alert_budget": 0.1,
      "threshold": 0.0028,
      "alert_days_per_year": 36.5
    },
    {
      "pod": 0.1,
      "far": 0.998,
      "csi": 0.002,
      "bias": 41.1,
      "tp": 1,
      "fp": 410,
      "fn": 9,
      "level": 3,
      "name": "L3",
      "alert_budget": 0.03,
      "threshold": 0.0116,
      "alert_days_per_year": 11.0
    },
    {
      "pod": 0.1,
      "far": 0.998,
      "csi": 0.002,
      "bias": 41.1,
      "tp": 1,
      "fp": 410,
      "fn": 9,
      "level": 4,
      "name": "L4",
      "alert_budget": 0.01,
      "threshold": 0.0116,
      "alert_days_per_year": 3.7
    }
  ],
  "ranking": {
    "pr_auc": 0.001,
    "pr_auc_ci95": [
      0.0004,
      0.0032
    ],
    "roc_auc": 0.5677,
    "test_base_rate": 0.00078,
    "pr_auc_lift_vs_random": 1.32
  },
  "event_day_ranking": {
    "n_events": 10,
    "median_percentile": 0.518,
    "frac_in_top_20pct": 0.1,
    "frac_in_top_10pct": 0.1,
    "frac_in_top_5pct": 0.1,
    "frac_in_top_1pct": 0.0,
    "baseline_median_percentile": 0.845,
    "baseline_frac_in_top_10pct": 0.4
  },
  "caine_1980_baseline": {
    "pod": 0.0,
    "far": 1.0,
    "csi": 0.0,
    "bias": 5.4,
    "tp": 0,
    "fp": 54,
    "fn": 10,
    "alert_days_per_year": 1.5
  },
  "regional_id_threshold": {
    "form": "alarm when rain_24h >= k x that district's own p90; k set by alert budget",
    "col": "rain_24h_anom",
    "selection": "k = training-period quantile at each operational alert budget",
    "per_budget": [
      {
        "pod": 0.6,
        "far": 0.998,
        "csi": 0.002,
        "bias": 258.3,
        "tp": 6,
        "fp": 2577,
        "fn": 4,
        "budget": 0.2,
        "k_x_p90": 0.55,
        "realised_alert_days_per_year": 73.8
      },
      {
        "pod": 0.5,
        "far": 0.996,
        "csi": 0.004,
        "bias": 137.7,
        "tp": 5,
        "fp": 1372,
        "fn": 5,
        "budget": 0.1,
        "k_x_p90": 0.97,
        "realised_alert_days_per_year": 39.3
      },
      {
        "pod": 0.0,
        "far": 1.0,
        "csi": 0.0,
        "bias": 42.1,
        "tp": 0,
        "fp": 421,
        "fn": 10,
        "budget": 0.03,
        "k_x_p90": 1.95,
        "realised_alert_days_per_year": 12.0
      },
      {
        "pod": 0.0,
        "far": 1.0,
        "csi": 0.0,
        "bias": 15.8,
        "tp": 0,
        "fp": 158,
        "fn": 10,
        "budget": 0.01,
        "k_x_p90": 3.05,
        "realised_alert_days_per_year": 4.5
      }
    ],
    "equivalent_mm_per_24h_by_district": {
      "ML-EKH": {
        "top 20%": 16.2,
        "top 10%": 28.7,
        "top 3%": 57.8,
        "top 1%": 90.7
      },
      "MN-NON": {
        "top 20%": 6.7,
        "top 10%": 11.8,
        "top 3%": 23.7,
        "top 1%": 37.3
      },
      "MZ-AIZ": {
        "top 20%": 7.7,
        "top 10%": 13.5,
        "top 3%": 27.2,
        "top 1%": 42.8
      }
    },
    "caine_point_threshold_mm_24h": 103.0
  },
  "caine_threshold_mm_24h": 102.99,
  "lead_time_h": {
    "n": 10,
    "median_h": 15.0,
    "mean_h": 14.8
  },
  "features": [
    "rain_24h",
    "rain_72h",
    "rain_7d",
    "rain_max_1h",
    "eff_rain",
    "is_monsoon",
    "sin_doy",
    "cos_doy"
  ],
  "features_unavailable": [
    "rain_24h_gridmax",
    "rain_72h_gridmax",
    "rain_1h_gridmax",
    "eff_rain_gridmax",
    "rain_24h_gridmax_anom"
  ],
  "aois_used": [
    "ML-EKH",
    "MN-NON",
    "MZ-AIZ"
  ],
  "aois_skipped_incomplete_cache": [
    "MN-IMP",
    "SK-GNG"
  ],
  "git_sha": "ace9660",
  "synthetic": false,
  "noney_2022_case_study": {
    "event": "Noney / Tupul, Manipur - June 2022",
    "event_date": "2022-06-29",
    "note": "Case study, not a metric: the event post-dates the GLC label period, so no ground-truth label exists in training data.",
    "peak_probability": 0.001,
    "peak_date": "2022-06-27",
    "timeline": [
      {
        "date": "2022-06-15",
        "p": 0.0,
        "rain_24h_mm": 26.3
      },
      {
        "date": "2022-06-16",
        "p": 0.0,
        "rain_24h_mm": 26.4
      },
      {
        "date": "2022-06-17",
        "p": 0.0,
        "rain_24h_mm": 47.7
      },
      {
        "date": "2022-06-18",
        "p": 0.0,
        "rain_24h_mm": 53.7
      },
      {
        "date": "2022-06-19",
        "p": 0.0,
        "rain_24h_mm": 16.2
      },
      {
        "date": "2022-06-20",
        "p": 0.0,
        "rain_24h_mm": 11.2
      },
      {
        "date": "2022-06-21",
        "p": 0.0,
        "rain_24h_mm": 6.1
      },
      {
        "date": "2022-06-22",
        "p": 0.0,
        "rain_24h_mm": 32.0
      },
      {
        "date": "2022-06-23",
        "p": 0.0,
        "rain_24h_mm": 9.1
      },
      {
        "date": "2022-06-24",
        "p": 0.0,
        "rain_24h_mm": 11.2
      },
      {
        "date": "2022-06-25",
        "p": 0.0,
        "rain_24h_mm": 8.8
      },
      {
        "date": "2022-06-26",
        "p": 0.0,
        "rain_24h_mm": 3.5
      },
      {
        "date": "2022-06-27",
        "p": 0.001,
        "rain_24h_mm": 7.4
      },
      {
        "date": "2022-06-28",
        "p": 0.0,
        "rain_24h_mm": 9.2
      },
      {
        "date": "2022-06-29",
        "p": 0.0,
        "rain_24h_mm": 9.5
      },
      {
        "date": "2022-06-30",
        "p": 0.0,
        "rain_24h_mm": 5.4
      },
      {
        "date": "2022-07-01",
        "p": 0.0,
        "rain_24h_mm": 6.9
      }
    ]
  }
}
```

## Limitations & Ethics
Trained on the NASA Global Landslide Catalog, which is news-derived and over-reports events near roads and towns; inverse-frequency weighting is a coarse correction only. Positives are few, so level-4 statistics are thin. Soil moisture is unavailable historically from Open-Meteo, so antecedent condition is carried by the Kohler-Linsley index instead.
