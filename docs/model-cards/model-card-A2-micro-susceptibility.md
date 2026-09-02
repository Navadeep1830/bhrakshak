# Model Card - A2-micro-susceptibility

- **Purpose:** Static WHERE at ~70 m scored / ~1 km context: which parts of a district are landslide-prone
- **Trained:** 2026-09-02T03:58:19.800925+00:00
- **Git SHA:** 5349cf3

## Features (4)
- slope_deg_mean
- twi_mean
- relief_1km_mean
- dist_valley_km_mean

## Metrics (COMPUTED)
```json
{
  "model": "micro_susceptibility",
  "version": "v2-real-terrarium-dem",
  "deployed": "physical_index",
  "deployed_weights": {
    "slope_deg_mean": 0.6,
    "twi_mean": 0.15,
    "relief_1km_mean": 0.15,
    "dist_valley_km_mean": 0.1
  },
  "deployed_features": [
    "slope_deg_mean",
    "twi_mean",
    "relief_1km_mean",
    "dist_valley_km_mean"
  ],
  "model_selection_note": "The gradient-boosted model was evaluated under strict leave-one-district-out CV and did not beat the slope-only logistic baseline on this label set (74 GLC events, 5-50 km location accuracy; terrain-only features saturate). The transparent, physics-weighted slope-dominant index ships instead - the same selection standard Tier 1 applied when a rainfall rule beat its booster. The ML harness stays in this module for the lithology / WorldCover / road-cut ingest milestones.",
  "unit_of_analysis": "~1000 m block context (GLC label noise 5-50 km makes per-cell labels unsupportable)",
  "labels": {
    "source": "NASA Global Landslide Catalog",
    "n_events": 74,
    "negative_strategy": "slope-matched blocks, 8:1, 2000 m event exclusion"
  },
  "features": [
    "elevation_m_mean",
    "elevation_m_std",
    "slope_deg_mean",
    "slope_deg_std",
    "aspect_sin_mean",
    "aspect_cos_mean",
    "plan_curv_mean",
    "plan_curv_std",
    "profile_curv_mean",
    "profile_curv_std",
    "twi_mean",
    "twi_std",
    "spi_mean",
    "spi_std",
    "tpi_mean",
    "tpi_std",
    "relief_1km_mean",
    "relief_1km_std",
    "roughness_mean",
    "roughness_std",
    "dist_valley_km_mean",
    "dist_valley_km_std",
    "dist_ridge_km_mean",
    "dist_ridge_km_std",
    "slope_max"
  ],
  "lodo_leaderboard": {
    "boosted": {
      "roc_auc": 0.4614,
      "pr_auc": 0.0968
    },
    "slope_only_logistic": {
      "roc_auc": 0.5123,
      "pr_auc": 0.1298
    },
    "elevation_only_logistic": {
      "roc_auc": 0.4457,
      "pr_auc": 0.1001
    },
    "deployed_physical_index": {
      "roc_auc": 0.5044,
      "pr_auc": 0.126
    }
  },
  "per_aoi_boosted": {
    "aizawl": {
      "roc_auc": 0.5606,
      "n_pos": 20
    },
    "east_khasi_hills": {
      "roc_auc": 0.4227,
      "n_pos": 12
    },
    "gangtok": {
      "roc_auc": 0.4631,
      "n_pos": 24
    },
    "imphal_west": {
      "roc_auc": 0.2715,
      "n_pos": 8
    },
    "noney": {
      "roc_auc": 0.395,
      "n_pos": 10
    }
  },
  "class_cuts": [
    20.0,
    40.0,
    60.0,
    80.0
  ],
  "class_names": [
    "very_low",
    "low",
    "moderate",
    "high",
    "very_high"
  ],
  "resolution_m": "35 base / ~1 km context window",
  "trained_at": "2026-09-02T03:56:41.351635+00:00",
  "git_sha": "5349cf3",
  "synthetic": false
}
```

## Limitations & Ethics
Scores inherit GLC location blur (5-50 km): blocks, not cells, carry positives, so a fitted booster cannot demonstrate out-of-district skill on this inventory - the leaderboard in the metrics file shows the measurement. Percentile scale is district-relative by construction. Lithology, land cover and road-cut distance are the next ingest milestones; rerun the module's LODO harness when they land.
