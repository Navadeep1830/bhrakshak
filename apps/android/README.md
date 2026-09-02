# BhuRakshak Field (Android)

Native Android client for the BhuRakshak early-warning platform (SIH26001).
Talks to the **same FastAPI backend** as the web dashboard and the PWA — no
separate server, same JWT auth, same offline-first sync contract.

## Screens

| Screen | What it does | Backend |
|---|---|---|
| **Login** | JWT login for citizen / field official / DC (token persisted in EncryptedSharedPreferences) | `POST /api/v1/auth/login` |
| **Home / Risk Now** | Current hazard level at the device location (geolocated), "I'm safe" check-in | `GET /api/v1/zones?bbox=` |
| **Report** | Geo-tagged photo + category + voice note; queued in Room when offline; AI photo pre-screen (Model V) before queueing | `POST /api/v1/reports/sync`, `POST /api/v1/reports/analyze-photo` |
| **Safe Route** | Evacuation pathway model — routes AROUND live L3+ cells to the safest flat shelter, with ETA | `GET /api/v1/evacuation/safe-route` |
| **Alerts** | Live ticker via WebSocket (`/ws/live`) + alert history; 8 languages | `WS /ws/live`, `GET /api/v1/alerts` |
| **Rain gauge** | 1h/24h/72h accumulations, soil moisture, I-D breach status for the nearest zone | `GET /api/v1/zones/{id}/weather` |

## Offline-first

- Every report is written to a **Room** queue table with a client-generated
  UUID (idempotent sync by contract — the backend merges duplicates by
  `client_id` and 50 m/1 h proximity dedupe).
- A `WorkManager` periodic worker flushes the queue whenever the network
  returns; nothing is ever lost.
- The last-known risk level and shelter list are cached on disk for
  fully-offline display.

## Build

```bash
cd apps/android
./gradlew :app:assembleDebug        # Android Studio also fine
adb install app/build/outputs/apk/debug/app-debug.apk
```

Set the backend URL before building (defaults to the 10.0.2.2 emulator
mapping of localhost:8000):

```
app/src/main/java/in/bhrakshak/field/data/BhrakshakApi.kt  ->  BASE_URL
```

For a real device on the same LAN use `http://<your-ip>:8000/` and make sure
`CORS_ORIGINS` in `.env` includes the app's origin-less requests (CORS does
not apply to native apps, so no change needed).

## Map

The map screen embeds **MapLibre Native** (free, no API key) with the same
Martin vector tiles the dashboard uses, plus the OSM raster fallback.
