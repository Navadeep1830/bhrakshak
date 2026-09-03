# BhuRakshak Command Center — Material Design 3 Dashboard

The primary web frontend for **SIH 26001 — AI-Based Early Warning & Landslide Risk Monitoring System (NER)**, rebuilt on **Next.js 16 + Material Design 3 (Material You)** with a full tonal color system, Roboto type scale, elevation + state layers, light/dark schemes, and 60 fps MapLibre 3D hex mapping.

## Two run modes — one codebase

| Mode | How | What you get |
|------|-----|--------------|
| **DEMO (default)** | `npm install && npm run dev` | The complete platform with an **in-memory API** (30 route handlers under `src/app/api/v1/*` that port the FastAPI contract). Zero infrastructure — perfect for judges, demos, and offline venues. |
| **LIVE** | `NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev` | Every call routes to the real **FastAPI + PostGIS/Postgres** backend (auth via real JWT, 536 zones, live sensors). The map consumes the new `/api/v1/geo/*` GeoJSON endpoints; chat attaches the `/ws/live` WebSocket with polling fallback. |

The active mode is shown as a **DEMO / LIVE API** chip in the top app bar.

## Quickstart (demo)

```bash
cd apps/dashboard
npm install
npm run dev          # http://localhost:3000
```

Demo logins (quick-pick buttons on the sign-in screen):

| Role | Email | Password | Sees |
|------|-------|----------|------|
| Platform Admin | `admin@bhrakshak.in` | `Admin@123` | everything + storm inject/reset |
| DC East Khasi Hills | `dc.ekh@bhrakshak.in` | `District@123` | district-scoped command + ops |
| DC Aizawl | `dc.aizawl@bhrakshak.in` | `District@123` | district-scoped command + ops |
| Field Official · Noney | `field.noney@bhrakshak.in` | `Field@123` | ops + field PWA + chat |
| Citizen · Noney | `citizen@bhrakshak.in` | `Citizen@123` | citizen PWA only |

## What's inside

- **Command Center** — MapLibre 3D hex risk map (fused hazard, Model A susceptibility, rainfall radar sweep, PSInSAR creep, population heat), KPI bar, layer rail, legend, radar scrubber with NOW/+24/+48/+72 h forecast horizons, live ticker, and the **hex-click zone dossier** (risk drivers with contribution bars, 72 h rainfall projection, probability history, I-D threshold check, nearby field reports, copyable markdown briefing).
- **Operations** — Model D response priority queue with DC SOP directives and team assignment, alerts console with acknowledgement, 8-language alert preview-fire, live ops feed, and the **Field Chat** panel (FAB, unread badge, WS + polling).
- **Analytics** — LODO backtest POD/FAR/CSI per level, Tupul 2022 lead-time reconstruction, I-D threshold curves, Noney 2022 event replay with a scrubber, and the model registry. All numbers come from `/api/v1/analytics/backtest` + `registry` — never hardcoded.
- **Field PWA** — the offline-first citizen/field view in a phone frame: 8 NER languages, offline report queue (localStorage) with dedupe-safe sync, **Edge Vision** on-device photo triage, SOS, alert inbox, M3 bottom navigation.
- **Demo controls** (admin) — *Inject demo storm* ramps 9 East Khasi Hills zones to 55 mm/h so you can watch the hysteresis ladder escalate L1→L4, alerts fire in 8 languages, and the ops queue fill; *Reset storm* re-seeds the world.

## Design system

`src/app/globals.css` implements a complete **Material 3 token set** — color roles (primary / secondary / tertiary / error, tonal surface containers, outlines, inverse), the Roboto type scale (`text-display-*` … `text-label-*`), M3 shape scale (`rounded-xs` … `rounded-xl`), elevation utilities (`elevation-1..5`, tinted shadows), state layers (`.state-layer`), and motion tokens. Dark scheme is default (ops room); toggle light/dark from the top app bar. Domain risk colors (L0–L4) stay fixed across schemes for legibility.

## Gotchas (learned the hard way)

- **MapLibre v6 workers**: `setWorkerUrl("/maplibre-gl-worker.mjs")` must point at the vendored worker in `public/` — under bundlers the default `import.meta.url` resolution breaks and sources never load. Both worker files are pinned to maplibre-gl 6.6.0.
- **Map container**: use inline styles (`position: absolute; inset: 0`) — maplibre-gl v6 injects `.maplibregl-map { position: relative }` which overrides Tailwind's `.absolute` by source order and collapses the container.
- **Data loading race**: zone GeoJSON is fetched after `mapReady` (the map `load` event) — fetching before the sources exist silently drops the data.
- `reactStrictMode: false` — StrictMode double-mount kills the map worker mid-boot.

## Contribute / agent notes

The demo API (`src/lib/server/*`) is a faithful port of the FastAPI contract (auth, risk engine with hysteresis + 72 h projection, priority, evacuation, roads, reports with 50 m/1 h dedupe sync, i18n templates in 8 languages, backtest fixture). When you change the backend contract, mirror it in the demo routes so the dashboard keeps working in both modes.
