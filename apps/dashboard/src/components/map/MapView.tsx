"use client";
// MapLibre v6 command map — hex risk layer (click → dossier), 3D hillshade
// terrain relief + auto-rotate, road network, detours / blockages /
// machinery staging (from /api/v1/geo/ops), shelters (evacuation API),
// hazard-avoiding safe-route for the selected zone, citizen reports,
// rainfall radar cells (/api/v1/geo/radar) with sweep + popups, forecast
// repaint, demo storm inject/reset. All overlay data is served by the API
// (FastAPI live or in-app demo) — nothing operational is hardcoded here.
import {
  Map as MLMap, NavigationControl, AttributionControl, ScaleControl,
  Popup, setWorkerUrl, type GeoJSONSource, type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { CloudRain, RotateCcw } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { api, endpoints } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { KpisOut } from "@/lib/types";
import { usePoll } from "@/hooks/use-poll";

// maplibre-gl v6 resolves its worker via import.meta.url, which breaks under
// bundlers (resolves to "" → dead worker → sources never load). Point it at
// the self-hosted worker in /public instead.
if (typeof window !== "undefined") {
  setWorkerUrl("/maplibre-gl-worker.mjs");
}

// Basemap raster (© OpenStreetMap contributors). Added after style load
// under all data layers; offline-graceful (tiles never paint, data layers
// stay fully live). Raster paint gives the M3 look per theme.
const OSM_TILES = [
  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
];
const basemapPaint = (theme: string): Record<string, number> =>
  theme === "light"
    ? { "raster-opacity": 1, "raster-saturation": 0, "raster-brightness-max": 1 }
    : { "raster-opacity": 0.92, "raster-saturation": -0.55, "raster-brightness-max": 0.78 };

// 3D relief — AWS Terrain Tiles (terrarium encoding, free, no key). Fails
// silently offline: the map keeps the raster basemap and all vector layers.
const HILLSHADE_TILES = [
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
];
const hillshadePaint = (theme: string): Record<string, number | string> =>
  theme === "light"
    ? { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#4A5568", "hillshade-highlight-color": "#FFFFFF", "hillshade-accent-color": "#A0AEC0" }
    : { "hillshade-exaggeration": 0.55, "hillshade-shadow-color": "#050A08", "hillshade-highlight-color": "#E2E8F0", "hillshade-accent-color": "#334155" };

const emptyStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0A0F0C" } }],
};

// polygon centroid (mean of the first ring) — used to anchor the
// safe-route request on the selected zone (works for demo + live hexes)
function ringCentroid(geom: { type: string; coordinates: any }): [number, number] | null {
  if (geom?.type !== "Polygon" || !Array.isArray(geom.coordinates?.[0])) return null;
  const ring = geom.coordinates[0];
  if (!ring?.length) return null;
  let x = 0, y = 0;
  for (const [lx, ly] of ring) { x += lx; y += ly; }
  return [x / ring.length, y / ring.length];
}

type Fc = { type: string; features: any[] };

export default function MapView({ onInjectResult }: { onInjectResult?: (n: number) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const zonesFcRef = useRef<Fc | null>(null);
  const radarFcRef = useRef<Fc | null>(null);
  const { selectedZoneId, selectZone, districtFilter, horizon, radarStep, layers, role, token, theme, setEvacRoute } = useAppStore();
  const { toast } = useToast();
  const [stormBusy, setStormBusy] = useState(false);
  const [stormActive, setStormActive] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const { data: kpis } = usePoll<KpisOut>(api.kpis, 6000);

  // ---------------------------------------------------------------- init
  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new MLMap({
      container: container.current,
      style: emptyStyle,
      center: [92.7, 24.6],
      zoom: 5.6,
      pitch: 50,
      bearing: -16,
      attributionControl: false,
    });
    mapRef.current = map;
    (window as unknown as { __map?: MLMap }).__map = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new ScaleControl({ maxWidth: 100 }), "bottom-left");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");

    // slow auto-rotate for the 3D terrain flyover feel; stops for good on
    // the first user interaction (drag / touch) so it never fights the user
    let bearing = -16;
    let spinning = true;
    const spin = setInterval(() => {
      if (!spinning || !mapRef.current) return;
      bearing += 0.08;
      if (!mapRef.current.isMoving()) mapRef.current.setBearing(bearing);
    }, 90);
    const stopSpin = () => { spinning = false; };
    map.once("mousedown", stopSpin);
    map.once("touchstart", stopSpin);
    map.once("wheel", stopSpin);

    map.on("load", () => {
      // --- basemap raster: OpenStreetMap under every data layer
      map.addSource("basemap", {
        type: "raster",
        tiles: OSM_TILES,
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>',
      });
      map.addLayer({
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: basemapPaint(useAppStore.getState().theme),
      });

      // --- 3D relief (raster-dem hillshade) above the basemap
      map.addSource("hillshade-src", {
        type: "raster-dem",
        tiles: HILLSHADE_TILES,
        tileSize: 256,
        maxzoom: 13,
        encoding: "terrarium",
      });
      map.addLayer({
        id: "hillshade",
        type: "hillshade",
        source: "hillshade-src",
        paint: hillshadePaint(useAppStore.getState().theme),
      });

      // --- GeoJSON sources served by the API (zones/roads/reports/ops/
      //     radar are filled by the data effect once requests resolve)
      for (const src of ["zones", "roads", "report_points", "ops", "radar_cells", "shelters", "safe_route"]) {
        map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }

      // --- zones: fused hazard hex fill
      map.addLayer({
        id: "zones-fill", type: "fill", source: "zones",
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "hazard_level"],
            0, "#17503A", 1, "#2E7D4F", 2, "#9A7B18", 3, "#C25615", 4, "#C21F1F",
          ],
          "fill-opacity": 0.66,
        },
      });
      // susceptibility (Model A) alternative fill
      map.addLayer({
        id: "susceptibility-fill", type: "fill", source: "zones",
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "susc_mean"],
            10, "#0F2830", 30, "#0E4A3C", 50, "#7A5A0E", 70, "#9A3412", 90, "#7F1D1D",
          ],
          "fill-opacity": 0.6,
        },
      });
      // population heat overlay
      map.addLayer({
        id: "population-fill", type: "fill", source: "zones",
        layout: { visibility: "none" },
        paint: {
          "fill-color": "#D97706",
          "fill-opacity": [
            "interpolate", ["linear"], ["get", "population"],
            400, 0.05, 5600, 0.45,
          ],
        },
      });
      // radar rain cells (above fills, translucent, dashed outline)
      map.addLayer({
        id: "radar-cells-fill", type: "fill", source: "radar_cells",
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "intensity_mm_h"],
            5, "rgba(14,116,144,0.25)", 20, "rgba(8,145,178,0.45)",
            40, "rgba(245,158,11,0.55)", 60, "rgba(239,68,68,0.65)",
          ],
        },
      });
      map.addLayer({
        id: "radar-cells-outline", type: "line", source: "radar_cells",
        paint: { "line-color": "#38BDF8", "line-width": 1.5, "line-dasharray": [2, 2] },
      });
      // zone outlines + selected highlight
      map.addLayer({
        id: "zones-outline", type: "line", source: "zones",
        paint: {
          "line-color": [
            "interpolate", ["linear"], ["get", "hazard_level"],
            0, "rgba(34,197,94,0.25)", 1, "rgba(34,197,94,0.55)",
            2, "#EAB308", 3, "#F97316", 4, "#EF4444",
          ],
          "line-width": ["interpolate", ["linear"], ["get", "hazard_level"], 0, 0.6, 4, 2.2],
        },
      });
      // creep overlay (Model C active clusters)
      map.addLayer({
        id: "creep-outline", type: "line", source: "zones",
        filter: [">", ["get", "creep_mm_year"], 20],
        layout: { visibility: "none" },
        paint: { "line-color": "#06B6D4", "line-width": 1.4, "line-dasharray": [2, 2] },
      });
      map.addLayer({
        id: "zones-selected", type: "line", source: "zones",
        filter: ["==", ["get", "zone_id"], ""],
        paint: { "line-color": "#FFFFFF", "line-width": 2.6 },
      });

      // --- roads
      map.addLayer({
        id: "roads-line", type: "line", source: "roads",
        paint: {
          "line-color": [
            "match", ["get", "status"],
            "blocked", "#EF4444", "watch", "#EAB308", "#64748B",
          ],
          "line-width": [
            "interpolate", ["linear"], ["match", ["get", "cls"], "NH", 3, "SH", 2, 1],
            0, 0.8, 3, 2.6,
          ],
          "line-opacity": 0.85,
        },
      });

      // --- detour routes (cyan dashed glow, served by /api/v1/geo/ops)
      map.addLayer({
        id: "detour-lines", type: "line", source: "ops",
        filter: ["==", ["get", "type"], "detour_route"],
        paint: { "line-color": "#38BDF8", "line-width": 3.6, "line-dasharray": [3, 2] },
      });
      map.addLayer({
        id: "detour-labels", type: "symbol", source: "ops",
        filter: ["==", ["get", "type"], "detour_route"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["concat", ["get", "name"], " (", ["get", "delay"], ")"],
          "text-size": 10,
          "text-offset": [0, -1],
        },
        paint: { "text-color": "#38BDF8", "text-halo-color": "#0B1220", "text-halo-width": 2 },
      });
      // blockage points (red) + labels
      map.addLayer({
        id: "blockages-points", type: "circle", source: "ops",
        filter: ["==", ["get", "type"], "blockage"],
        paint: {
          "circle-radius": 9,
          "circle-color": "#EF4444",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#7F1D1D",
        },
      });
      map.addLayer({
        id: "blockages-labels", type: "symbol", source: "ops",
        filter: ["==", ["get", "type"], "blockage"],
        layout: {
          "text-field": ["concat", ["get", "name"], "\n", ["get", "eta"]],
          "text-size": 10,
          "text-offset": [0, 1.6],
          "text-anchor": "top",
        },
        paint: { "text-color": "#FCA5A5", "text-halo-color": "#450A0A", "text-halo-width": 2 },
      });
      // machinery staging bases (amber) + labels
      map.addLayer({
        id: "machinery-points", type: "circle", source: "ops",
        filter: ["==", ["get", "type"], "machinery_base"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#F59E0B",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#78350F",
        },
      });
      map.addLayer({
        id: "machinery-labels", type: "symbol", source: "ops",
        filter: ["==", ["get", "type"], "machinery_base"],
        layout: {
          "text-field": ["get", "name"],
          "text-size": 9.5,
          "text-offset": [0, 1.3],
          "text-anchor": "top",
        },
        paint: { "text-color": "#FCD34D", "text-halo-color": "#451A03", "text-halo-width": 2 },
      });

      // --- evacuation shelters (green, from the evacuation API)
      map.addLayer({
        id: "shelters-points", type: "circle", source: "shelters",
        paint: {
          "circle-radius": 8,
          "circle-color": "#10B981",
          "circle-stroke-width": 2.2,
          "circle-stroke-color": "#064E3B",
        },
      });
      map.addLayer({
        id: "shelters-labels", type: "symbol", source: "shelters",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
        },
        paint: { "text-color": "#6EE7B7", "text-halo-color": "#064E3B", "text-halo-width": 1.5 },
      });

      // --- safe-route for the selected zone (hazard-avoiding, amber glow)
      map.addLayer({
        id: "safe-route-line", type: "line", source: "safe_route",
        paint: {
          "line-color": "#FBBF24",
          "line-width": 4,
          "line-dasharray": [1.5, 1],
        },
      });
      map.addLayer({
        id: "safe-route-dest", type: "circle", source: "safe_route",
        filter: ["==", ["get", "type"], "destination"],
        paint: {
          "circle-radius": 10,
          "circle-color": "#FBBF24",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#78350F",
        },
      });

      // --- citizen report points
      map.addLayer({
        id: "report-points", type: "circle", source: "report_points",
        paint: {
          "circle-color": [
            "match", ["get", "status"],
            "verified", "#22C55E", "pending", "#EAB308", "#64748B",
          ],
          "circle-radius": 5,
          "circle-stroke-color": "#0F1512",
          "circle-stroke-width": 1.5,
        },
      });

      // --- click → select zone (opens DossierDrawer + safe-route)
      map.on("click", "zones-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const zid = f.properties?.zone_id as string | undefined;
        if (zid) selectZone(zid);
      });
      map.on("mouseenter", "zones-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "zones-fill", () => { map.getCanvas().style.cursor = ""; });

      // --- hover popup on zones
      const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      popupRef.current = popup;
      map.on("mousemove", "zones-fill", (e) => {
        const f = e.features?.[0];
        if (!f || !e.lngLat) { popup.remove(); return; }
        const p = f.properties ?? {};
        popup
          .setLngLat(e.lngLat)
          .setHTML(
            `<b>${p.name}</b> · <span style="color:var(--on-surface-variant)">${p.zone_code}</span><br/>` +
            `Level <b>L${p.hazard_level}</b> · susc ${p.susc_mean?.toFixed?.(1) ?? p.susc_mean} · ` +
            `${p.population?.toLocaleString?.() ?? p.population} people`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "zones-fill", () => popup.remove());

      // --- radar cell popup (identifies the rain cells on the map)
      map.on("click", "radar-cells-fill", (e) => {
        const f = e.features?.[0];
        if (!f || !e.lngLat) return;
        const p = f.properties ?? {};
        new Popup({ closeButton: true, offset: 12 })
          .setLngLat(e.lngLat)
          .setHTML(
            `<b>${p.name ?? "Rain cell"}</b><br/>` +
            `Intensity <b>${Number(p.intensity_mm_h ?? 0).toFixed(1)} mm/h</b>` +
            (p.zone_code ? ` · zone ${p.zone_code}` : ""),
          )
          .addTo(map);
      });

      // --- detour / blockage / machinery / shelter popups
      const opsPopup = (title: string, rows: string[]) => (e: any) => {
        if (!e.lngLat) return;
        new Popup({ closeButton: true, offset: 12 })
          .setLngLat(e.lngLat)
          .setHTML(`<b>${title}</b>${rows.filter(Boolean).map((r) => `<br/>${r}`).join("")}`)
          .addTo(map);
      };
      map.on("click", "detour-lines", (e) => {
        const p = e.features?.[0]?.properties ?? {};
        opsPopup(
          p.name ?? "Detour",
          [
            `Corridor <b>${p.corridor ?? "—"}</b> · delay <b>${p.delay ?? "—"}</b>`,
            p.staging ? `Staging: ${p.staging}` : "",
            "Active alternative path around the blockage (A* detour graph).",
          ],
        )(e);
      });
      map.on("click", "blockages-points", (e) => {
        const p = e.features?.[0]?.properties ?? {};
        opsPopup(
          p.name ?? "Blockage",
          [
            p.eta ? `<b>${p.eta}</b>` : "",
            p.debris_m3 ? `Debris volume ≈ ${Math.round(p.debris_m3)} m³` : "",
          ],
        )(e);
      });
      map.on("click", "machinery-points", (e) => {
        const p = e.features?.[0]?.properties ?? {};
        opsPopup(
          p.name ?? "Staging base",
          [
            p.corridor ? `Corridor <b>${p.corridor}</b>` : "",
            p.jcb_count ? `Heavy machinery on site: <b>${p.jcb_count} excavators</b>` : "",
          ],
        )(e);
      });
      map.on("click", "shelters-points", (e) => {
        const p = e.features?.[0]?.properties ?? {};
        const free = Number(p.free_beds ?? p.free ?? 0);
        opsPopup(
          p.name ?? "Shelter",
          [
            `Capacity <b>${p.capacity ?? "—"}</b> · free <b>${free}</b>`,
            p.has_medical ? "Medical unit on site" : "No medical unit",
            p.district ? `District: ${p.district}` : "",
          ],
        )(e);
      });

      // sources + layers now exist — allow the data effect to (re)run.
      setMapReady(true);
    });

    return () => {
      clearInterval(spin);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [selectZone]);

  // re-tint basemap + hillshade when the M3 color scheme flips (paint
  // props, no tile swap; no-op until the layers exist).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("basemap")) return;
    for (const [prop, val] of Object.entries(basemapPaint(theme))) {
      map.setPaintProperty("basemap", prop as "raster-opacity", val);
    }
    if (map.getLayer("hillshade")) {
      for (const [prop, val] of Object.entries(hillshadePaint(theme))) {
        map.setPaintProperty("hillshade", prop as "hillshade-exaggeration", val as never);
      }
    }
  }, [theme]);

  // ---------------------------------------------------------------- data
  useEffect(() => {
    const setData = (id: string, fc: any) => {
      const s = mapRef.current?.getSource(id) as GeoJSONSource | undefined;
      if (s && fc) s.setData(fc);
    };
    const get = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const p = new URLSearchParams();
    if (districtFilter) p.set("district", districtFilter);
    if (horizon) p.set("horizon", String(horizon));
    const qs = p.toString();
    const B = endpoints.API;

    void get(`${B}/api/v1/geo/zones${qs ? `?${qs}` : ""}`).then((fc) => {
      zonesFcRef.current = fc ?? null;
      setData("zones", fc);
    });
    void get(`${B}/api/v1/geo/roads`).then((fc) => setData("roads", fc));
    void get(`${B}/api/v1/geo/reports`).then((fc) => setData("report_points", fc));
    // ops overlay: detours, blockages, machinery staging (backend-computed)
    void get(`${B}/api/v1/geo/ops`).then((fc) => setData("ops", fc));
    // rainfall radar cells (live rain_1h or calibrated demo cells)
    void get(`${B}/api/v1/geo/radar`).then((fc) => {
      radarFcRef.current = fc ?? null;
      setData("radar_cells", fc);
    });
    // evacuation shelters (live Shelter table or demo registry)
    void get(`${B}/api/v1/evacuation/shelters`).then((rows: any[] | null) => {
      if (!Array.isArray(rows) || !rows.length) return;
      setData("shelters", {
        type: "FeatureCollection",
        features: rows
          .filter((s) => s.lat != null && s.lon != null)
          .map((s) => ({
            type: "Feature",
            properties: {
              name: s.name,
              district: s.district,
              capacity: s.capacity,
              free: s.free_beds ?? (s.capacity != null && s.occupancy != null ? s.capacity - s.occupancy : null),
              free_beds: s.free_beds ?? null,
              has_medical: s.has_medical ?? null,
            },
            geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          })),
      });
    }).catch(() => {});
  }, [districtFilter, horizon, stormActive, mapReady]);

  // ---------------------------------------------------------------- safe route
  // Selecting a zone draws the hazard-avoiding evacuation route from the
  // zone centroid to the safest reachable shelter (live A* service).
  useEffect(() => {
    const map = mapRef.current;
    const s = map?.getSource("safe_route") as GeoJSONSource | undefined;
    if (!s) return;
    if (!selectedZoneId || !zonesFcRef.current) {
      s.setData({ type: "FeatureCollection", features: [] });
      setEvacRoute(null);
      return;
    }
    const f = zonesFcRef.current.features.find(
      (x: any) => x?.properties?.zone_id === selectedZoneId,
    );
    const c = f ? ringCentroid(f.geometry) : null;
    if (!c) return;
    let cancelled = false;
    api.safeRoute(c[1], c[0]).then((out: any) => {
      if (cancelled || !s) return;
      // demo contract: route is a bare [lon,lat][]; live FastAPI returns
      // {"type":"LineString","coordinates":[...]} — normalize both
      const route = Array.isArray(out?.route)
        ? out.route
        : Array.isArray(out?.route?.coordinates)
          ? out.route.coordinates
          : null;
      if (!out || out.reachable === false || !route?.length) {
        s.setData({ type: "FeatureCollection", features: [] });
        setEvacRoute(null);
        return;
      }
      const shelterName = out.shelter?.name ?? out.destination?.name ?? "Shelter";
      const km = out.distance_km ?? out.route_length_km ?? null;
      const eta = out.eta_walk_min ?? out.eta_minutes ?? null;
      // publish the normalized route for the DossierDrawer evacuation card
      setEvacRoute({
        zoneId: selectedZoneId,
        data: {
          shelter: out.shelter ?? out.destination ?? null,
          shelterName,
          distance_km: km,
          eta_min: eta,
          advisory: out.advisory ?? null,
          hazard_penalty_km: out.hazard_penalty_km ?? out.mean_hazard_along_route ?? null,
          route,
        },
      });
      s.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { type: "route", distance_km: km, eta_min: eta },
            geometry: { type: "LineString", coordinates: route },
          },
          {
            type: "Feature",
            properties: { type: "destination", name: shelterName },
            geometry: { type: "Point", coordinates: route[route.length - 1] },
          },
        ],
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedZoneId, mapReady, setEvacRoute]);

  // ---------------------------------------------------------------- fitBounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    fetch(`${endpoints.API}/api/v1/geo/zones${districtFilter ? `?district=${encodeURIComponent(districtFilter)}` : ""}`)
      .then((r) => r.json())
      .then((fc: any) => {
        if (!fc?.features?.length) return;
        const lons: number[] = [], lats: number[] = [];
        for (const f of fc.features) {
          for (const ring of f.geometry.coordinates) {
            for (const [x, y] of ring) { lons.push(x); lats.push(y); }
          }
        }
        map.fitBounds(
          [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
          { padding: 90, duration: 900, pitch: 40 },
        );
      })
      .catch(() => {});
  }, [districtFilter, mapReady]);

  // ---------------------------------------------------------------- radar sweep
  // Scrubbed playback: scale intensity + drift cells like a radar frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("radar_cells")) return;
    const source = map.getSource("radar_cells") as GeoJSONSource;
    const base = radarFcRef.current;
    if (!base?.features?.length) return;
    const mults = [0.3, 0.4, 0.55, 0.7, 0.85, 0.95, 1.0, 1.15, 1.3, 1.45, 1.2, 0.8];
    const m = mults[radarStep] ?? 1.0;
    const dx = (radarStep - 6) * 0.012;
    const dy = (radarStep - 6) * 0.008;
    const shift = (geom: any): any => {
      if (geom?.type !== "Polygon" || !Array.isArray(geom.coordinates?.[0])) return geom;
      return {
        type: "Polygon",
        coordinates: [geom.coordinates[0].map(([x, y]: [number, number]) => [x + dx, y + dy])],
      };
    };
    source.setData({
      type: "FeatureCollection",
      features: base.features.map((f: any) => ({
        ...f,
        properties: {
          ...f.properties,
          intensity_mm_h:
            Math.round((Number(f.properties?.intensity_mm_h ?? 0) * m) * 10) / 10,
        },
        geometry: shift(f.geometry),
      })),
    });
  }, [radarStep]);

  // ---------------------------------------------------------------- layers visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const vis = (id: string, on: boolean) =>
      map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("hillshade", layers.terrain);
    vis("susceptibility-fill", layers.susceptibility);
    vis("zones-fill", layers.hazard && !layers.susceptibility);
    vis("zones-outline", layers.hazard && !layers.susceptibility);
    vis("radar-cells-fill", layers.radar);
    vis("radar-cells-outline", layers.radar);
    vis("creep-outline", layers.creep);
    vis("population-fill", layers.population);
    vis("roads-line", layers.roads);
    vis("detour-lines", layers.detours);
    vis("detour-labels", layers.detours);
    vis("blockages-points", layers.detours);
    vis("blockages-labels", layers.detours);
    vis("machinery-points", layers.detours);
    vis("machinery-labels", layers.detours);
    vis("shelters-points", layers.shelters);
    vis("shelters-labels", layers.shelters);
    vis("report-points", layers.reports);
  }, [layers]);

  // ---------------------------------------------------------------- selected highlight
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("zones-selected")) return;
    map.setFilter("zones-selected", ["==", ["get", "zone_id"], selectedZoneId ?? ""]);
  }, [selectedZoneId]);

  // ---------------------------------------------------------------- storm demo
  const inject = async () => {
    setStormBusy(true);
    try {
      const r = await api.injectStorm(token);
      setStormActive(true);
      onInjectResult?.(r.zones_at_l2_plus ?? 0);
      toast({
        title: "Demo storm injected",
        description: `${r.zones_injected} East Khasi Hills zones ramped to 55 mm/h — ${r.zones_at_l2_plus} zones now L2+. Watch the hysteresis ladder escalate.`,
      });
    } catch (e) {
      toast({ title: "Inject failed", description: String(e), variant: "destructive" });
    } finally {
      setStormBusy(false);
    }
  };
  const reset = async () => {
    setStormBusy(true);
    try {
      await api.resetStorm(token);
      setStormActive(false);
      selectZone(null);
      onInjectResult?.(0);
      toast({ title: "Storm reset", description: "World re-seeded to live-gauge baseline — KPIs back to normal." });
    } catch (e) {
      toast({ title: "Reset failed", description: String(e), variant: "destructive" });
    } finally {
      setStormBusy(false);
    }
  };

  const storm = stormActive || (kpis?.zones_l3_l4 ?? 0) > 0;

  return (
    <div className="relative flex-1 min-h-[420px]">
      {/* Inline styles (not Tailwind classes): maplibre-gl v6 injects its own
          stylesheet containing `.maplibregl-map { position: relative; }`,
          which overrides Tailwind's `.absolute` by source order and collapses
          this container to 0 height. Inline styles always win. */}
      <div
        ref={container}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        className="rounded-lg overflow-hidden border border-outline-variant/60"
      />

      {/* demo storm controls (admin) */}
      {role === "admin" && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex gap-2">
          {!storm ? (
            <Button size="sm" variant="tonal" onClick={inject} disabled={stormBusy}
              className="gap-1.5 elevation-2">
              <CloudRain className="h-3.5 w-3.5" /> Inject demo storm
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={reset} disabled={stormBusy}
              className="gap-1.5 elevation-2">
              <RotateCcw className="h-3.5 w-3.5" /> Reset storm
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
