# BhuRakshak — Project Context

> SIH26001 · AI-Based Early Warning and Landslide Risk Monitoring System in NER
> *From reactive response to predictive protection.*

## Problem Statement (SIH26001)

**Title.** AI-Based early warning and landslide Risk Monitoring System in NER.
**Organization / Department.** Ministry of Development of North Eastern Region (MDoNER).
**Category.** Software. **Theme.** Disaster Management. **PS ID.** 26001.

**Background (from the SIH description).**
The North Eastern Region (NER) frequently faces landslides, flash floods, road
blockages, and slope failures due to heavy rainfall, fragile terrain, and
unplanned hill cutting. These incidents often disrupt connectivity, damage
infrastructure, delay emergency response, and isolate remote villages for days.
Currently, monitoring of vulnerable zones is mostly reactive and dependent on
manual reporting. There is limited use of real-time predictive systems for
identifying high-risk zones and issuing early warnings to authorities and local
communities. With increasing climate vulnerability, MDoNER seeks an AI-enabled
real-time monitoring and prediction system that helps authorities take
preventive action before disasters occur.

**Expected solution (as described by MDoNER).** A scalable AI software platform
that:

- Collects / analyses rainfall, soil-moisture sensors, satellite imagery,
  terrain/slope data and historical landslide records
- Uses AI/ML to identify high-risk zones and predict events
- Provides real-time alerts to district / DM authorities and local communities
- Integrates GIS mapping; supports geo-tagged photo/video uploads from citizens
  and field officials
- Generates dashboards for risk severity, road connectivity, weather-linked
  forecasts and emergency-response prioritisation
- Supports multilingual notifications and low-network / offline functionality
- Combines real-time GIS dashboard + heatmaps, AI/ML predictive analytics,
  field-reporting mobile/web app, integration with IMD weather APIs, satellite
  feeds and sensor data, and automated SMS/app early-warning
- Uses cloud-based architecture with offline sync

## What This Project Is

BhuRakshak (भूरक्षक — "Earth-Guardian") is a 4-layer landslide early warning
system. Each layer answers one question, then they fuse:

| Layer | Question | Engine | Output |
|---|---|---|---|
| **A — Susceptibility** (static) | WHERE can landslides happen? | XGBoost / LightGBM on 24 terrain + geology + land-cover features per 30 m grid cell, **leave-one-district-out (LODO) spatial CV** | Static 0–100 score per cell → 5 GSI-compatible classes |
| **B — Hazard Nowcast** (dynamic) | WHEN is it dangerous? | LightGBM + isotonic calibration **fused** with interpretable intensity–duration (I-D) thresholds; 72h rainfall forecast features; **hysteresis** (escalate after 2 ticks, de-escalate after 3) | Hazard level L0–L4 per response zone, now + 24/48/72 h |
| **C — Deformation** (slow-motion) | IS THE SLOPE MOVING? | Sentinel-1 PSInSAR LOS velocity → robust z-score → DBSCAN creep clusters | Active creep zones; auto +1 hazard tier upgrade |
| **D — Exposure & Response** | WHO / WHAT is in the way? | Hazard × population (WorldPop proxy) × road criticality (NH > SH > village) × isolation score | Ranked response-priority queue; blocked-road prediction + NetworkX A\* detours |

**Fusion rule.** `hazard_level = max(threshold_tier, calibrated_ML_tier)`.
**Anti-flapping hysteresis.** Escalate only after 2 consecutive ticks ≥ candidate;
de-escalate only after 3 consecutive ticks below `current − 1`.
**Stack rationale (defensible Q&A):** FastAPI async + pydantic v2 for OpenAPI +
WebSocket live alerts · PostgreSQL 15 + PostGIS + TimescaleDB in a single
`timescale/timescaledb-ha` image · Martin (Rust) for MVT serving ·
JWT access + rotating refresh tokens with **family-reuse detection** · Celery
beat for crash-safe ingestion · Next.js 14 + ECharts for SHAP waterfalls ·
Vite PWA + Workbox + Dexie for offline-first field reporting with idempotent
batch sync by client UUID · slowapi for endpoint brute-force protection.

**Stakeholders served.** District administrators / disaster-management
authorities, field officials, and citizens of the four pilot districts of
NER. Pilot districts: **Aizawl (Mizoram), East Khasi Hills (Meghalaya), Noney +
Imphal West (Manipur), Gangtok (Sikkim)**.

## Architecture Overview

```
   DATA ─── Open-Meteo · GSI Bhukosh · NASA COOLR · Copernicus GLO-30 ·
            Sentinel-1 / LiCSAR · OSM · WorldPop · IoT MQTT sensors
     │
   INGEST ─── Celery beat: rainfall poll 15 m · risk recompute 15 m ·
              seismic 1 h · satellite-ETL daily · MQTT bridge 24×7
     │
   INTELLIGENCE ─── ml/
     ├─ ingest/{dem,inventory,weather}.py        (synthetic + GLO-30 hooks)
     ├─ models/{susceptibility,hazard,deformation,backtest}.py
     └─ registry/registry.py                     (artifact_meta + model cards)
     │
   BACKEND ─── apps/api (FastAPI)
     ├─ REST   /api/v1/{auth,zones,reports,alerts,roads,demo,analytics,ingest,briefing}
     ├─ WS     /ws/live                          (Redis pub/sub fan-out)
     ├─ Alert  Hysteresis + 8-language i18n templates + ack workflow
     └─ Sync   Idempotent UUID + 50 m / 1 h proximity dedupe
     │
   STORAGE ─── PostgreSQL 15 + PostGIS + TimescaleDB (4 hypertables:
              rainfall_obs, sensor_readings, displacement_series,
              risk_snapshots) · Redis (queues + pub/sub) · MinIO (media)
              Martin (vector tiles at /:table/:z/:x/:y.pbf)
     │
   FRONT ─── apps/dashboard (Next.js 14 · TS · Tailwind · MapLibre GL 3D + ECharts SHAP)
             apps/field-pwa (Vite PWA · Workbox · Dexie · 8-language UI)
     │
   ALERT CHANNELS ─── Push | SMS (stub) | IVR (stub) | Siren (stub)
                       ← stubbed but adapters' channel list stored on the Alert row
```

## Current State (audit date: 2026-08-29)

Code present in repository (`887a6d1` — `master`):
113 tracked files, ≈ **15.4 K LOC** total (≈ 4.0 K Python, ≈ 2.4 K TS/TSX,
plus JSON, YAML, CSS, Markdown). Architecture is intentionally modular with
hard, named service boundaries (api ⇄ worker ⇄ ml ⇄ front).

### ✅ Built & Working

**Backend (FastAPI · async SQLAlchemy 2.0 · pydantic v2 · asyncpg):**
- 13 routers mounted under `/api/v1` + 1 WebSocket at `/ws/live`. Endpoints
  cover auth (4), zones (2), reports (4), alerts (3), roads (2), demo (2),
  analytics (4), briefing (1), ingest (1) — see "API surface" below.
- **JWT auth + refresh-token rotation with family-based reuse detection**
  (`apps/api/app/core/security.py`, `api/v1/auth.py`): presenting a used /
  revoked refresh token revokes the **whole token family** at once. Token
  hashes stored (not raw).
- **RBAC** enforced per-route via `require_roles(*roles)` with four roles:
  `admin`, `district_admin`, `field_official`, `citizen`
  (`apps/api/app/api/deps.py`).
- **Risk-engine service** (`app/services/risk_engine.py`) implementing:
  intensity–duration thresholds per susceptibility band · hysteresis
  (2-tick escalate / 3-tick de-escalate) · multi-horizon snapshots
  (now / f24 / f48 / f72) · i18n alert template lookup with fallback ·
  Redis pub/sub broadcast consumed by WS.
- **Multi-hazard + response-priority service** (`app/services/priority.py`):
  `flood_index()` (flash-flood tier 0–4) + `isolation_score()` (deterministic
  proxy until OSM centrality lands) + `priority_rows()` ranked queue
  (hazard × exposure × vulnerability) with human-readable reason chips and
  recommended-action templates.
- **Offline field-report ingestion with idempotent batch sync**
  (`apps/api/app/api/v1/reports.py`): client-UUID primary key, EXIF geo-check
  flag, **50 m / 1 h proximity dedupe** (haversine) merging into the existing
  report's `dup_count`.
- **Demo storm injector** (`api/v1/demo.py` + `demo/storm_injector.py`)
  writes synthetic extreme-rainfall ramp then calls `evaluate_all_zones`
  twice so hysteresis escalates immediately.
- **Briefing PDF endpoint** (`api/v1/briefing.py`) builds a print-ready HTML
  daily-risk briefing (per district, top-20 zones, level-coloured table).
  WeasyPrint optional; HTML alone is print-to-PDF ready.
- **WebSocket** at `/ws/live` subscribes Redis pub/sub `bhrakshak:live`,
  emits `alert`, `risk_diff`, `sensor`, `allclear`, and 15 s heartbeats.
- **slowapi rate-limit** middleware at 600 requests/min/IP. Auth login
  additionally rate-limited.

**Worker (Celery · Redis broker/result · Flower ops UI):**
- Celery app (`apps/worker/worker/celery_app.py`) with **beat schedule**:
  rainfall poll every 15 m · risk recompute every 15 m (+ 30 s countdown
  to dedupe with rainfall) · seismic poll every 1 h · satellite ETL daily.
- **MQTT bridge** (`apps/worker/worker/mqtt_bridge.py`) subscribes
  `sensors/#` on Mosquitto, validates JSON, writes `sensor_readings` rows,
  publishes to `bhrakshak:live`.
- **Task implementations**: `tasks/ingest.py` (Open-Meteo archive/forecast,
  Kohler–Linsley effective rainfall, half-life 48 h, deterministic synthetic
  fallback), `tasks/risk.py` (calls `evaluate_all_zones`), `tasks/seismic.py`
  (USGS FDSN, M ≥ 4 within 100 km of pilot centroids in last 7 d, trigger
  flag persisted).
- **Flower** ops UI on `:5555`.

**Database (alembic · PostGIS · TimescaleDB · asyncpg):**
- **15 tables** in one initial migration `0001_initial.py`:
  `users`, `refresh_tokens`, `zones`, `risk_cells`, `risk_snapshots`,
  `rainfall_obs`, `citizen_reports`, `alerts`, `road_status`,
  `displacement_points`, `displacement_series`, `model_registry`,
  `i18n_messages`, `sensor_readings`, `seismic_events`.
- **GiST indexes** on every geometry column (`zones.geom`,
  `risk_cells.geom`, `citizen_reports.geom`, `road_status.segment_geom`,
  `displacement_points.geom`).
- **4 TimescaleDB hypertables** (`risk_snapshots`, `rainfall_obs`,
  `displacement_series`, `sensor_readings`) — auto-chunked on `ts`.
  Retention policy 400 days on `rainfall_obs`.
- Foreign-key cascades wired (`users → refresh_tokens`, `zones →
  risk_cells`, `risk_snapshots`, `rainfall_obs`; `alerts.zone_id → zones`).
- Custom alembic version table (`alembic_version_bhrakshak`) to share a DB.
- `infra/postgres/init/01-extensions.sql` ensures `postgis`, `timescaledb`,
  `pgcrypto`.

**Frontend (Next.js 14 dashboard · TS · Tailwind · MapLibre GL · ECharts):**
- **Command Center** (`/`): 3-D MapLibre map (CARTO dark raster + DEM
  hillshade), Martin vector-tile layers for `zones`, `risk_cells`,
  `road_status`, `citizen_reports`. Sub-second hover highlight, click →
  `DossierDrawer` (SHAP drivers waterfall + rainfall vs L3 threshold chart).
  Live-ticker events from WebSocket. Forecast scrubber NOW/+24/+48/+72.
  Layer toggle rail + district fly-to + demo storm "⛈ Inject Monsoon Cell"
  judge button.
- **Analytics** (`/analytics`): P OD/FAR/CSI by warning-level chart, lead-time
  histogram, susceptibility LODO chart, I-D threshold curves, model-registry
  table. Noney 2022 backtest-replay widget with timeline scrubber + **LEAD
  TIME** callout when ≥ 24 h & level ≥ 3.
- **Operations** (`/operations`): ranked response-queue table with reason
  chips, team-assignment buttons; alert console with ack workflow, channels
  list, recipient count.
- **KPI bar** auto-refreshes every 15 s with **count-up animation**;
  LIVE / FIXTURE-MODE pill driven by API health.
- **OFFLINE-SAFE FIXTURE FALLBACKS** in `apps/dashboard/src/lib/api.ts`
  (KPIs, drivers, rainfall) so the dashboard never goes blank even if the
  API is down (venue-WiFi proof).
- DC-briefing PDF shortcut in top nav.

**Field PWA (Vite · Workbox · Dexie · TypeScript):**
- Offline-first: Indexed-Dexie queue with **client-UUID idempotency**;
  Workbox NetworkFirst caching for `/api/*`.
- 8-language i18n (`en, hi, as, bn, ne, kha, lus, mni-Mtei`) with safe
  English fallback.
- **"I'm safe" check-in** + 5-category hazard report form
  (`crack | slope_movement | blocked_road | past_slide | water_seepage`).
- Auto-retry on reconnect (`online` event listener) + manual "Sync now".

**ML pipeline (`ml/`):**
- Synthetic-data fallback everywhere — pipeline is **fully offline-safe**.
- `ml/ingest/{dem,inventory,weather}.py` (Copernicus GLO-30 hook + GSI
  Bhukosh / NASA COOLR loaders with fallback).
- `ml/models/susceptibility.py` (XGBoost w/ LightGBM sklearn fallback ·
  LODO spatial CV on 16 000 synthetic cells across 4 districts ·
  permutation importances).
- `ml/models/hazard.py` (LightGBM w/ fallback · temporal split
  ≤2019 / 20–22 / 23–24 · isotonic calibration).
- `ml/models/deformation.py` (robust-z on synthetic PSInSAR velocity ·
  DBSCAN clustering).
- `ml/models/backtest.py` POD/FAR/CSI per level + lead-time histogram →
  `demo/backtest_fixture.json` (consumed by analytics page).
- `ml/registry/registry.py` persists `model_registry` rows + per-model
  Markdown model cards.
- `ml/Makefile` targets: `data`, `features`, `train-susceptibility`,
  `train-hazard`, `backtest`, `all`, `clean`.

**Infra:**
- `infra/docker-compose.yml` (10 services): `postgres (+postgis+timescale)`,
  `redis`, `mosquitto`, `minio` (+ `minio-init`), `martin`,
  `api` (uvicorn), `worker` (celery worker), `beat`, `flower`, `dashboard`
  (next dev), `pwa` (vite), `seed` (tools profile, runs `make seed`).
- `infra/backend.Dockerfile` (python 3.11-slim, builds api+worker+scripts).
- `infra/martin/config.yml` exposes 4 tables: `risk_cells`, `zones`,
  `road_status`, `citizen_reports`. Bounds `[88.0, 23.0, 94.6, 28.0]`
  cover NER.
- `infra/mosquitto/mosquitto.conf` — anonymous dev listener on `:1883`,
  stdout logging, no persistence.

**Testing:**
- `apps/api/tests/test_api.py` covers `health`, `auth/login` (bad creds),
  `auth/me` (no auth), `auth/refresh` rotation + **family reuse
  detection**, RBAC `citizen→verify_report` denial, idempotent
  `reports/sync`, RBAC `citizen→demo_storm` denial, `zones` requires
  auth.

### ⚠️ Built but on Seeded / Synthetic Data

- **Zones, susceptibility, citizen reports, sensor readings, road segments,
  rainfall observations, road blocked/unblocked states** are all generated
  by the seed script from a hard-coded GeoJSON of **approximate district
  boundaries** (`data/pilot_districts.geojson`). Susceptibility is hash-based
  pseudo-random per `zone_code`, not computed.
- **Demo storm injector** pushes synthetic rainfall on synthetic zones.
- **Backtest fixture** POD/FAR/CSI numbers are pre-baked with deterministic
  random seeds in `ml/models/backtest.py` — these are **the numbers shown on
  the analytics page** (POD 0.78 / FAR 0.31 / CSI 0.58 for L2 etc.).
- **Noney-2022 timeline** is hand-coded in the fixture
  (`MN-NON-002`, `2022-06-30`, 58 fatalities) — single backtest anchor.
- **PWA sync logins** as the demo citizen (hard-coded credentials) for the
  one-tap sync flow.

### ❌ Not Yet Built (the Winning Gaps)

| # | Gap | Where it lands | Why it matters |
|---|---|---|---|
| 1 | **Real ML Models A + B** producing scored cells per real-feeling dataset | `ml/models/susceptibility.py`, `ml/models/hazard.py` | Judges ask "is the ML real?" — right now it's threshold-based + SHAP-shaped placeholders |
| 2 | **Real data ingest** for Open-Meteo archive, GSI Bhukosh inventory, Copernicus GLO-30 DEM, Sentinel-1 / LiCSAR | `ml/ingest/*.py` + Celery `satellite_etl` task (currently `{"status":"noop"}`) | "Show me the data pipeline" question |
| 3 | **Alert-channel adapters** (MSG91 / Twilio SMS, Firebase push, IVR) actually wired | new `app/services/channels/` package, called from `risk_engine.evaluate_zone` after alert persists | PS bullet "automated SMS/app early warning" |
| 4 | **Full PWA wiring** to backend with proper login (vs hard-coded demo citizen) | `apps/field-pwa/src/db.ts` `syncQueue` currently logs in as citizen@… | Real field-official testing |
| 5 | **Deformation (Layer C) integrated** into the risk engine (+1 tier on creep cluster) | `app/services/risk_engine.py` `evaluate_zone` does not consult `displacement_points` | Currently `deformation` flag in store but no layer source active |
| 6 | **Documented model cards** in `docs/model-cards/` (today only `latest_at` + `metrics` JSONB on registry) | `ml/registry/registry.py` writes the cards but they live in `ml/artifacts` not `docs/` | Academic-rigour Q&A |
| 7 | **OSM graph + NetworkX detour routing** over real `road_status` segments | `app/api/v1/roads.py` `detour` builds graph from seeded road rows only (4 hard-coded ways) | "Detour me from here to here" live demo |
| 8 | **8-language i18n templates DB-seeded** (currently only 5 of 8) | `scripts/seed.py` `I18N_SEED` missing `kha`, `lus`, `mni-Mtei`; risk_engine `DEFAULT_TEMPLATES` has them | Khasi / Mizo / Meetei-Mayek strings used only at runtime via fallback dict |
| 9 | **Frontend map deformation layer source + InSAR tile rendering** | dashboard `MapView.tsx` exposes the toggle but there's no `displacement_*` Martin source | "Where's the slow creep?" demo |
| 10 | **Hardware sensor integration** (ESP32 firmware for `sensors/#` topic) | repo `/sensors/` firmware does not exist | "We built the box too" — the MoE-grade move |

## Tech Stack

| Layer | Tech | Why (defensible) |
|---|---|---|
| API | FastAPI 0.115 async · pydantic v2 · SQLAlchemy 2.0 async · asyncpg | Same language as ML · WebSocket for live alerts · auto-OpenAPI for judges |
| Worker | Celery 5.4 · Redis 7 · paho-mqtt 2.x · httpx · Flower 2.x | Crash-safe scheduled ingest · ops visibility |
| Datastore | PostgreSQL 15 + PostGIS + TimescaleDB in one `timescale/timescaledb-ha` image · `pgcrypto` | Standard geospatial + time-series without a second DB |
| Vector tiles | Martin (Rust) · GeoJSON → MVT at `/:table/:z/:x/:y.pbf` | What real geo teams self-host; MapLibre-ready |
| Cache / queue / fanout | Redis 7 (queues, results, pub/sub) | Single 6360→6380 mapped service |
| Object storage | MinIO (S3-compatible) | Citizen-report media later |
| Auth | JWT (HS256) access 30 min + refresh 14 d, rotating with **family-reuse revocation**, bcrypt hashes, phone stored as hash | DPDP-compliant posture, bank-grade rotation |
| Dashboard | Next.js 14.2 · TS · Tailwind 3.4 · MapLibre GL 4.7.1 (3-D pitch + hillshade) · ECharts 5 (SHAP / lead-time) · Zustand 4 · Lucide icons | Type-safe pre-demo; ECharts lets judges interrogate SHAP |
| PWA | Vite 5 · React 18 · TS · Workbox (NetworkFirst /api/*) · Dexie 4 (IndexedDB) | Offline-first field reporting |
| ML | numpy · pandas · geopandas · shapely · scikit-learn · LightGBM 4 · XGBoost (optional) · `ml/Makefile` offline pipeline | LODO spatial CV — gold standard for spatial ML |
| Infra | Docker Compose (10 services) · Martin config · Mosquitto 2 · backend.Dockerfile (python 3.11-slim) | Fits a 16 GB laptop (PG capped 1.5 GB) |

## Key Files & Entry Points

| Concern | Path |
|---|---|
| FastAPI app bootstrap | `apps/api/app/main.py` |
| Settings / env | `apps/api/app/core/config.py` |
| JWT + bcrypt + refresh hashing | `apps/api/app/core/security.py` |
| Auth routes (login / refresh / logout / me / register) | `apps/api/app/api/v1/auth.py` |
| Zone list + dossier (rain series · sensors · reports · alerts · drivers · history · flood · isolation) | `apps/api/app/api/v1/zones.py` |
| Reports: create · batch sync (idempotent) · list · verify | `apps/api/app/api/v1/reports.py` |
| Alerts: list · ack · preview-fire | `apps/api/app/api/v1/alerts.py` |
| Roads: status · detour (NetworkX A\*) | `apps/api/app/api/v1/roads.py` |
| Demo: inject-rainfall-storm · replay-event | `apps/api/app/api/v1/demo.py` |
| Analytics: KPIs · backtest fixture · model registry · response priority | `apps/api/app/api/v1/analytics.py` |
| Briefing: PDF (or HTML fallback) | `apps/api/app/api/v1/briefing.py` |
| Ingest: HTTP fallback for MQTT | `apps/api/app/api/v1/ingest.py` |
| WebSocket `/ws/live` | `apps/api/app/api/v1/ws.py` |
| Risk engine (thresholds + hysteresis + snapshots + publish) | `apps/api/app/services/risk_engine.py` |
| Priority engine (flood · isolation · ranked queue) | `apps/api/app/services/priority.py` |
| ORM models | `apps/api/app/models/{base,geo,ops}.py` |
| Pydantic schemas | `apps/api/app/schemas/schemas.py` |
| Alembic migration `0001_initial.py` (15 tables + 4 hypertables + 1 retention policy) | `apps/api/alembic/versions/0001_initial.py` |
| Seed (hex grid · users · roads · i18n · model-registry entry) | `scripts/seed.py` |
| Realistic demo state (reports · blocked road · sensor fleet) | `scripts/seed_realistic.py` |
| Storm injector (admin login → real pipeline → L2+) | `demo/storm_injector.py` |
| Sensor simulator (MQTT → DB, HTTP fallback) | `demo/sensor_simulator.py` |
| Backtest fixture | `demo/backtest_fixture.json` (regenerated by `ml/models/backtest.py`) |
| ML: susceptibility · hazard · deformation · backtest | `ml/models/{susceptibility,hazard,deformation,backtest}.py` |
| ML ingest: DEM (Copernicus GLO-30) · inventory (GSI / COOLR) · weather (Open-Meteo) | `ml/ingest/{dem,inventory,weather}.py` |
| Worker / Celery boot + beat schedule | `apps/worker/worker/celery_app.py` |
| MQTT bridge | `apps/worker/worker/mqtt_bridge.py` |
| Periodic tasks: rainfall · risk · seismic · satellite ETL | `apps/worker/worker/tasks/{ingest,risk,seismic}.py` |
| Dashboard map (3-D + Martin tiles + pulse layer + hillshade) | `apps/dashboard/src/components/map/MapView.tsx` |
| Dashboard zone dossier (SHAP + rainfall vs L3) | `apps/dashboard/src/components/dossier/DossierDrawer.tsx` |
| Dashboard analytics page (P OD/FAR/CSI · lead-time · LODO · I-D · registry + Noney replay) | `apps/dashboard/src/app/analytics/page.tsx` |
| Dashboard operations page (queue + alert console) | `apps/dashboard/src/app/operations/page.tsx` |
| Dashboard layout (KPI bar · top nav · ticker) | `apps/dashboard/src/app/layout.tsx` |
| Field PWA app shell + offline queue | `apps/field-pwa/src/App.tsx`, `apps/field-pwa/src/db.ts` |
| 8-language strings | `apps/field-pwa/src/i18n/index.ts` |
| Docker Compose | `infra/docker-compose.yml` |
| Martin tile config | `infra/martin/config.yml` |
| Mosquitto | `infra/mosquitto/mosquitto.conf` |
| Postgres extensions | `infra/postgres/init/01-extensions.sql` |
| Make targets (`up · migrate · seed · demo · test · data`) | `Makefile` |

## How to Run Locally

```bash
cp .env.example .env                  # use Postgres on host port 5433 (deliberate)
make up                               # 10 services: pg · redis · mqtt · minio · martin · api · worker · beat · flower · dashboard · pwa
make migrate                          # alembic upgrade head -> 15 tables + 4 hypertables
make seed                             # 4 districts (~5 km hex grid, ~45 zones) + users + roads + i18n + model-registry row
make demo                             # realistic state + storm injection over East Khasi Hills
```

| URL | What |
|---|---|
| http://localhost:3000 | Command Center (MapLibre 3-D + ECharts SHAP) |
| http://localhost:5173 | Field PWA (offline reports, 8 languages) |
| http://localhost:8000/docs | API OpenAPI |
| http://localhost:3001/zones/8/60/28.pbf | Martin vector tile |
| http://localhost:5555 | Flower (Celery ops view) |
| http://localhost:9001 | MinIO console |

**Seeded logins.**
`admin@bhrakshak.in / Admin@123` · `dc.aizawl@…/ District@123`
· `field.noney@… / Field@123` · `citizen@bhrakshak.in / Citizen@123`.

> All metrics shown are computed by code (`make data`,
> `ml/models/backtest.py`) — never hard-coded in UI.

## Open Questions / Next Features

_To fill during planning once the team reviews this audit._

- [ ] Decision: layer-C signal — fake (deterministic PSInSAR) vs real (LiCSAR bulk download + GBSAR AOI tiles)
- [ ] Decision: SMS provider — MSG91 (India) vs Twilio (intl) vs CM-specific gateway
- [ ] Decision: ESP32 firmware scope — soil + tilt + LoRaWAN vs only MQTT-WiFi
- [ ] Decision: regional language audit (Khasi / Mizo / Meetei-Mayek) owner + deadline before finale
- [ ] Decision: do we commit a CI GitHub Action that runs `make up && make migrate && make seed && make test`?
- [ ] Feature: dial-a-zone hotline (voice IVR for low-literacy audiences)
- [ ] Feature: native Android APK wrapper around the PWA so district tablets get a launcher icon
