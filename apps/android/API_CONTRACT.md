# BhuRakshak Android — API contract (what the app consumes)

The Android app is a thin native client over the SAME FastAPI backend as the
web dashboard and the field PWA. Nothing is duplicated server-side.

## Endpoints used today

| Endpoint | App usage |
|---|---|
| `POST /api/v1/auth/login` | JWT; access token in EncryptedSharedPreferences |
| `GET /api/v1/zones?bbox=…` | risk level around the device location |
| `POST /api/v1/reports/sync` | offline queue flush; idempotent by client UUID |
| `GET /api/v1/evacuation/safe-route?lat&lon&population` | pathway model to safest shelter |
| `GET /api/v1/zones/{id}/weather` | rain gauge panel (1h/24h/72h, soil, I-D breach) |
| `WS /ws/live` | live alerts ticker (phase 2 in-app) |

## Offline contract (identical to PWA)

1. Report written to Room with `client_id = UUID4` + UTC `taken_at`.
2. `SyncWorker` (WorkManager, 15-min periodic + connectivity-triggered)
   POSTs `POST /reports/sync` with `batch_id = UUID4`.
3. Backend merges by client UUID; 50 m/1 h same-category duplicates are
   merged server-side (`dup_count++`), so retries are always safe.
4. Photo AI pre-screen (`POST /reports/analyze-photo`, multipart) returns
   `verdict ∈ {POSITIVE, POSSIBLE, NEGATIVE}` + EXIF provenance flags;
   the verdict is attached to the synced report server-side by the photo's
   sha1 media key.

## Verified live state (2026-09-02)

* 536 zones across 5 NER districts with REAL Open-Meteo hourly rainfall
* Model B v1-real-openmeteo serving calibrated probabilities
  (ROC 0.8179 on NASA GLC holdout, median event-day percentile 0.914)
* Levels: `{0: 522, 1: 9, 2: 5}` on current weather
* 8 shelters seeded; safe-route verified bending around an active L4 zone
* 78/78 API tests green in CI-shape (test DB auto-provisioned)
