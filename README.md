# BhuRakshak (भूरक्षक) — Earth-Guardian

**AI-Based Early Warning & Landslide Risk Monitoring System for the North Eastern Region (NER) of India**

> **SIH 26001 · Ministry of Development of North Eastern Region (MDoNER) · Disaster Management**

From reactive response to predictive protection.

BhuRakshak is a four-layer landslide early-warning platform that fuses static terrain susceptibility, real-time rainfall nowcasts, satellite-derived slope deformation, and exposure-based response priority into a single, ranked, multilingual command center for district administrators, field officials, and citizens of India's North East.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Solution Overview — The 4-Layer Stack](#2-solution-overview--the-4-layer-stack)
3. [Key Features](#3-key-features)
4. [Architecture](#4-architecture)
5. [Tech Stack](#5-tech-stack)
6. [Repository Layout](#6-repository-layout)
7. [Quick Start](#7-quick-start)
8. [Dual-Mode Dashboard (Standalone or Live)](#8-dual-mode-dashboard-standalone-or-live)
9. [Mobile App — Android & PWA](#9-mobile-app--android--pwa)
10. [ML Pipeline & Model Cards](#10-ml-pipeline--model-cards)
11. [Demo Scenarios](#11-demo-scenarios)
12. [API Contract](#12-api-contract)
13. [Testing & Quality Gates](#13-testing--quality-gates)
14. [Deployment & Operations](#14-deployment--operations)
15. [Security Posture](#15-security-posture)
16. [Known Issues & Bug Comparison with bhrakshak-v2](#16-known-issues--bug-comparison-with-bhrakshak-v2)
17. [Roadmap](#17-roadmap)
18. [License & Acknowledgements](#18-license--acknowledgements)
19. [Contributing](#19-contributing)

---

## 1. Problem Statement

The North Eastern Region (NER) — spanning **Aizawl (Mizoram), East Khasi Hills (Meghalaya), Noney + Imphal West (Manipur), and Gangtok (Sikkim)** — frequently faces landslides, flash floods, road blockages, and slope failures due to heavy monsoon rainfall, fragile young-fold mountains, and unplanned hill cutting for roads and settlements. These events disrupt connectivity, damage infrastructure, delay emergency response, and isolate remote villages for days at a time.

**Why the problem is hard:**

- Monitoring is largely **reactive** — authorities learn about a slide when a road is already blocked or a village is already cut off.
- Topography, soil, and rainfall vary at the **30-meter scale**, so a single district-wide "watch" is too coarse and a single sensor is too sparse.
- The region has poor network coverage, so any solution that requires always-online clients is dead on arrival.
- Multiple languages — Khasi, Mizo, Meetei-Mayek, Bengali, Assamese, Nepali, Hindi, English — must be served for alerts to reach citizens in their mother tongue.
- The trigger window is short — the **June 2022 Tupul disaster** in Noney district killed 58 people after a slope above the railway construction site failed. With a 36-hour automated warning, evacuation would have been possible.

The Ministry of Development of North Eastern Region (MDoNER) has therefore asked, via SIH problem statement **26001**, for an **AI-enabled real-time monitoring and prediction system** that helps authorities take preventive action **before** disasters occur.

---

## 2. Solution Overview — The 4-Layer Stack

BhuRakshak decomposes the landslide early-warning problem into four layers that each answer one question, then fuses them into a single ranked hazard level per zone.

| Layer | Question | Engine | Output |
|---|---|---|---|
| **A — Susceptibility** (static) | WHERE can landslides happen? | XGBoost / LightGBM on 24 terrain + geology + land-cover features per 30 m grid cell; **leave-one-district-out (LODO) spatial CV**; backed by real Copernicus GLO-30 / Terrarium DEM | Static 0–100 score per cell → 5 GSI-compatible classes |
| **B — Hazard Nowcast** (dynamic) | WHEN is it dangerous? | LightGBM + isotonic calibration **fused** with interpretable intensity–duration (I-D) thresholds; 72 h rainfall forecast features; **hysteresis** (escalate after 2 ticks, de-escalate after 3) | Hazard level **L0–L4** per response zone, now + f24 / f48 / f72 |
| **C — Deformation** (slow-motion) | IS THE SLOPE MOVING? | Sentinel-1 PSInSAR LOS velocity → robust z-score → DBSCAN creep clusters | Active creep zones; auto **+1 hazard tier upgrade** |
| **D — Exposure & Response** | WHO / WHAT is in the way? | Hazard × population (WorldPop proxy) × road criticality (NH > SH > village) × isolation score | Ranked response-priority queue; blocked-road prediction + NetworkX A\* detours |

**Fusion rule.** `hazard_level = max(threshold_tier, calibrated_ML_tier)`.

**Anti-flapping hysteresis.** Escalate only after **2 consecutive ticks ≥ candidate**; de-escalate only after **3 consecutive ticks below `current − 1`**. This prevents the system from screaming "red" on every thunderstorm and going silent the moment it stops raining.

**Edge AI — Model V (Vision).** A pixel-signature classifier runs on citizen-uploaded photos to detect ground cracks, slope movement, and water seepage, with EXIF GPS cross-check. The verdict (`POSITIVE / POSSIBLE / NEGATIVE`) is attached server-side by SHA-1 media key and surfaces in the DC's hazard-report inbox for triage.

---

## 3. Key Features

| # | Feature | Where it lives |
|---|---|---|
| 1 | **GIS dashboard with 3-D MapLibre map + risk heatmaps** | `apps/dashboard` — Material Design 3 Command Center, hex-grid zones, Martin vector tiles, ECharts SHAP waterfalls, layer rail, radar scrubber |
| 2 | **AI/ML predictive analytics engine (two-tier)** | `ml/` — Model A micro-susceptibility (real Terrarium DEM, 13 terrain derivatives, strict LODO leaderboard) + Model B hazard nowcast (real Open-Meteo + NASA GLC labels, temporal split, isotonic calibration) |
| 3 | **Real-time alerts to authorities + citizens** | `apps/api/app/services/risk_engine.py` → `alerts` table → Redis pub/sub → WebSocket `/ws/live` → dashboard, mobile app (foreground service), and SMS/IVR/Push/Siren channel adapters |
| 4 | **Geo-tagged photo/video uploads + AI verification** | `apps/api/app/services/geoverify.py` (Model V) + Android camera capture + PWA report composer + idempotent `/reports/sync` |
| 5 | **Road connectivity status + detour routing** | `apps/api/app/api/v1/roads.py` (status, NetworkX A\* detour, clearance estimates) + Martin vector tiles + dashboard safe-route view |
| 6 | **Weather-linked risk forecasts** | `risk_engine.py` emits `f24 / f48 / f72` snapshots per zone, projected per-horizon from the calibrated Model B probabilities |
| 7 | **Emergency-response prioritisation** | `apps/api/app/services/priority.py` — ranked queue with hazard × exposure × vulnerability, reason chips, recommended-action templates, NDRF/SDRF incident-command messaging over WebSocket |
| 8 | **Multilingual notifications (8 languages)** | English, Hindi, Bengali, Assamese, Nepali, **Khasi, Mizo, Meetei-Mayek** — API render, PWA UI, and seeded DB templates |
| 9 | **Offline-first field reporting** | PWA (Workbox + Dexie + idempotent batch sync) AND native Android (Room + WorkManager + connectivity-triggered sync) — both work with no network, sync automatically on reconnect |
| 10 | **Live emergency field chat (web ↔ mobile)** | `apps/api/app/api/v1/chat.py` + `apps/dashboard/.../ChatWidget.tsx` + Android chat — 3 s auto-poll + WebSocket reconnect with backoff |
| 11 | **Hazard Reports (AI Inbox)** | Citizen reports flow into a DC triage inbox with Model V photo verdict + verify/reject workflow that feeds back into Model B as a +0.05 risk-contribution |
| 12 | **Cloud-based architecture with offline sync** | 9-service Docker Compose (Postgres+PostGIS+TimescaleDB, Redis, Mosquitto, MinIO, Martin, FastAPI, Celery worker + beat + Flower, Next.js dashboard, PWA) — runs on a 16 GB laptop |
| 13 | **Hardware sensor firmware** | `sensors/firmware/esp32_soil_node/` (ESP32 + MQTT-Wi-Fi soil node) + `sensors/firmware/lorawan_soil_node/` (LoRaWAN long-range node) |
| 14 | **Tupul 2022 disaster replay** | `demo/replay_tupul_disaster.py` — 90-second interactive pitch replay demonstrating the 36-hour automated evacuation warning window |
| 15 | **Storm injector** | `demo/storm_injector.py` + dashboard "Inject Monsoon Cell" button — pushes synthetic extreme rainfall on a district and watches hysteresis escalate zones amber → red in real time |

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                     │
│  Open-Meteo · GSI Bhukosh · NASA COOLR · NASA GLC · Copernicus GLO-30 DEM ·  │
│  Terrarium DEM · Sentinel-1 / LiCSAR · OSM · WorldPop · IoT MQTT sensors     │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  INGEST                                        │
│  Celery beat: rainfall poll 15 m · risk recompute 15 m (+30 s offset) ·       │
│  seismic poll 1 h · satellite ETL daily · MQTT bridge 24×7                     │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
┌──────────────────────────────────────────────────────────────────────────────┐
│                              INTELLIGENCE — ml/                                │
│  ingest/{dem_real, dem, inventory, weather, labels}.py                        │
│  features/micro_terrain.py (13 derivatives incl. D8 routing TWI/SPI)          │
│  models/{susceptibility, hazard_nowcast, micro_susceptibility, deformation,   │
│          backtest}.py                                                         │
│  registry/registry.py (artifact_meta + per-model Markdown cards)              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
┌──────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND — apps/api (FastAPI)                       │
│  REST: /api/v1/{auth, zones, reports, alerts, roads, demo, analytics,         │
│                  briefing, ingest, logistics, incident_command, evacuation,  │
│                  ble, mesh, public, chat, geo, events}                        │
│  WS:   /ws/live  (Redis pub/sub fan-out, 15 s heartbeat)                      │
│  Services: risk_engine · priority · geoverify · briefing · channels/{sms,    │
│            ivr, push, siren} · micro_susc · evacuation · debris_runout ·      │
│            incident_commander · logistics                                     │
│  RBAC: admin / district_admin / field_official / citizen                     │
│  JWT: HS256 access 30 m + refresh 14 d, rotating with family-reuse detection │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
┌──────────────────────────────────────────────────────────────────────────────┐
│                              STORAGE                                           │
│  PostgreSQL 15 + PostGIS + TimescaleDB (4 hypertables: rainfall_obs,         │
│  sensor_readings, displacement_series, risk_snapshots) ·                      │
│  Redis 7 (queues + pub/sub) · MinIO (media) ·                                 │
│  Martin (Rust) vector tiles at /:table/:z/:x/:y.pbf                           │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
┌──────────────────────────────────────────────────────────────────────────────┐
│                            FRONTEND                                            │
│  apps/dashboard (Next.js 16 · React 19 · Tailwind v4 · shadcn/ui ·           │
│                  MapLibre GL 6 · ECharts 6 · Zustand 5)                       │
│  apps/field-pwa (Vite · React · Workbox · Dexie · 8-language UI)              │
│  apps/citizen-pwa (Vite · React · alerts + shelters + I'M-SAFE)               │
│  apps/android (Native Kotlin · Room · WorkManager · foreground service)       │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
┌──────────────────────────────────────────────────────────────────────────────┐
│                       ALERT CHANNELS (dryrun-safe)                            │
│  Push | SMS (MSG91/Twilio stub) | IVR (Exotel stub) | Siren webhook          │
│  All adapters fan out on alert creation; log dry-run when no keys            │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Data-flow example — one citizen hazard report:**

1. Citizen captures a photo + GPS on the Android app (`MainActivity.kt` → `BhrakshakApi.kt`).
2. The report is written to Room (`OfflineQueue.kt`) and queued.
3. `SyncWorker.kt` posts the batch to `POST /api/v1/reports/sync` when online (or on connectivity return).
4. FastAPI's `reports.py` does a replay-safe check by `client_id`, a PostGIS 50 m / 1 h proximity dedupe, persists the row, and publishes a `report` event to Redis `bhrakshak:live`.
5. The next Celery `recompute_risk` tick (15 min) calls `evaluate_all_zones` in `risk_engine.py` — bulk-loads zones + cells + 7-day verified-report counts, runs Model B + I-D thresholds + hysteresis, writes `risk_snapshots`, fires `alerts` on transitions, fans out to SMS/IVR/Push/Siren.
6. `ws.py` broadcasts the `alert` / `risk_diff` / `allclear` event to every connected dashboard and Android foreground service.
7. The dashboard's `OperationsView` re-renders the priority queue; the Android app raises a heads-up notification with vibration.

---

## 5. Tech Stack

| Layer | Tech | Why (defensible) |
|---|---|---|
| **API** | FastAPI 0.115 (async) · pydantic v2 · SQLAlchemy 2.0 async · asyncpg · GeoAlchemy2 · slowapi | Same language as ML · WebSocket for live alerts · auto-OpenAPI for judges · asyncpg for the TimescaleDB hypertables |
| **Worker** | Celery 5.4 · Redis 7 · paho-mqtt 2.x · httpx · Flower | Crash-safe scheduled ingest · ops visibility via Flower |
| **Datastore** | PostgreSQL 15 + PostGIS + TimescaleDB in one `timescale/timescaledb-ha` image · `pgcrypto` | Standard geospatial + time-series without a second DB · 4 hypertables auto-chunk on `ts` · 400-day retention on `rainfall_obs` |
| **Vector tiles** | Martin (Rust) · GeoJSON → MVT at `/:table/:z/:x/:y.pbf` | What real geo teams self-host; MapLibre-ready |
| **Cache / queue / fanout** | Redis 7 (queues, results, pub/sub) | Single 6380 → 6379 mapped service |
| **Object storage** | MinIO (S3-compatible) | Citizen-report media |
| **Auth** | JWT (HS256) access 30 min + refresh 14 d, rotating with **family-reuse revocation**, bcrypt hashes, phone stored as SHA-256 hash | DPDP-compliant posture, bank-grade rotation |
| **Dashboard** | Next.js 16.1.3 · React 19 · TypeScript 5.9 · Tailwind CSS 4 · shadcn/ui (Radix) · MapLibre GL 6.6 · ECharts 6 · Zustand 5 · Lucide | Material Design 3 tokens · type-safe pre-demo · ECharts lets judges interrogate SHAP waterfalls |
| **Field PWA** | Vite 5 · React 18 · TS · Workbox (NetworkFirst /api/*) · Dexie 4 (IndexedDB) | Offline-first field reporting with idempotent UUID batch sync |
| **Citizen PWA** | Vite 5 · React 18 · TS | Lightweight alerts + shelters + "I'm safe" check-in |
| **Android** | Kotlin 2.0 · AGP 8.5.2 · Gradle 8.7 · KSP Room · Retrofit 2.11 + OkHttp 4.12 · WorkManager 2.9 · Foreground service | Native offline queue + connectivity-triggered sync + WS push notifications |
| **ML** | numpy · pandas · geopandas · shapely · scikit-learn 1.4 · LightGBM 4 · XGBoost · `ml/Makefile` offline pipeline · `autoresearch/` harness | LODO spatial CV — gold standard for spatial ML · Open-Meteo + NASA GLC + Copernicus GLO-30 / Terrarium DEM are real |
| **Infra** | Docker Compose (9 services) · Martin config · Mosquitto 2 · `infra/backend.Dockerfile` (python 3.11-slim) | Fits a 16 GB laptop (PG capped 1.5 GB) |

---

## 6. Repository Layout

```
bhrakshak/
├── apps/
│   ├── api/                FastAPI backend (19 routers under /api/v1 + /ws/live + /download/apk)
│   │   ├── app/
│   │   │   ├── api/v1/     auth, zones, reports, alerts, roads, demo, analytics, briefing,
│   │   │   │               ingest, logistics, incident_command, evacuation, ble, mesh,
│   │   │   │               public, chat, geo, events, ws
│   │   │   ├── services/  risk_engine, priority, geoverify (Model V), briefing,
│   │   │   │               channels/{sms, ivr, push, siren, dispatcher},
│   │   │   │               micro_susc, evacuation, debris_runout, incident_commander, logistics
│   │   │   ├── models/     base (Role, User, RefreshToken, ModelRegistry, I18nMessage,
│   │   │   │               SensorReading, SeismicEvent), geo (Zone, RiskCell, CitizenReport,
│   │   │   │               RoadStatus, DisplacementPoint, DisplacementSeries), ops (Alert, Shelter)
│   │   │   ├── schemas/   pydantic v2 schemas
│   │   │   ├── core/      config, security (JWT + bcrypt + refresh hashing)
│   │   │   └── db/        async engine + get_db()
│   │   ├── alembic/versions/  0001_initial (15 tables + 4 hypertables + retention)
│   │   │                     0002_shelters_ai · 0003_ble_sightings · 0004_safe_checkins
│   │   └── tests/         20+ test files (auth RBAC, reports sync, alerts ack, briefing, etc.)
│   ├── worker/            Celery app + beat schedule + 4 tasks (ingest, risk, seismic, sensors) + MQTT bridge
│   ├── dashboard/         Next.js 16 dashboard — Material Design 3 Command Center
│   │   ├── src/app/       root page (login + view router) + 31 in-browser demo API routes
│   │   │   (api/v1/{auth, zones, reports, alerts, roads, demo, analytics, chat, geo, events, evacuation})
│   │   ├── src/components/ views/{CommandCenter, OperationsView, AnalyticsView, FieldPwaView},
│   │   │   map/{MapView, LayerRail, Legend, RadarSlider}, dossier/DossierDrawer, chat/ChatWidget,
│   │   │   nav/TopNav, ticker/Ticker, kpi/KpiBar, ui/{button, input, label, select, sheet, slider,
│   │   │   skeleton, toast, toaster, separator}, pwa/{EdgeVision, i18n}
│   │   ├── src/lib/      client/api.ts (live/demo contract normalization),
│   │   │   server/{store, risk, queries, priority, roads, evacuation, ops-geo, i18n, dc, auth, rng},
│   │   │   types.ts, utils.ts
│   │   └── src/store/    useAppStore (Zustand)
│   ├── field-pwa/         Vite PWA for field officials (offline reports, BLE, mesh, edge vision, rain gauge)
│   ├── citizen-pwa/       Vite PWA for citizens (alerts, shelters, I'M SAFE)
│   └── android/           Native Kotlin app (Room + WorkManager + foreground service + camera + Model V)
├── ml/                    ML pipeline (offline-safe; synthetic fallback when no API keys)
│   ├── ingest/           dem_real (Terrarium DEM), dem (synthetic), inventory (GLC + GSI + COOLR),
│   │                     weather (Open-Meteo + IMD stub), labels (74 in-region events)
│   ├── features/         micro_terrain (13 derivatives, D8 routing, TWI/SPI, valley distance)
│   ├── models/           susceptibility (Model A — LODO CV), hazard_nowcast (Model B — isotonic calib),
│   │                     micro_susceptibility (Model A2 — per-district 1 km grid), deformation (PSInSAR),
│   │                     backtest (POD/FAR/CSI + lead-time)
│   ├── pipeline/         02_build_features · 03_train_model_b · 04_train_model_a
│   ├── registry/         model_registry rows + Markdown model cards
│   ├── artifacts/        Trained .pkl + .npz + metrics JSON + backtest fixture
│   ├── evaluation/      metrics
│   ├── util/            http
│   ├── config/           aois (5 pilot districts polygons)
│   ├── tests/            test_micro_susceptibility, test_aois, test_weather
│   └── Makefile          make data / features / train-susceptibility / train-hazard / backtest / all
├── infra/                 Docker Compose (9 services) · Martin config · Mosquitto · backend.Dockerfile · Postgres init
├── scripts/               seed.py (hex grid) · seed_realistic.py (demo state) · smoke_test.py
│                          simulate_tupul.py · simulate_lorawan.py · run_continuous_research.py
├── demo/                  storm_injector.py · sensor_simulator.py · replay_tupul_disaster.py · backtest_fixture.json
├── sensors/firmware/      esp32_soil_node/ (Arduino sketch + config.h) · lorawan_soil_node/
├── autoresearch/          Overnight AutoML harness (program, prepare, train, evaluate, ledger, run_loop)
├── data/                  pilot_districts.geojson (5 district boundaries)
├── docs/                  architecture.md · runbook.md · model-cards/ · RESEARCH_INTELLIGENCE.md · RESEARCH_FEED.jsonl
├── Makefile               up · down · migrate · seed · data · demo · replay · simulate-tupul · simulate-lorawan · test · lint · dev-*
├── .env.example           All environment variables with sensible demo defaults
├── PROJECT_CONTEXT.md     Deep project context (audit, stack rationale, key files, decisions log)
├── GAP_ANALYSIS.md        SIH26001 requirement matrix — ✅ / ⚠️ / ❌ status per requirement
├── CLAUDE.md              Team coordination rules for shared agent sessions
└── README.md              You are here
```

---

## 7. Quick Start

### Prerequisites

- Docker 24+ and Docker Compose v2 (the only hard requirement for the full stack)
- Node 20+ and Python 3.11+ if you want to run the dashboard / worker / api outside Docker
- JDK 17 only if you want to build the Android APK from source
- An Android device or emulator only if you want to install the APK

### One-command boot (full stack)

```bash
git clone https://github.com/Navadeep1830/bhrakshak.git
cd bhrakshak
cp .env.example .env
make up          # boots postgres+postgis+timescale, redis, mosquitto, minio, martin,
                 # api, worker, beat, flower, dashboard, field-pwa, citizen-pwa
make migrate     # alembic upgrade head → 15 tables + 4 hypertables + retention policy
make seed        # 4 pilot districts → ~5 km hex-grid zones clipped to boundaries
                 # (~536 zones total), demo users, roads, i18n templates, model registry
```

### Running the demo (after `make up`)

```bash
make demo        # realistic demo state + storm injection over East Khasi Hills
```

### URLs

| URL | What |
|---|---|
| http://localhost:3000 | Command Center dashboard (Material Design 3 · MapLibre 3-D · ECharts SHAP) |
| http://localhost:5173 | Field PWA (offline reports · 8 languages) |
| http://localhost:5174 | Citizen PWA (alerts · shelters · I'M SAFE) |
| http://localhost:8000/docs | API OpenAPI (FastAPI auto-docs) |
| http://localhost:8000/download/apk | Pre-built Android APK (served from the repo root) |
| http://localhost:3001/zones/8/60/28.pbf | Martin vector tile sample |
| http://localhost:5555 | Flower (Celery ops view) |
| http://localhost:9001 | MinIO console (`bhrakshak` / `bhrakshak-secret`) |

> Public judge-demo tunnels (finale-day only, may be down otherwise):
> - Dashboard: https://bhrakshak-dashboard-demo.loca.lt
> - API:       https://bhrakshak-api-demo.loca.lt

### Demo logins

| Role | Email | Password | What you can do |
|---|---|---|---|
| Platform Admin | `admin@bhrakshak.in` | `Admin@123` | Everything — all districts, all zones, all ops |
| DC East Khasi Hills | `dc.ekh@bhrakshak.in` | `District@123` | District view (Meghalaya zones only) + ops console |
| DC Aizawl | `dc.aizawl@bhrakshak.in` | `District@123` | District view (Mizoram zones only) + ops console |
| Field Official (Noney) | `field.noney@bhrakshak.in` | `Field@123` | Ops + PWA view + report verification |
| Citizen (Noney) | `citizen@bhrakshak.in` | `Citizen@123` | PWA view only — reports + I'M SAFE + alerts |

### Common make targets

```bash
make help        # lists all targets
make up          # boot the entire platform
make down        # stop everything
make nuke        # stop and delete volumes (fresh start)
make logs        # tail logs from all services
make migrate     # apply alembic migrations inside the api container
make seed        # seed 4 pilot districts + users + roads + i18n + model-registry
make demo        # full scripted demo state + storm injection
make data        # build offline-safe ML datasets + fixtures
make test        # run API tests against the running stack
make lint        # python -m compileall on apps/api, apps/worker, ml, scripts, demo
make replay      # 90-second interactive Tupul disaster replay (no Docker needed)
make simulate-tupul      # 15-minute time-lapse Tupul simulation
make simulate-lorawan    # virtual ESP32/LoRaWAN telemetry publisher
```

---

## 8. Dual-Mode Dashboard (Standalone or Live)

The dashboard in this repo is **dual-mode** — it can run with **zero infrastructure** OR against a real FastAPI backend, and it auto-detects which to use at boot time.

### How the probe works

`apps/dashboard/src/lib/client/api.ts` runs `initApiMode()` before the first login:

1. If `NEXT_PUBLIC_API_URL` is set in env, use it (LIVE).
2. If the dashboard is served over HTTPS from `*.loca.lt` (the judge-demo tunnel), pair it with `https://bhrakshak-api-demo.loca.lt` (LIVE).
3. Otherwise, probe `http://localhost:8000/health` and `http://127.0.0.1:8000/health` — if either responds 200, use it (LIVE).
4. Fall back to in-browser demo routes at `/api/v1/*` (DEMO) — these are real Next.js route handlers under `src/app/api/v1/*` that mirror the FastAPI contract.

The login screen shows a chip indicating the mode: **"LIVE mode — real FastAPI backend at http://localhost:8000"** or **"DEMO mode — no backend detected; in-browser data"**.

### Why this matters

- **Judges can run the dashboard without Docker.** Just `cd apps/dashboard && npm install && npm run dev` and open http://localhost:3000 — every demo feature works against the in-browser demo store.
- **Developers can switch backends** by setting `NEXT_PUBLIC_API_URL` to a tunnel URL or production domain.
- **The same view code works in both modes** because `lib/client/api.ts` normalises the contract differences (e.g. `AlertOut` shape varies between the demo route and FastAPI — `normAlert()` handles both).

### Standalone dashboard (no backend)

```bash
cd apps/dashboard
npm install
npm run dev
# open http://localhost:3000 — DEMO mode, no Docker, no Postgres
```

### Live dashboard (with FastAPI)

```bash
make up && make migrate && make seed
# dashboard probes :8000 and auto-switches to LIVE mode
```

---

## 9. Mobile App — Android & PWA

### Native Android app (`apps/android/`)

| Screen | What it does | Backend |
|---|---|---|
| Login | JWT login for citizen / field official / DC (token persisted in EncryptedSharedPreferences) | `POST /api/v1/auth/login` |
| Home / Risk Now | Current hazard level at the device location (geolocated, worst zone within 5 km); cached for offline display | `GET /api/v1/zones?bbox=` |
| I'M SAFE check-in | Stored in Room on-device; survives offline | local (Room `checkins`) |
| Report | Geo-tagged hazard report + **camera photo with Model V AI pre-screen** (`/reports/analyze-photo` before queueing when online); queued in Room when offline | `POST /api/v1/reports/sync`, `POST /api/v1/reports/analyze-photo` |
| Safe Route | Evacuation pathway model — routes AROUND live L3+ cells to the safest flat shelter; polyline drawn in-app; last route cached for offline | `GET /api/v1/evacuation/safe-route` |
| Rain gauge | 1h/24h/48h/72h/7d accumulations, effective (antecedent) rainfall, soil moisture, **I-D threshold breach status**; cached for offline | `GET /api/v1/zones/{id}/weather` |
| Alerts | Alert history (levels, channels, timestamps) | `GET /api/v1/alerts` |
| Live push | Foreground service on the WebSocket raises heads-up notifications for `alert` and `ndrf_message` events | `WS /ws/live` |

**Offline-first contract (the NER-valley guarantee):**

- Every report is written to a Room queue table with a client-generated UUID (idempotent sync — the backend merges duplicates by `client_id` and 50 m / 1 h proximity dedupe).
- A `WorkManager` periodic worker flushes the queue every 15 minutes AND is triggered **immediately on connectivity return** via a `ConnectivityManager` callback.
- Risk level, safe-route, and rain-gauge screens fall back to last-known cached state with an explicit OFFLINE banner when the network is gone.
- Photos are stored under `files/photos/` until sync; the Model V SHA-1 media key rides on the queued row.

**Pre-built APK:** the latest assembled debug APK is committed at the repo root and at `apps/android/bhrakshak-field-latest.apk`. You can also download it from a running API via `GET /download/apk`.

**Build from source:**

```bash
cd apps/android
./gradlew :app:assembleDebug        # Android Studio also fine
adb install app/build/outputs/apk/debug/app-debug.apk
```

The gradle wrapper (8.7) + AGP 8.5.2 + Kotlin 2.0.20 + KSP (Room compiler) are pinned; JDK 17 required. `gradle.properties` enables AndroidX.

**Backend URL:** defaults to `https://bhrakshak-api-demo.loca.lt` (the public cloud tunnel) and can be repointed to a custom LAN IP (e.g. `http://10.68.3.168:8000`) or production domain directly on the login screen.

### Field PWA (`apps/field-pwa/`)

- Vite 5 + React 18 + TypeScript + Workbox (NetworkFirst `/api/*`) + Dexie 4 (IndexedDB)
- 8-language UI (`en`, `hi`, `as`, `bn`, `ne`, `kha`, `lus`, `mni-Mtei`) with safe English fallback
- 5-category hazard report form (`crack | slope_movement | blocked_road | past_slide | water_seepage`)
- Auto-retry on reconnect (`online` event listener) + manual "Sync now"
- BLE crowd panel + mesh relay panel + edge-vision inspector + rain gauge

### Citizen PWA (`apps/citizen-pwa/`)

- Lightweight alerts feed + nearby shelters list + "I'M SAFE" check-in
- Used by citizens without the native Android app

---

## 10. ML Pipeline & Model Cards

The ML pipeline lives in `ml/` and is **offline-safe** — every external source has a synthetic fallback so the pipeline runs without API keys. Real data is wired for Open-Meteo (rainfall), NASA GLC (landslide inventory), Copernicus GLO-30 / Terrarium DEM (elevation), and Sentinel-1 / LiCSAR (deformation).

### Model A — Susceptibility (static, per-pixel)

- **Engine:** XGBoost with LightGBM sklearn fallback
- **Features:** 24 terrain + geology + land-cover features per 30 m grid cell
- **CV:** Leave-one-district-out (LODO) spatial CV on 16 000 synthetic cells across 4 districts
- **Output:** Static 0–100 score per cell → 5 GSI-compatible classes
- **Real data:** Terrarium DEM at ~35 m resolution for all 5 AOIs (keyless)
- **Card:** `docs/model-cards/model-card-A2-micro-susceptibility.md`

### Model B — Hazard Nowcast (dynamic, per-zone per-tick)

- **Engine:** LightGBM with isotonic calibration, fused with interpretable intensity-duration (I-D) thresholds
- **Features:** 72 h rainfall forecast, antecedent effective rainfall (Kohler-Linsley, 48 h half-life), soil moisture, seismic trigger flag, verified-report count (7-day)
- **CV:** Temporal split ≤2019 / 20–22 / 23–24 (train/val/test)
- **Output:** Calibrated P(landslide ≤24 h) + hazard level L0–L4 per zone, now + f24/f48/f72
- **Fusion:** `hazard_level = max(threshold_tier, calibrated_ML_tier)` with 2-tick escalate / 3-tick de-escalate hysteresis
- **Baseline:** Caine (1980) I-D threshold curves
- **Card:** `docs/model-cards/model-card-B-hazard-nowcast.md`

### Model C — Deformation (slow-motion)

- **Engine:** Robust z-score on PSInSAR LOS velocity + DBSCAN creep cluster detection
- **Output:** Active creep zones; auto **+1 hazard tier upgrade** when a cluster overlaps a zone

### Model D — Exposure & Response Priority

- **Engine:** Hazard × population (WorldPop proxy) × road criticality (NH > SH > village) × isolation score
- **Output:** Ranked response-priority queue with human-readable reason chips and recommended-action templates

### Model V — Edge Vision (citizen reports)

- **Engine:** EXIF GPS cross-check (>300 m flag) + pixel-signature classifier (scarp-edge energy + vegetation fraction)
- **Output:** Photo verdict `POSITIVE / POSSIBLE / NEGATIVE` + GPS mismatch flag, attached server-side by SHA-1 media key
- **Used by:** Android camera capture, PWA report composer, DC hazard-report inbox

### Running the ML pipeline

```bash
cd ml
make data        # download (or generate synthetic) DEM, inventory, weather, labels
make features    # build the model A training dataset
make train-susceptibility   # train Model A with LODO CV
make train-hazard           # train Model B with isotonic calibration
make backtest    # compute POD/FAR/CSI per level + lead-time histogram
make all         # full pipeline end-to-end
make clean       # remove artifacts
```

### Honest limitations (for judge Q&A)

- **Tier-2 ML:** with 74 GLC events at 5–50 km accuracy, the boosted Model A2 did not beat a slope-only baseline under LODO; the deployed scorer is the transparent physics-weighted index, and the leaderboard is published in `ml/artifacts/model_a_micro_metrics.json`. Re-run the harness when GSI lithology / ESA WorldCover / road-cut distance ingests land.
- **GLC label accuracy** bounds micro-scale resolution; block-level analysis is the honest unit.
- **IMD swap** is a config change away — Open-Meteo is the current provider (`ml/ingest/weather.py` has an `IMDProvider` stub raising-not-faking).
- **InSAR deformation** is currently synthetic; Terrarium DEM IS real satellite-derived elevation (SRTM family).

---

## 11. Demo Scenarios

### Scenario 1 — Interactive Tupul Disaster Replay (90 seconds)

Replays the 72-hour antecedent rainfall buildup, InSAR ground kinematics, and the **36-hour automated evacuation warning window** of the June 2022 Tupul disaster in Noney district, Manipur.

```bash
make replay                # uses the in-repo venv-relative python
# OR
python demo/replay_tupul_disaster.py --standalone
```

What to watch for: the system escalates the zone from L0 → L1 → L2 → L3 → L4 over 36 hours of antecedent rainfall, fires the alert at L3 (24 hours before the failure), and would have given NDRF enough lead time to evacuate the railway construction workers.

### Scenario 2 — Monsoon Storm Injection (live demo)

Injects synthetic extreme rainfall on a district and watches hysteresis escalate zones in real time.

```bash
python demo/storm_injector.py --district "East Khasi Hills" --peak 60 --hours 3
```

Or click **"Inject Monsoon Cell"** on the Command Center map (`http://localhost:3000`, sign in as admin — quick-pick).

What to watch for: zones escalate amber → red on the map, alerts fire on the live ticker, SMS templates render in 8 languages, roads flip to blocked state, the priority queue reshuffles, and the next Celery `recompute_risk` tick (15 min) de-escalates zones once the storm passes (3-tick hysteresis).

### Scenario 3 — LoRaWAN Sensor Simulation

Simulates virtual ESP32 / LoRaWAN edge sensor telemetry publishing.

```bash
make simulate-lorawan      # 6 iterations × 0.2 s interval
# OR
python scripts/simulate_lorawan.py --iterations 6 --interval 0.2
```

What to watch for: the MQTT bridge writes `sensor_readings` rows, the WebSocket broadcasts `sensor` events, and the rain gauge / soil moisture widgets on the dashboard update live.

### Scenario 4 — Full Tupul Time-Lapse (15 minutes)

A 15-minute time-lapse of the Tupul disaster for a longer demo or pitch.

```bash
make simulate-tupul
# OR
python scripts/simulate_tupul.py
```

### Scenario 5 — Standalone Dashboard (zero infra)

The fastest way to show the dashboard to a judge who can't install Docker.

```bash
cd apps/dashboard
npm install
npm run dev
# open http://localhost:3000 — DEMO mode, in-browser data
```

Pilot districts (zone codes like `ML-EKH-004`):

- **Aizawl (MZ)** — Mizoram
- **East Khasi Hills (ML)** — Meghalaya
- **Noney + Imphal West (MN)** — Manipur
- **Gangtok (SK)** — Sikkim

---

## 12. API Contract

FastAPI auto-docs are served at `http://localhost:8000/docs` (Swagger UI) and `http://localhost:8000/redoc` (ReDoc). The OpenAPI schema is generated from the pydantic v2 schemas in `apps/api/app/schemas/schemas.py`.

### Public surface

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/login` | public | JWT login (access + refresh) |
| POST | `/api/v1/auth/refresh` | public | Refresh-token rotation with family-reuse detection |
| POST | `/api/v1/auth/logout` | any | Revoke refresh family |
| GET  | `/api/v1/auth/me` | any | Current user |
| POST | `/api/v1/auth/register` | admin | Create a new user |
| GET  | `/api/v1/zones` | any | List zones with current risk (PostGIS bbox filter) |
| GET  | `/api/v1/zones/{id}/dossier` | any | Full zone dossier (rain series, sensors, reports, alerts, drivers, history, flood, isolation) |
| GET  | `/api/v1/zones/{id}/weather` | any | 1h/24h/48h/72h/7d rain + effective + soil moisture + I-D breach |
| POST | `/api/v1/reports/sync` | any | Idempotent offline batch sync (client-UUID + 50 m / 1 h dedupe) |
| GET  | `/api/v1/reports` | staff | List reports (status filter, limit) |
| PATCH | `/api/v1/reports/{id}/verify` | staff | Verify / reject a citizen report (feeds back into Model B) |
| POST | `/api/v1/reports/analyze-photo` | any | Model V photo pre-screen (multipart) |
| GET  | `/api/v1/alerts` | any | Alert history |
| POST | `/api/v1/alerts/{id}/ack` | staff | Acknowledge an alert |
| POST | `/api/v1/alerts/preview-fire` | admin | Multilingual alert dry-run |
| GET  | `/api/v1/roads/status` | any | Road connectivity status |
| GET  | `/api/v1/roads/detour` | any | NetworkX A\* detour route |
| GET  | `/api/v1/roads/clearance-estimate` | any | Estimated clearance time for blocked roads |
| POST | `/api/v1/demo/inject-rainfall-storm` | admin | Inject synthetic rainfall storm |
| POST | `/api/v1/demo/reset-storm` | admin | Reset storm state |
| POST | `/api/v1/demo/replay-event` | admin | Replay a historical event |
| GET  | `/api/v1/analytics/kpis` | any | KPI bar (zones by level, alerts 24h, reports 24h, sensors live) |
| GET  | `/api/v1/analytics/priority` | staff | Ranked response-priority queue |
| GET  | `/api/v1/analytics/registry` | any | Model registry table |
| GET  | `/api/v1/analytics/backtest` | any | POD/FAR/CSI per level + lead-time histogram |
| GET  | `/api/v1/analytics/micro-heatmap` | any | Per-pixel susceptibility grid (Model A2) |
| POST | `/api/v1/analytics/micro-heatmap/refresh-susceptibility` | admin | Recompute & persist zone susceptibility from real DEM stats |
| GET  | `/api/v1/analytics/briefing-dossier/{zoneId}` | any | Per-zone briefing dossier |
| GET  | `/api/v1/briefing` | any | DC daily-risk briefing (HTML, print-to-PDF) |
| POST | `/api/v1/ingest` | sensor | HTTP fallback for MQTT sensor ingest |
| GET  | `/api/v1/logistics/*` | staff | Logistics (shelters, teams, dispatch) |
| GET  | `/api/v1/incident_command/*` | staff | NDRF/SDRF incident command (teams, dispatch, messaging) |
| GET  | `/api/v1/evacuation/safe-route` | any | Evacuation pathway model (A\* around L3+ cells) |
| GET  | `/api/v1/evacuation/shelters` | any | Nearby shelters with capacity + AI safe-route score |
| GET  | `/api/v1/geo/zones` | any | GeoJSON FeatureCollection of zones (DB-free demo fallback) |
| GET  | `/api/v1/geo/roads` | any | GeoJSON FeatureCollection of road status |
| GET  | `/api/v1/geo/reports` | any | GeoJSON FeatureCollection of citizen reports |
| GET  | `/api/v1/geo/ops` | any | GeoJSON of ops overlays (shelters, teams, dispatch) |
| GET  | `/api/v1/geo/radar` | any | Radar-style rainfall intensity by zone |
| GET  | `/api/v1/events` | any | Live ticker events (`?since=N`) |
| GET  | `/api/v1/chat/messages` | staff | Live chat history (Redis-backed) |
| POST | `/api/v1/chat/send` | staff | Send a chat message |
| GET  | `/api/v1/ble/*` | any | BLE crowd-sighting endpoints |
| GET  | `/api/v1/mesh/*` | any | Mesh relay endpoints |
| GET  | `/api/v1/public/*` | public | Public citizen-facing endpoints (no auth) |
| WS   | `/ws/live` | any | Live events (alert, risk_diff, sensor, allclear, chat_message, ndrf_message) + 15 s heartbeat |
| GET  | `/download/apk` | public | Pre-built Android APK |
| GET  | `/health` | public | Health check (demo_mode flag) |

> The same surface is mirrored in-browser by the Next.js route handlers at `apps/dashboard/src/app/api/v1/*` for the standalone demo mode — same paths, same payloads (with minor shape differences normalised by `lib/client/api.ts`).

---

## 13. Testing & Quality Gates

### Backend

```bash
make test       # runs pytest inside the api container, against the live DB
# OR
cd apps/api && pytest -q
```

The suite covers:

- `test_api.py` — health, auth/login (bad creds), auth/me (no auth), auth/refresh rotation + **family reuse detection**, RBAC citizen → verify_report denial, idempotent reports/sync, RBAC citizen → demo_storm denial, zones requires auth
- `test_briefing.py`, `test_chaos.py`, `test_debris_runout.py`, `test_explainability.py`, `test_field_pwa_reports.py`, `test_geotech_sensor.py`, `test_incident_command.py`, `test_lorawan_simulation.py`, `test_logistics.py`, `test_micro_heatmap.py`, `test_model_contract.py`, `test_new_features.py`, `test_roads_clearance.py`, `test_tupul_simulation.py`, `test_ai_incident_commander.py`, `test_ble.py`

> ⚠️ **The suite auto-skips when Postgres is unreachable.** `apps/api/tests/conftest.py` probes the DB at import time and `pytest.skip()`s every test if it's not up — so `pytest -q` will pass vacuously on a fresh checkout without `make up`. Always run with the stack up for a real signal.

### Dashboard

```bash
cd apps/dashboard && npm run typecheck   # tsc --noEmit
cd apps/dashboard && npm run build       # next build
```

### Field PWA

```bash
cd apps/field-pwa && npm run build       # vite build
```

### ML

```bash
cd ml && pytest tests/                    # test_micro_susceptibility, test_aois, test_weather
```

### Smoke test (end-to-end against a running stack)

```bash
python scripts/smoke_test.py             # 25+ assertions against localhost:8000
```

---

## 14. Deployment & Operations

### Production deployment checklist

1. **Generate a strong `JWT_SECRET`** (≥ 32 chars) and set it in `.env`. The API will refuse to start with the default key when `DEMO_MODE=false` — this is a deliberate fail-fast guard in `apps/api/app/main.py`'s lifespan handler.
2. **Set `DEMO_MODE=false`** in `.env` to disable the offline-fallback demo users in `apps/api/app/api/deps.py`.
3. **Wire alert channel providers** in `.env`: `MSG91_API_KEY` (SMS), `TWILIO_*` (alt SMS), `FCM_CREDENTIALS_JSON` (push), `EXOTEL_*` (IVR), `SIREN_WEBHOOK_URL`. All channels log dry-run by default so `make up && make demo` works with no keys.
4. **Set `CORS_ORIGINS`** to your production dashboard URL (comma-separated).
5. **Pick a weather provider:** `BHURAKSHAK_WEATHER_PROVIDER=open_meteo` (default, free, no key) or `imd` (needs `IMD_API_KEY`).
6. **Run migrations** (`make migrate`) before the first boot.
7. **Seed** (`make seed`) for the pilot districts — or skip if you have your own zone data.
8. **Build the Android APK** (`cd apps/android && ./gradlew :app:assembleRelease`) and host it at the repo root for `/download/apk` to serve.
9. **Front the API with a TLS-terminating reverse proxy** (nginx, Caddy) — the FastAPI listens on plain HTTP.
10. **Configure TimescaleDB retention** — `rainfall_obs` is set to 400 days by default; adjust in `apps/api/alembic/versions/0001_initial.py` if you need longer history.

### Operations runbook

See `docs/runbook.md` for the full operations runbook — service health checks, log locations, common failure modes, the finale-day checklist, and how to debug each subsystem.

### Resource footprint (single-host demo)

| Service | Memory cap | Notes |
|---|---|---|
| postgres + PostGIS + TimescaleDB | 1500 MB | `deploy.resources.limits.memory` in docker-compose |
| redis | 256 MB | `--maxmemory 256mb --maxmemory-policy allkeys-lru` |
| api (uvicorn) | unbounded (small) | single worker by default; scale with `--workers N` |
| worker (Celery) | unbounded (small) | `-c 2` (2 concurrent) by default |
| dashboard (Next.js dev) | unbounded (Node) | `NODE_OPTIONS=--max-old-space-size=512` for production |
| field-pwa (Vite dev) | small | |
| martin (Rust) | tiny | vector-tile cache in PG |
| mosquitto | tiny | |
| minio | tiny | object storage for citizen media |
| flower | tiny | ops UI |

**Total:** ~3 GB on a 16 GB laptop, comfortably alongside other dev tools.

---

## 15. Security Posture

| Concern | Implementation | File |
|---|---|---|
| JWT access tokens | HS256, 30-minute expiry | `apps/api/app/core/security.py` |
| Refresh-token rotation | 14-day expiry, rotating on each use, with **family-based reuse detection** — presenting a used/revoked refresh token revokes the whole family at once | `apps/api/app/api/v1/auth.py`, `apps/api/app/core/security.py` |
| Token storage | Token **hashes** stored (not raw) | `apps/api/app/models/base.py:RefreshToken` |
| Password hashing | bcrypt | `apps/api/app/core/security.py` |
| Phone-number privacy | SHA-256 hash stored (DPDP-compliant) — raw number never persisted | `apps/api/app/models/base.py:User.phone_hash` |
| RBAC | 4 roles (admin / district_admin / field_official / citizen) enforced per-route via `require_roles(*roles)` | `apps/api/app/api/deps.py` |
| Rate limiting | slowapi 600/min/IP default + auth login additionally rate-limited | `apps/api/app/main.py:49` |
| CORS | Configurable allowlist (default: dashboard + PWA only) | `apps/api/app/core/config.py:cors_origins` |
| JWT secret guard | Refuses to start with the default key when `DEMO_MODE=false` | `apps/api/app/main.py:lifespan` |
| Photo verification | EXIF GPS cross-check (>300 m flag) + Model V pixel-signature verdict | `apps/api/app/services/geoverify.py` |
| Demo credentials | Documented in README, .env.example, and seed script — bcrypt-hashed in DB | `scripts/seed.py` |

> ⚠️ The committed `.env.example` ships with `JWT_SECRET=change-me-in-production-9f2c1a`. **Change this in any non-demo deployment.** The lifespan guard will refuse to start in production mode with the default key.

---

## 16. Known Issues & Bug Comparison with bhrakshak-v2

This section documents the bugs and divergences identified during a side-by-side audit of this repo (`bhrakshak`, the main one) and the parallel work repo `bhrakshak-v2` at `https://github.com/SPY-Github22/bhrakshak-v2`. The two repos diverged after the 2026-08-29 audit; the v2 repo kept the older Next.js 14 / Tailwind v3 / MapLibre 4 stack but added the **Hazard Reports (AI Inbox) tab** and a **consistently configured Redis port** that the main repo briefly broke.

### 16.1 Bugs fixed in this repo (relative to bhrakshak-v2)

| # | Bug | v2 file:line | Fix landed in this repo |
|---|---|---|---|
| 1 | **APK download endpoint 500s** — hardcoded `/home/sudpy/Landslide Proto/bhrakshak/bhrakshak-field-latest.apk` (broken on any other machine) | `apps/api/app/main.py:72` (v2) | `apps/api/app/main.py:73-83` — resolves `Path(__file__).resolve().parents[3] / "bhrakshak-field-latest.apk"` relative to the repo root |
| 2 | **`User()` fallback missing `full_name`** → `TypeError` on the DB-unreachable path in `get_current_user` | `apps/api/app/api/deps.py:34-39` (v2) | `apps/api/app/api/deps.py:34-41` — adds `full_name="Demo Administrator"` and `preferred_lang="en"` |
| 3 | **`Role.ADMIN` AttributeError** — `Role.ADMIN` doesn't exist (only lowercase `Role.admin`) → 500 on malformed JWT in demo offline path | `apps/api/app/api/deps.py:33,52` (both repos) | **Fixed in this session** — changed both branches to `Role.admin` |
| 4 | **Reports sync not replay-safe** — every retry re-hit the dedupe path, incrementing `dup_count` on replays | v2 `apps/api/app/api/v1/reports.py` | `apps/api/app/api/v1/reports.py:65` — short-circuits on `client_id` match before dedupe |
| 5 | **Stale `@tanstack/react-query` dep** declared but unused | v2 `apps/dashboard/package.json:12` | Removed in this repo (custom `usePoll` hook instead) |

### 16.2 Bugs present in BOTH repos (still open)

| # | Bug | File:line | Severity | Fix |
|---|---|---|---|---|
| 1 | **Reports-sync contract mismatch** — Next.js demo route expects `{ queued: [...] }`, FastAPI expects `SyncBatchIn { batch_id, reports: [...] }`. The PWA always sends `{ queued }`, so PWA-to-live-FastAPI sync would 422. | `apps/dashboard/src/app/api/v1/reports/sync/route.ts:18` vs `apps/api/app/schemas/schemas.py` | 🔴 P0 | Send `{ batch_id, reports }` in both modes (or normalise in `api.syncReports`) |
| 2 | **`/alerts/preview-fire` HTTP contract mismatch** — FastAPI expects query params (`zone_id`, `level`, `lang`); demo + client use a JSON body `{ zone_id, language }`. Live will 422. | `apps/dashboard/src/lib/client/api.ts:249-254` vs `apps/api/app/api/v1/alerts.py:57` | 🔴 P0 | Use query params |
| 3 | **`/reports/{id}/verify` HTTP method mismatch** — FastAPI is `PATCH` with query `decision: str`; demo + client use `POST` with body `{ reject: bool }`. Live will 405. | `apps/dashboard/src/lib/client/api.ts:319-324` vs `apps/api/app/api/v1/reports.py:288` | 🔴 P0 | Use PATCH with query params |
| 4 | **`/chat/send` role guard mismatch** — demo route allows citizens; FastAPI 403s citizens. A citizen who sends chat in demo mode gets 403 in live. | `apps/dashboard/src/app/api/v1/chat/send/route.ts:8` vs `apps/api/app/api/v1/chat.py:119-123` | 🟠 P1 | Align on `STAFF_ROLES` |
| 5 | **JWT default secret committed in repo** — `change-me-in-production-9f2c1a` | `apps/api/app/core/config.py:25` | 🟠 P1 | Lifespan guard already blocks this in production; document it loudly in README |
| 6 | **Hardcoded demo passwords** in PWA auto-login (`apps/field-pwa/src/db.ts:112`, `BleCrowdPanel.tsx:109`, `MeshRelayPanel.tsx:52`) | same in both | 🟠 P1 | Use `localStorage` token or remove auto-login |
| 7 | **Public tunnel URL baked into Android release APK** — `https://bhrakshak-api-demo.loca.lt` hardcoded as `API_BASE_URL` buildConfigField | `apps/android/app/build.gradle.kts:19-20` | 🟠 P1 | If the tunnel is hijacked, all field traffic is MITM-able. Move to a configurable BuildConfig field with a sane default |
| 8 | **Makefile hardcoded `/home/sudpy/Projects/Bhrakshak/.venv/bin/python`** in `replay`, `simulate-tupul`, `simulate-lorawan` targets | `Makefile:45,48,51` | 🟠 P1 | **Fixed in this session** — replaced with `$(PYTHON)` (default `python`) |
| 9 | **README hardcoded `/home/sudpy/Downloads/bhrakshak-field-latest.apk`** | `README.md:39` (both) | 🟠 P1 | **Fixed in this session** — now points to the in-repo APK path |
| 10 | **`scripts/run_continuous_research.py` hardcoded `/home/sudpy/Projects/Bhrakshak/docs/RESEARCH_FEED.jsonl`** | `scripts/run_continuous_research.py:52` | 🟠 P1 | **Fixed in this session** — now `Path(__file__).resolve().parents[1] / "docs" / "RESEARCH_FEED.jsonl"` |
| 11 | **`apps/android/README.md` hardcoded `/home/sudpy/Downloads/...`** | `apps/android/README.md:37` | 🟠 P1 | **Fixed in this session** — now points to the in-repo APK path |
| 12 | **Missing DB indexes** — `citizen_reports.created_at`, `alerts.fired_at`, `alerts.level`, `risk_cells.zone_id` have no btree index; the GIST on `geom` doesn't help the dedupe query | `apps/api/alembic/versions/0001_initial.py` | 🟡 P2 | Add a `0005_indexes.py` migration |
| 13 | **`/geo/reports` no `LIMIT`** — returns every report as GeoJSON; could be MB-sized with 10k+ reports | `apps/api/app/api/v1/geo.py:115` | 🟡 P2 | Add `limit` query param (default 500) |
| 14 | **`/zones` loads every Zone + every RiskCell into memory per request** | `apps/api/app/api/v1/zones.py:94-98` | 🟡 P2 | Push `level_min` into SQL; add `limit` |
| 15 | **`hashlib.sha1(data)` + `classify_photo(data)` on the event loop** — ~50 ms CPU per 12 MB image | `apps/api/app/api/v1/reports.py:265,272` | 🟡 P2 | Offload to `anyio.to_thread.run_sync` |
| 16 | **`json.loads(FIXTURE_PATH.read_text())` sync I/O in async handlers** | `apps/api/app/api/v1/zones.py:27`, `demo.py:144`, `analytics.py:57` | 🟡 P2 | Cache the parsed JSON at module load |
| 17 | **100+ `print()` statements** in ML pipeline + scripts (should be `logging`) | `ml/models/*.py`, `scripts/*.py` | 🟢 P3 | Convert to `logging.getLogger(__name__).info(...)` |
| 18 | **Tests auto-skip without Postgres** — `pytest -q` passes vacuously on a fresh checkout | `apps/api/tests/conftest.py:43-49` | 🟢 P3 | Document loudly (done here) OR add a `--require-db` flag |
| 19 | **Khasi / Mizo / Meetei-Mayek i18n strings need native-speaker review** | `apps/field-pwa/src/i18n/index.ts:1` (flagged `TODO`) | 🟢 P3 | Native review before finale |

### 16.3 Features in `bhrakshak-v2` that this repo does NOT have

| # | Feature | v2 file | Status in this repo |
|---|---|---|---|
| 1 | **Hazard Reports (AI Inbox) tab** in the Operations page — a dedicated triage inbox for citizen reports with the Model V photo verdict + verify/reject buttons | `apps/dashboard/src/app/operations/page.tsx:322` (`ReportsInbox` component) | The underlying `/reports` and `/reports/analyze-photo` endpoints and the `verify` route exist, but the dashboard doesn't surface an inbox tab. **Port the `ReportsInbox` component from v2 to make this a fourth tab in `OperationsView`.** |
| 2 | **Consistent Redis port (`6380`)** between `config.py` and `docker-compose.yml` | v2 `apps/api/app/core/config.py:15` | **Fixed in this session** — main's `config.py` was previously `6600` (mismatch with compose's `6380:6379`); now `6380`. |

### 16.4 Features in this repo that `bhrakshak-v2` does NOT have

| # | Feature | This repo's file | Why it matters |
|---|---|---|---|
| 1 | **In-browser demo API (31 Next.js route handlers)** — mirrors the FastAPI contract, runs with zero infrastructure | `apps/dashboard/src/app/api/v1/*` | Judges can run the dashboard without Docker |
| 2 | **`/api/v1/events` FastAPI router** — `/events?since=N` ticker contract sourced from real `Alert`/`RiskCell` rows (with DB-free fallback) | `apps/api/app/api/v1/events.py` | Live ticker has a real source, not just WS-passthrough |
| 3 | **`/api/v1/geo/{zones,roads,reports,ops,radar}` FastAPI routers** — GeoJSON FeatureCollections with DB-free demo fallbacks | `apps/api/app/api/v1/geo.py` | Dashboard map has GeoJSON layers in addition to Martin MVT |
| 4 | **Pre-login API mode probe** (`useApiMode` + `initApiMode`) — dashboard knows LIVE vs DEMO before the first login | `apps/dashboard/src/lib/client/api.ts:41-71` + `src/app/page.tsx:34-35` | The login screen shows the mode chip |
| 5 | **Live/demo contract normalization** (`normAlert`, `normPriority`, `normDossier`) | `apps/dashboard/src/lib/client/api.ts:90-110` | Same view code works unchanged against either source |
| 6 | **Material Design 3 dashboard** (Next.js 16 + React 19 + Tailwind v4 + shadcn/ui + MapLibre 6 + ECharts 6 + Zustand 5) | `apps/dashboard/package.json` | Modern, type-safe, Material-You design tokens |
| 7 | **Reports-sync replay-safety** — short-circuits on `client_id` match | `apps/api/app/api/v1/reports.py:65` | Replayed batches don't inflate `dup_count` |
| 8 | **`DEMO_REPORTS` mirror** in `reports.py` so the in-browser demo fallback can show newly-synced reports | `apps/api/app/api/v1/reports.py` | Demo mode updates live when PWA submits a report |
| 9 | **APK download endpoint fixed** (resolves relative to repo root) | `apps/api/app/main.py:73-83` | `/download/apk` works on any machine |

### 16.5 Summary — which repo is more advanced?

**This repo (`bhrakshak`) is the more advanced one** for the dashboard, the API surface, the standalone demo capability, and the contract normalization. The v2 repo is one major version behind on every frontend dependency (Next.js 14 vs 16, React 18 vs 19, Tailwind v3 vs v4, MapLibre 4 vs 6, ECharts 5 vs 6, Zustand 4 vs 5) and has the broken APK path that this repo fixed.

**The one feature v2 has that this repo should port** is the **Hazard Reports (AI Inbox) tab** (`ReportsInbox` component at `apps/dashboard/src/app/operations/page.tsx:322` in v2). This is a UI-only port — all the underlying endpoints already exist in this repo's FastAPI and demo routes. See Roadmap item R-1 below.

---

## 17. Roadmap

| ID | Item | Why | Where |
|---|---|---|---|
| R-1 | **Port the Hazard Reports (AI Inbox) tab from v2** as a fourth tab in `OperationsView` | The underlying `/reports`, `/reports/analyze-photo`, and `/reports/{id}/verify` endpoints exist; only the dashboard tab is missing | `apps/dashboard/src/components/views/OperationsView.tsx` (add a `ReportsInbox` sub-component) |
| R-2 | **Fix the demo/live reports-sync contract** — send `{ batch_id, reports }` in both modes | PWA-to-live-FastAPI sync currently 422s | `apps/dashboard/src/lib/client/api.ts:313-318` |
| R-3 | **Fix the `/alerts/preview-fire` and `/reports/{id}/verify` HTTP contract mismatches** | Live will 422 / 405 | `apps/dashboard/src/lib/client/api.ts:249,320` |
| R-4 | **Add the missing DB indexes** (`citizen_reports.created_at`, `alerts.fired_at`, `alerts.level`, `risk_cells.zone_id`) | Performance at scale | New `apps/api/alembic/versions/0005_indexes.py` |
| R-5 | **Offload `hashlib.sha1` and `classify_photo` to a thread pool** | 50 ms CPU on the event loop per photo | `apps/api/app/api/v1/reports.py:265,272` via `anyio.to_thread.run_sync` |
| R-6 | **Cache the parsed `backtest_fixture.json` at module load** | Avoids sync I/O in async handlers | `apps/api/app/api/v1/zones.py:27`, `demo.py:144`, `analytics.py:57` |
| R-7 | **Native-speaker i18n review** for Khasi / Mizo / Meetei-Mayek | Currently machine-drafted, flagged `TODO` | `apps/field-pwa/src/i18n/index.ts` |
| R-8 | **Real InSAR ingestion** (LiCSAR bulk download + GBSAR AOI tiles) | Currently synthetic PSInSAR | `ml/models/deformation.py` + new `apps/worker/worker/tasks/satellite.py` |
| R-9 | **GSI lithology / ESA WorldCover / road-cut distance ingests** for Model A2 | Booster may then beat the slope-only baseline under LODO | `ml/ingest/inventory.py` + `ml/features/micro_terrain.py` |
| R-10 | **OSM graph + NetworkX detour routing** over real `road_status` segments | `detour` currently builds graph from seeded road rows only | `apps/api/app/api/v1/roads.py` |
| R-11 | **CI GitHub Action** running `make up && make migrate && make seed && make test` | Catches regressions before merge | `.github/workflows/ci.yml` |
| R-12 | **Convert ML pipeline `print()` statements to `logging`** | Production log hygiene | `ml/models/*.py`, `scripts/*.py` |
| R-13 | **Cloud-native manifests** (Kubernetes / ECS / Cloud Run) | Single-host docker-compose is fine for demo; production needs horizontal scaling | `infra/k8s/` or `infra/cloud-run/` |
| R-14 | **MSG91 / Twilio SMS wiring** (currently dryrun) | Real SMS to citizens on L3+ alerts | `apps/api/app/services/channels/sms.py` |
| R-15 | **Firebase Cloud Messaging wiring** (currently dryrun) | Real push to Android app | `apps/api/app/services/channels/push.py` |
| R-16 | **Exotel IVR wiring** (currently dryrun) | Voice alerts for low-literacy audiences | `apps/api/app/services/channels/ivr.py` |
| R-17 | **Dial-a-zone hotline** (voice IVR for low-literacy audiences) | Last-mile coverage | New `apps/api/app/api/v1/ivr.py` |

---

## 18. License & Acknowledgements

### License

This project is developed for the **Smart India Hackathon 2026** (SIH 26001). All rights reserved to the BhuRakshak team until the competition concludes; an open-source license (MIT or Apache 2.0) will be applied post-finale.

### Data sources

- **Open-Meteo** — Rainfall archive + forecast (`https://api.open-meteo.com/v1`)
- **NASA Global Landslide Catalog (GLC)** — 74 in-region historical events with provenance
- **Copernicus GLO-30 DEM** — Global 30 m digital elevation model
- **Terrarium DEM** — Real ~35 m elevation for all 5 AOIs (SRTM family, keyless)
- **Sentinel-1 / LiCSAR** — PSInSAR line-of-sight velocity (synthetic stub for now)
- **USGS FDSN** — Seismic events (M ≥ 4 within 100 km of pilot centroids)
- **GSI Bhukosh** — Geological Survey of India landslide inventory (stubbed swap point)
- **NASA COOLR** — Cooperative Open Online Landslide Repository (stubbed)
- **OpenStreetMap** — Road network + WorldPop population proxy

### Open-source dependencies

- **FastAPI** · **Starlette** · **pydantic** · **SQLAlchemy** · **asyncpg** · **GeoAlchemy2** · **shapely**
- **Celery** · **Redis** · **paho-mqtt** · **httpx** · **slowapi**
- **PostgreSQL** · **PostGIS** · **TimescaleDB** · **Martin** · **MinIO** · **Mosquitto**
- **Next.js** · **React** · **TypeScript** · **Tailwind CSS** · **shadcn/ui** · **Radix UI** · **MapLibre GL** · **ECharts** · **Zustand** · **Lucide**
- **Vite** · **Workbox** · **Dexie**
- **Kotlin** · **Android Gradle Plugin** · **Room** · **WorkManager** · **Retrofit** · **OkHttp**
- **NumPy** · **pandas** · **geopandas** · **scikit-learn** · **LightGBM** · **XGBoost** · **joblib**
- **Docker** · **Docker Compose**

### Acknowledgements

- **Ministry of Development of North Eastern Region (MDoNER)** for the problem statement (SIH 26001)
- **Smart India Hackathon 2026** organisers
- The open-source community behind every library listed above
- The citizens, field officials, and district administrators of Aizawl, East Khasi Hills, Noney, Imphal West, and Gangtok — the people this system serves

---

## 19. Contributing

### Branch naming

- `feat/<short-description>` — new features
- `fix/<short-description>` — bug fixes
- `docs/<short-description>` — documentation only
- `chore/<short-description>` — tooling, deps, refactors with no behaviour change

### PR checklist

- [ ] `make lint` passes (Python `compileall`)
- [ ] `make test` passes against a running stack (or `pytest -q` if you've already `make up`'d)
- [ ] `cd apps/dashboard && npm run typecheck && npm run build` passes (TypeScript + Next.js build)
- [ ] `cd apps/field-pwa && npm run build` passes (Vite build)
- [ ] `cd ml && pytest tests/` passes
- [ ] No new `print()` statements in production code (use `logging`)
- [ ] No new hardcoded absolute paths (use `Path(__file__).resolve().parents[N] / ...`)
- [ ] No new secrets in source (use `.env` + `Settings`)
- [ ] README updated if behaviour changes
- [ ] `GAP_ANALYSIS.md` updated if a SIH requirement status changes
- [ ] `PROJECT_CONTEXT.md` updated if the stack or key files change

### Coordination (for shared agent sessions)

See `CLAUDE.md` for the team-coordination protocol when multiple agents work in shared sessions.

---

**Status: SIH Finale-ready** · **PSID 26001** · **MDoNER · Disaster Management** · **From reactive response to predictive protection.**
