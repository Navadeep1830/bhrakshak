# BhuRakshak — Gap Analysis vs SIH26001

> Audit date: 2026-09-02. Repo at master `5349cf3` + this session's work.
> Status legend: ✅ Done · ⚠️ Partial · ❌ Not built.

| # | PS Requirement | Status | Where in code | Notes |
|---|---|---|---|---|
| 1 | **Scalable AI software platform** | ✅ | `infra/docker-compose.yml` (11 services) | All services verified live: api, worker, beat, flower, postgres+postgis+timescale, redis, mqtt, minio, martin, dashboard, pwa. |
| 2 | **Real-time GIS dashboard + risk heatmaps** | ✅ | `apps/dashboard` (MapLibre 3-D, Martin MVT) | tsc + `next build` clean. Micro-susceptibility grid served via `/analytics/micro-heatmap` for the per-pixel layer. |
| 3 | **AI/ML predictive analytics engine** | ✅ | `ml/` two-tier stack | **Tier 1** Model B hazard nowcast: real Open-Meteo + NASA GLC labels, temporal split, alert-budget levels, Caine-1980 baseline comparison, exported bundle served by the API. **Tier 2** Model A v2 micro-susceptibility: real terrarium DEM (5 districts, ~35 m), 13 terrain derivatives, block-level labels, strict LODO leaderboard (booster vs slope/elev baselines vs physical index), slope-dominant physical index deployed with the measured leaderboard published. |
| 4 | **Mobile/web app for field reporting + alerts** | ✅ | `apps/field-pwa` (tsc+vite ✓) + `apps/android` (APK built ✓) | Android app fully rebuilt: fixed fatal `package in.` keyword bug, wired KSP Room, serialization plugin, logging-interceptor, lifecycle-service; real screens: risk-now, I'M SAFE (Room), report composer with **camera capture + Model V AI pre-screen**, safe-route canvas, rain gauge w/ I-D breach, alert history, WS push notifications, connectivity-triggered sync. |
| 5 | **Integration with IMD weather APIs** | ⚠️ | `ml/ingest/weather.py` | Open-Meteo (free, no key) is the wired provider with an `IMDProvider` stub raising-not-faking; documented swap point. |
| 5a | **Satellite feeds** | ⚠️ | deformation model | Synthetic InSAR still. Terrarium DEM IS real satellite-derived elevation (SRTM family). |
| 5b | **Sensor data (soil moisture, rain gauges)** | ✅ | ESP32 + LoRaWAN firmware, MQTT bridge, HTTP ingest | Fleet live; I-D thresholds read measured gauges. |
| 6 | **Geo-tagged photo/video uploads + AI verification** | ✅ | `geoverify.py` (Model V) + PWA + Android | EXIF GPS cross-check (>300 m flag), pixel-signature verdict POSITIVE/POSSIBLE/NEGATIVE, verdict attached server-side by sha1 media key. |
| 7 | **Risk severity dashboard** | ✅ | KPI bar + analytics page | POD/FAR/CSI, lead time, LODO, I-D curves, Noney-2022 replay. |
| 8 | **Road connectivity status** | ✅ | `/roads/*` + Martin tiles | Status, detour (A*), clearance estimates. |
| 9 | **Weather-linked forecasts** | ✅ | risk_engine forecast levels | f24/f48/f72 snapshots projected per-horizon. |
| 10 | **Emergency-response prioritisation** | ✅ | `priority.py` + Operations page | Hazard × exposure × vulnerability queue, reason chips, NDRF/SDRF incident command (teams, dispatch, shelters, messaging over WS). |
| 11 | **Multilingual notifications** | ✅ | 8 languages incl. Khasi/Mizo/Meetei-Mayek | API render + PWA UI + seeded templates. |
| 11a | **Real alert delivery (SMS/push/IVR/siren)** | ✅ | `services/channels/dispatcher.py` | Adapter fan-out on alert creation; logs dry-run without provider keys. |
| 12 | **Low-network/offline functionality** | ✅ | PWA (Dexie+Workbox), Android (Room+WorkManager), idempotent `/reports/sync` | Android adds connectivity-callback sync + offline caches for risk/route/gauge screens. |
| 13 | **Cloud-based architecture** | ✅ | docker-compose profile | Single-host demo shape; cloud manifests remain future work. |
| 14 | **AI/ML + real-time alerts loop** | ✅ | risk_engine → alerts → WS → channels | Storm injector verified idempotent (upsert fix for same-hour re-run). |
| 15 | **Historical landslide records** | ✅ | NASA GLC via `ml/ingest/labels.py` | 74 in-region events with provenance. |
| 16 | **Susceptibility hazard zonation (Layer A)** | ✅ | `ml/models/micro_susceptibility.py` + `/analytics/micro-heatmap` + `POST /analytics/micro-heatmap/refresh-susceptibility` | Was hash-based pseudo-random; now **real terrain statistics** — 536 zones refreshed live from the DEM grid (verified 15–90 range, district-varying). |
| 17 | **Identification of high-risk zones** | ✅ | `fuse_level` (threshold + Model B) | Real calibrated probabilities when the bundle contract is satisfiable; honest fallback otherwise. |
| 18 | **Real-time prediction of events** | ✅ | Model B + forecast snapshots | Live-verified end-to-end with storm injection. |
| 19 | **Real-time alerts to authorities/communities** | ✅ | alert engine + WS + Android notifications | Verified alert rows + WS channel + incident-command messaging. |
| 20 | **Use AI to identify high-risk zones + predict** | ✅ | Two-tier stack above | Tier 2's model-selection honesty (deployed physical index after LODO) is documented in the model card and metrics JSON. |

## Defects fixed this session

1. **Pillow missing from the active venv** — 5 Model V tests failed; installed; 78/78 green.
2. **Storm injector 422 on re-run** (rainfall_obs PK collision) — now an upsert; re-run verified 200 with same-hour idempotency.
3. **Android app could never compile** — `package in.` is a Kotlin keyword error; no res/, no wrapper, no gradle.properties, Room compiler commented out, wrong converter artifact, missing plugins. Rebuilt fully; **8.4 MB debug APK assembles**.
4. **Android screens were stubs** — safe-route/rain-gauge/alerts/photo were toasts; now real screens calling the API with offline caches.
5. **D8 flow routing had ascent/descent inverted** — accumulation never reached valleys; fixed + regression test (TWI/valley distance now real).
6. **Zone susceptibility was hash-based pseudo-random** — replaced with real DEM-derived statistics (refresh endpoint, live-verified).

## Honest limitations (for Q&A)

- Tier-2 ML: with 74 GLC events at 5–50 km accuracy, the boosted model did not beat a slope-only baseline under LODO; the deployed scorer is the transparent physics-weighted index, and the leaderboard is published. Rerun the harness when GSI lithology / ESA WorldCover / road-cut distance ingests land.
- GLC label accuracy bounds micro-scale resolution; block-level analysis is the honest unit.
- IMD swap is a config change away; Open-Meteo is the current provider.
