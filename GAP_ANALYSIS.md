# BhuRakshak — Gap Analysis vs SIH26001

> Audit date: 2026-08-29. Repo at master `887a6d1`.
> Status legend: ✅ Done · ⚠️ Partial (scaffolded, on synthetic / seeded data, or wired but stub) · ❌ Not built (gap).

| # | PS Requirement (Expected Solution) | Status | Where in code | Gap to Close |
|---|---|---|---|---|
| 1 | **Scalable AI software platform** (overall) | ⚠️ | Whole repo · `infra/docker-compose.yml` | 10 services → demo-shape is solid; needs CPU/RAM budget under real load (no load-test yet). |
| 2 | **Real-time GIS dashboard and risk heatmaps** | ⚠️ | `apps/dashboard/src/components/map/MapView.tsx` · Martin `infra/martin/config.yml` · `apps/api/app/services/risk_engine.py` | Map + heatmap rendering live; pulses & hillshade cosmetic. Needs (a) real-feeling risk input (gap #5) and (b) frontend beauty pass on filters / district detail view. |
| 3 | **AI/ML predictive analytics engine** | ❌ | `ml/models/{susceptibility,hazard,deformation,backtest}.py` | Pipeline scripts exist, run synthetically; **no trained models on real-feeling data have been persisted to `model_registry`**. The risk engine uses deterministic I-D thresholds + SHAP-shaped placeholder drivers. Train Models A + B end-to-end with `make data && make train-susceptibility && make train-hazard && make backtest` and verify `model_registry.metrics` non-null. |
| 4 | **Mobile / web app for field reporting + alerts** | ⚠️ | `apps/field-pwa/{App.tsx,db.ts,i18n/index.ts}` · `apps/api/app/api/v1/reports.py` | API end-to-end works (tests pass for idempotent sync + dedupe). PWA syncs but uses **hard-coded citizen credentials** (`db.ts` `syncQueue`). Needs proper login screen + per-user token persistence. |
| 5 | **Integration with IMD weather APIs** | ⚠️ | `ml/ingest/weather.py` · `apps/worker/worker/tasks/ingest.py` | Currently only **Open-Meteo** (global model, free). IMD Mausam / city forecast API not wired; **`FIXTURE_MODE` flag** keeps the demo running offline. Wire IMD endpoint or document explicitly that Open-Meteo is the chosen provider with daily Celery pull. |
| 5a | **Satellite feeds (Sentinel-1 / Sentinel-2 / LiCSAR)** | ❌ | `ml/models/deformation.py` · `apps/worker/worker/tasks/seismic.py` `satellite_etl` | Sentinel-1 InSAR is currently **synthetic** (`synthetic_ps_points` in `ml/models/deformation.py`); `satellite_etl` Celery task is `{"status":"noop"}`. Land LiCSAR bulk download + GBSAR AOI processing. |
| 5b | **Sensor data (soil moisture, rain gauges)** | ⚠️ | `apps/worker/worker/mqtt_bridge.py` · `demo/sensor_simulator.py` | MQTT bridge + simulator work end-to-end (`apps/api/app/api/v1/ingest.py` HTTP fallback). **No real ESP32 firmware** in the repo — `sensors_simulator.py` simulates everything in Python. |
| 6 | **Geo-tagged photo / video uploads from citizens / field officials** | ⚠️ | `apps/api/app/models/ops.py` `CitizenReport.media_refs` · `apps/field-pwa/src/App.tsx` | Schema carries `media_refs ARRAY(Text)` (MinIO keys) and PWA has a `photo_b64` Dexie field, **but no file picker / camera / upload-to-MinIO** in the current PWA UI. Add `<input capture>` + `/media/presign` endpoint + MinIO client. |
| 7 | **Risk severity dashboard** | ✅ | `apps/dashboard/src/components/kpi/KpiBar.tsx` · `/app/analytics/page.tsx` | KPI bar (count-up), Analytics page (POD/FAR/CSI chart, lead-time histogram, LODO chart, I-D curves, Noney replay). |
| 8 | **Road connectivity status** | ⚠️ | `apps/api/app/api/v1/roads.py` · `apps/dashboard/src/components/map/MapView.tsx` (`roads-line` layer) | Road-status tiles + colour-coded status line live. Detour routing uses **`G = nx.Graph()` built from 4 hard-coded ways in `seed.py`**; real OSMnx graph not wired yet. |
| 9 | **Weather-linked forecasts** | ⚠️ | `apps/worker/worker/tasks/ingest.py` (Open-Meteo forecast) · `app/services/risk_engine.py` `snapshot_zone` | Polling runs, `f24/f48/f72` snapshot rows exist in schema, **but the per-horizon level is currently `cell.hazard_level + 0` for every horizon** (the `+` operator is degenerate ternary `0 if horizon != "f72" else 0`). Real Model-B forecast fusion lands here. |
| 10 | **Emergency-response prioritisation** | ✅ | `apps/api/app/services/priority.py` `priority_rows` · `apps/dashboard/src/app/operations/page.tsx` | Hazard × exposure × vulnerability with reason chips + recommended-action templates + team-assignment UI. |
| 11 | **Multilingual notifications** | ⚠️ | `apps/api/app/services/risk_engine.py` `DEFAULT_TEMPLATES` · `scripts/seed.py` `I18N_SEED` · `apps/api/app/models/base.py` `I18nMessage` · `apps/field-pwa/src/i18n/index.ts` | 8 languages everywhere (API render + PWA UI). DB seed only stores 5 (en/hi/as/bn/ne) — `kha / lus / mni-Mtei` served via `DEFAULT_TEMPLATES` fallback; documentation flags these need native-speaker review (`apps/field-pwa/src/i18n/index.ts:48`). |
| 11a | **Real alert delivery (SMS / app push / IVR / siren)** | ❌ | `apps/api/app/services/risk_engine.py` `ALERT_CHANNEL_POLICY` lists strings | Channels are stored on the `Alert.channels` row but **no adapter calls real providers**. Need MSG91 (India SMS) or Twilio + Firebase Cloud Messaging, plus an IVR gateway (Exotel / Ozonetel) and a "siren integration" REST hook. |
| 12 | **Low-network / offline functionality** | ⚠️ | `apps/field-pwa/src/db.ts` (Dexie queue + idempotent UUID) · `vite.config.ts` Workbox NetworkFirst | Tested in `test_api.py::test_reports_sync_is_idempotent`. PWA UI is light, no map-of-zone offline tile cache yet. |
| 13 | **Cloud-based architecture** | ⚠️ | `infra/docker-compose.yml` | Currently single-host docker-compose; cloud-deploy manifest (Helm chart or Terraform for AWS / GCP) absent. Fine for in-person demo; add if remote-judges ask. |
| 14 | **AI/ML → real-time alerts** (the whole point) | ⚠️ | `apps/api/app/services/risk_engine.py` `evaluate_zone` → `Alert` row → `publish_live` → `ws.py` → dashboard `Ticker` | The loop works end-to-end on synthetic data. Real-data → real-warning path requires gaps 3, 5, 5a, 5b, 11a to close first. |
| 15 | **Historical landslide records (training labels)** | ❌ | `ml/ingest/inventory.py` | Loader exists for `data/inventory/*.geojson` but **no real GSI Bhukosh / NASA COOLR / DataMeet dataset is committed**. Use the bundled synthetic for the demo; commit real GeoJSON in a private sub-repo before the finale. |
| 16 | **Susceptibility hazard zonation (Layer A)** | ⚠️ | `ml/models/susceptibility.py` | LODO spatial CV with synthetic ground truth runs and prints mean AUC. The **per-zone susceptibility number shown on the dashboard** (`zones.susc_mean`) is hash-based pseudo-random from the seed. Persist `predict_proba` aggregates per zone after training. |
| 17 | **Identification of high-risk zones (classifier / regressor)** | ❌ | `app/services/risk_engine.py` `fuse_level` | Today the level comes from `(rainfall × susc_band lookup table)`. Real probability comes from Model B trained output (gap #3). |
| 18 | **Real-time prediction of events** | ❌ | `app/services/risk_engine.py` | No horizon-ahead probability beyond "now". Requires Model B + 72 h Open-Meteo forecast ingestion (gap #5). |
| 19 | **Real-time alerts to district admin / DM authorities / local communities** | ⚠️ | `app/api/v1/alerts.py` · `risk_engine.py` `ALERT_CHANNEL_POLICY` · DB `alerts` table + WS ticker | Persisted + ticker works. **No email / SMS / push dispatch**. |
| 20 | **Use AI to identify high-risk zones + predict events** | ❌ | `ml/models/*.py` | Same as #3 + #17 — the AI/ML claim currently rests on deterministic thresholds + SHAP-shaped bar chart. |

## Additional Gaps Discovered During Audit

These weren't explicit PS bullets but were found while reading:

| # | Finding | Severity | Where |
|---|---|---|---|
| A1 | **Susceptibility-LODO chart is reading from a key the fixture doesn't have.** Analytics chart `LodoChart` reads `metrics.susceptibility_auc_lodo`, but `demo/backtest_fixture.json` only has `per_level` + `lead_time_h`. The chart silently renders the empty state. | High (UI breaks visibly — leaves a "Run `make train-susceptibility`" hint at judges) | `apps/dashboard/src/app/analytics/page.tsx:55` ↔ `ml/models/backtest.py` |
| A2 | **`snapshot_zone` horizon-level formula is degenerate.** `cell.hazard_level + (0 if horizon != "f72" else 0)` always adds 0; `f24/f48/f72` rows just mirror "now". | High (Promised to judges; no real forecast) | `apps/api/app/services/risk_engine.py:259` |
| A3 | **Tests use `asyncio.get_event_loop().run_until_complete` at module import.** Will raise on Python 3.12+ (where no current loop by default). | Medium | `apps/api/tests/conftest.py:30` |
| A4 | **Async test functions have no `@pytest.mark.asyncio` and `pytestmark` is not set to `asyncio_mode=auto`.** Either every test needs the decorator or `asyncio_mode` must be set in `pyproject.toml` / `pytest.ini`. Without one of these, async test bodies collect as bare coroutines and pytest skips them silently. | High (CI green despite broken tests) | `apps/api/tests/test_api.py` (every `async def test_*`) + `apps/api/tests/conftest.py` |
| A5 | **N+1 lat/lon fetch in `_find_duplicate`** — for each candidate report a separate `select(ST_X, ST_Y)` query is run; the bounding-box prefilter is claimed in a comment but not enforced. Slow with realistic load. | Medium | `apps/api/app/api/v1/reports.py:_find_duplicate` |
| A6 | **N+1 `db.get(RiskCell)` in zones list** — `_zone_out` runs per zone inside `list_zones`. | Medium | `apps/api/app/api/v1/zones.py:73-75` |
| A7 | **ML backtest uses modern `np.random.integers`** which is fine, but `ml/models/susceptibility.py` has `model.fit` followed by `model.predict_proba(X[:2000])` — fine, but second `model = get_model().fit(...)` at the top-level retrains a fresh model just for feature importances. Cheap. | Cosmetic | `ml/models/susceptibility.py:100` |
| A8 | **`publish_live` opens a fresh Redis connection on every event.** Fine at demo cadence (~1/s), will be a churn pit in production. Use a shared client. | Low | `app/services/risk_engine.py:142-153` |
| A9 | **`POST /reports/{id}/verify?decision=…` uses a query parameter** for the decision. Should be a JSON body or path — query is logged in proxies and smells. | Cosmetic / security posture | `app/api/v1/reports.py:139` |
| A10 | **CORS allow-list hard-codes `localhost:3000` + `localhost:5173`.** Any reverse-proxy / preview URL fails. Wire from env. | Low | `apps/api/app/main.py:48` |
| A11 | **`@tanstack/react-query` listed in dashboard `package.json` but never imported.** Reduces bundle size for free. | Cosmetic | `apps/dashboard/package.json:12` |
| A12 | **Stale `package-lock.json` & `next-env.d.ts` checked in** are normal, but `tsconfig.tsbuildinfo` shouldn't be. | Cosmetic | `apps/dashboard/tsconfig.tsbuildinfo` |
| A13 | **`BHURAKSHAK_FULL_CODE.txt`** 296 KB single-file dump is in the repo — fine for sharing offline, but blocks clean git history. | Cosmetic | `BHURAKSHAK_FULL_CODE.txt` |

## Where to Focus Effort (impact × ease)

> Ranked by what most influences a SIH judge's decision first 5 minutes.

1. **Train + persist Models A + B** so `model_registry.metrics` is non-null and `LodoChart` lights up. *Closes #3, #16, #17, A1 simultaneously.*
2. **Wire real Open-Meteo daily pull + a 72 h snapshot that actually varies per horizon** (fix A2 while doing this). *Closes #5 partial, #9, #18.*
3. **Ship an ESP32 / Arduino sketch under `sensors/firmware/` that publishes to `sensors/#`.** Closes #5b and lets the demo live without the simulator.
4. **Lightweight MSG91 (or Twilio) SMS adapter.** Closes #11a and the "automated SMS" PS bullet; one small adapter file + DI in `risk_engine.evaluate_zone`.
5. **Frontend "why this risk" dossier + operations queue polish.** Closes residual #2 / #10.

See `PROJECT_CONTEXT.md` "Open Questions" for product decisions still open (Layer-C real vs fake, SMS provider choice, ESP32 firmware scope, language audit owner).
