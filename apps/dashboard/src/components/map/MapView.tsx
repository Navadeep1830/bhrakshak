"use client";

import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { endpoints } from "@/lib/api";
import { LEVEL_COLORS } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

const emptyStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#070D18" } }],
};

const CARTO_TILES = [
  "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
  "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
];

export const DISTRICT_VIEWS = [
  { name: "Aizawl", center: [92.72, 23.73] as [number, number], zoom: 9.4 },
  { name: "Sohra / EKH", center: [91.6, 25.42] as [number, number], zoom: 9.2 },
  { name: "Noney", center: [93.82, 24.98] as [number, number], zoom: 10 },
  { name: "Imphal West", center: [93.94, 24.81] as [number, number], zoom: 10.4 },
  { name: "Gangtok", center: [88.56, 27.42] as [number, number], zoom: 10 },
];

const RISK_FILL_OPACITY = [
  "case",
  [">=", ["get", "hazard_level"], 2], 0.62,
  [">=", ["get", "hazard_level"], 1], 0.42,
  0.26,
] as unknown as maplibregl.ExpressionSpecification;

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const layersRef = useRef(useAppStore.getState().layers);
  const centroidRef = useRef<Record<string, GeoJSON.Feature["geometry"]> | null>(null);
  const crowdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectZone = useAppStore((s) => s.selectZone);
  const selectedZoneId = useAppStore((s) => s.selectedZoneId);
  const layers = useAppStore((s) => s.layers);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: emptyStyle,
      center: [92.7, 24.6],
      zoom: 5.6,
      pitch: 50,
      bearing: -16,
      antialias: true,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), "bottom-left");

    let bearing = -16;
    let spun = true;
    const spin = setInterval(() => {
      if (!spun || !mapRef.current) return;
      bearing += 0.08;
      if (!mapRef.current.isMoving()) mapRef.current.setBearing(bearing);
    }, 90);
    const stopSpin = () => (spun = false);
    map.once("mousedown", stopSpin);
    map.once("touchstart", stopSpin);

    // pulse overlay on high-risk (L3+) cells
    let up = true;
    let alpha = 0.08;
    const pulser = setInterval(() => {
      alpha += up ? 0.02 : -0.02;
      if (alpha >= 0.22) up = false;
      if (alpha <= 0.06) up = true;
      const m = mapRef.current;
      if (m && m.isStyleLoaded() && m.getLayer("risk-l4-pulse")) {
        try {
          m.setPaintProperty("risk-l4-pulse", "fill-color", `rgba(168,85,247,${alpha.toFixed(3)})`);
        } catch {
          /* noop */
        }
      }
    }, 120);

    map.on("error", (e) => console.warn("[maplibre]", e?.error ?? e));

    map.on("load", () => {
      // --- basemap raster (fails gracefully offline; vector layers stay live)
      map.addSource("basemap", {
        type: "raster",
        tiles: CARTO_TILES,
        tileSize: 256,
        maxzoom: 19,
      });
      map.addLayer({
        id: "basemap",
        type: "raster",
        source: "basemap",
        paint: { "raster-opacity": 0.85 },
      });
      map.addSource("carto-attrib", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        attribution:
          '<a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a> · <a href="https://carto.com/attributions" target="_blank">© CARTO</a>',
      });

      // --- hillshade relief for real 3D terrain feel (fails silently offline)
      map.addSource("hillshade-src", {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 13,
        encoding: "terrarium",
      });
      map.addLayer({
        id: "hillshade",
        type: "hillshade",
        source: "hillshade-src",
        paint: {
          "hillshade-exaggeration": 0.5,
          "hillshade-shadow-color": "#050A14",
          "hillshade-highlight-color": "#E2E8F0",
          "hillshade-accent-color": "#334155",
        },
      });

      // --- Martin vector sources straight from PostGIS
      for (const src of ["risk_cells", "zones", "road_status", "citizen_reports"]) {
        map.addSource(src, {
          type: "vector",
          tiles: [`${endpoints.MARTIN}/${src}/{z}/{x}/{y}`],
          maxzoom: 14,
        });
      }

      // susceptibility view (zones tinted by Model A score)
      map.addLayer({
        id: "susceptibility-fill",
        type: "fill",
        source: "zones",
        "source-layer": "zones",
        layout: { visibility: "none" },
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["to-number", ["get", "susc_mean"]],
            30, "#14532d", 55, "#EAB308", 80, "#F97316", 95, "#DC2626",
          ],
          "fill-opacity": 0.42,
        },
      });

      // current hazard surface
      map.addLayer({
        id: "risk-fill",
        type: "fill",
        source: "risk_cells",
        "source-layer": "risk_cells",
        paint: {
          "fill-color": [
            "match", ["get", "hazard_level"],
            0, LEVEL_COLORS[0], 1, LEVEL_COLORS[1], 2, LEVEL_COLORS[2],
            3, LEVEL_COLORS[3], 4, LEVEL_COLORS[4], "#334155",
          ],
          "fill-opacity": RISK_FILL_OPACITY,
        },
      });

      // breathing overlay on L3+ cells (pulse handled via interval above)
      map.addLayer({
        id: "risk-l4-pulse",
        type: "fill",
        source: "risk_cells",
        "source-layer": "risk_cells",
        filter: [">=", ["get", "hazard_level"], 3],
        paint: { "fill-color": "rgba(168,85,247,0.08)" },
      });

      // hover + selection outlines
      map.addLayer({
        id: "zone-hover-outline",
        type: "line",
        source: "risk_cells",
        "source-layer": "risk_cells",
        filter: ["==", ["get", "zone_id"], "__none__"],
        paint: { "line-color": "#F8FAFC", "line-width": 2 },
      });
      map.addLayer({
        id: "zone-selected-outline",
        type: "line",
        source: "risk_cells",
        "source-layer": "risk_cells",
        filter: ["==", ["get", "zone_id"], "__none__"],
        paint: { "line-color": "#FB923C", "line-width": 2.6 },
      });

      map.addLayer({
        id: "zone-outline",
        type: "line",
        source: "zones",
        "source-layer": "zones",
        paint: { "line-color": "#33415566", "line-width": 0.7 },
      });

      // roads
      map.addLayer({
        id: "roads-line",
        type: "line",
        source: "road_status",
        "source-layer": "road_status",
        paint: {
          "line-color": [
            "match", ["get", "status"],
            "open", "#22C55E",
            "risk", "#EAB308",
            "predicted_blocked", "#F97316",
            "confirmed_blocked", "#EF4444",
            "#64748B",
          ],
          "line-width": 2.6,
        },
      });

      // Relief Shelters & Critical Infrastructure GeoJSON source
      map.addSource("shelters", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: { name: "Govt Mizo High School Relief Camp", capacity: 850, district: "Aizawl", type: "Shelter" }, geometry: { type: "Point", coordinates: [92.715, 23.732] } },
            { type: "Feature", properties: { name: "Durtlang Community Hall Shelter", capacity: 600, district: "Aizawl", type: "Shelter" }, geometry: { type: "Point", coordinates: [92.730, 23.785] } },
            { type: "Feature", properties: { name: "Sohra Civil Hospital Staging Camp", capacity: 700, district: "East Khasi Hills", type: "Hospital/Shelter" }, geometry: { type: "Point", coordinates: [91.720, 25.280] } },
            { type: "Feature", properties: { name: "Tupul Railway Station Emergency Camp", capacity: 500, district: "Noney", type: "Shelter" }, geometry: { type: "Point", coordinates: [93.680, 24.810] } },
            { type: "Feature", properties: { name: "Paljor Stadium Emergency Evacuation Shelter", capacity: 1200, district: "Gangtok", type: "Stadium/Shelter" }, geometry: { type: "Point", coordinates: [88.612, 27.332] } },
          ],
        },
      });

      map.addLayer({
        id: "shelters-points",
        type: "circle",
        source: "shelters",
        paint: {
          "circle-radius": 8,
          "circle-color": "#10B981",
          "circle-stroke-width": 2.2,
          "circle-stroke-color": "#064E3B",
        },
      });

      map.addLayer({
        id: "shelters-labels",
        type: "symbol",
        source: "shelters",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#6EE7B7",
          "text-halo-color": "#064E3B",
          "text-halo-width": 1.5,
        },
      });

      // Precipitation Radar Intensity Cells GeoJSON Source
      map.addSource("radar_cells", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            { type: "Feature", properties: { intensity_mm_h: 62.0, name: "Sohra Cloudburst Cell" }, geometry: { type: "Polygon", coordinates: [[[91.60, 25.20], [91.85, 25.20], [91.85, 25.35], [91.60, 25.35], [91.60, 25.20]]] } },
            { type: "Feature", properties: { intensity_mm_h: 48.0, name: "Tupul Convective Band" }, geometry: { type: "Polygon", coordinates: [[[93.58, 24.72], [93.78, 24.72], [93.78, 24.90], [93.58, 24.90], [93.58, 24.72]]] } },
            { type: "Feature", properties: { intensity_mm_h: 36.0, name: "Aizawl Ridge Downpour" }, geometry: { type: "Polygon", coordinates: [[[92.65, 23.68], [92.80, 23.68], [92.80, 23.85], [92.65, 23.85], [92.65, 23.68]]] } },
            { type: "Feature", properties: { intensity_mm_h: 42.0, name: "Kohima-Zubza Cell" }, geometry: { type: "Polygon", coordinates: [[[94.00, 25.60], [94.18, 25.60], [94.18, 25.75], [94.00, 25.75], [94.00, 25.60]]] } },
          ],
        },
      });

      map.addLayer({
        id: "radar-cells-fill",
        type: "fill",
        source: "radar_cells",
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "intensity_mm_h"],
            10, "#10B981",
            25, "#FBBF24",
            45, "#F97316",
            65, "#EF4444",
            80, "#991B1B"
          ],
          "fill-opacity": 0.45,
        },
      });

      map.addLayer({
        id: "radar-cells-outline",
        type: "line",
        source: "radar_cells",
        paint: {
          "line-color": "#38BDF8",
          "line-width": 1.5,
          "line-dasharray": [2, 2],
        },
      });

      // Detour polylines, Blockages & Machinery Staging GeoJSON source
      map.addSource("detours", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            // NH-29 Jotsoma-Medziphema Bypass Detour Polyline
            {
              type: "Feature",
              properties: { name: "NH-29 Jotsoma–Medziphema Emergency Bypass", type: "detour_route", corridor: "NH-29", delay: "+45 min" },
              geometry: {
                type: "LineString",
                coordinates: [[93.85, 25.75], [93.92, 25.62], [94.02, 25.64], [94.05, 25.68]],
              },
            },
            // NH-102 Kakching-Machi Bypass Detour Polyline
            {
              type: "Feature",
              properties: { name: "NH-102 Kakching–Machi Emergency Detour", type: "detour_route", corridor: "NH-102", delay: "+60 min" },
              geometry: {
                type: "LineString",
                coordinates: [[93.95, 24.78], [93.98, 24.62], [94.08, 24.45], [94.15, 24.38]],
              },
            },
            // NH-29 Blockage Point
            {
              type: "Feature",
              properties: { name: "🛑 NH-29 Paglapahar Choke Point (Blocked)", type: "blockage", corridor: "NH-29", eta: "Clearance ETA: 17.6h" },
              geometry: { type: "Point", coordinates: [93.95, 25.71] },
            },
            // NH-102 Blockage Point
            {
              type: "Feature",
              properties: { name: "🛑 NH-102 Tengnoupal Ridge Slip (Blocked)", type: "blockage", corridor: "NH-102", eta: "Clearance ETA: 11.8h" },
              geometry: { type: "Point", coordinates: [94.05, 24.58] },
            },
            // Machinery Staging Bases
            {
              type: "Feature",
              properties: { name: "🚜 Medziphema PWD Heavy Base (2 JCBs)", type: "machinery_base" },
              geometry: { type: "Point", coordinates: [93.87, 25.755] },
            },
            {
              type: "Feature",
              properties: { name: "🚜 Pallel BRO Sector Base (4 JCBs)", type: "machinery_base" },
              geometry: { type: "Point", coordinates: [94.02, 24.52] },
            },
          ],
        },
      });

      // Detour Route Line Layer (Cyan Dashed Glow)
      map.addLayer({
        id: "detour-lines",
        type: "line",
        source: "detours",
        filter: ["==", ["get", "type"], "detour_route"],
        paint: {
          "line-color": "#38BDF8",
          "line-width": 3.6,
          "line-dasharray": [3, 2],
        },
      });

      map.addLayer({
        id: "detour-labels",
        type: "symbol",
        source: "detours",
        filter: ["==", ["get", "type"], "detour_route"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["concat", ["get", "name"], " (", ["get", "delay"], ")"],
          "text-size": 10,
          "text-offset": [0, -1],
        },
        paint: {
          "text-color": "#38BDF8",
          "text-halo-color": "#0B1220",
          "text-halo-width": 2,
        },
      });

      // Blocked Points Layer (Red)
      map.addLayer({
        id: "blockages-points",
        type: "circle",
        source: "detours",
        filter: ["==", ["get", "type"], "blockage"],
        paint: {
          "circle-radius": 9,
          "circle-color": "#EF4444",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#7F1D1D",
        },
      });

      map.addLayer({
        id: "blockages-labels",
        type: "symbol",
        source: "detours",
        filter: ["==", ["get", "type"], "blockage"],
        layout: {
          "text-field": ["concat", ["get", "name"], "\n", ["get", "eta"]],
          "text-size": 10,
          "text-offset": [0, 1.6],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#FCA5A5",
          "text-halo-color": "#450A0A",
          "text-halo-width": 2,
        },
      });

      // Machinery Staging Bases Layer (Amber)
      map.addLayer({
        id: "machinery-points",
        type: "circle",
        source: "detours",
        filter: ["==", ["get", "type"], "machinery_base"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#F59E0B",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#78350F",
        },
      });

      map.addLayer({
        id: "machinery-labels",
        type: "symbol",
        source: "detours",
        filter: ["==", ["get", "type"], "machinery_base"],
        layout: {
          "text-field": ["get", "name"],
          "text-size": 10,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
        },
        paint: {
          "text-color": "#FCD34D",
          "text-halo-color": "#451A03",
          "text-halo-width": 1.5,
        },
      });

      // citizen reports
      map.addLayer({
        id: "reports-circles",
        type: "circle",
        source: "citizen_reports",
        "source-layer": "citizen_reports",
        layout: { visibility: "visible" },
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "match", ["get", "status"],
            "verified", "#22C55E",
            "rejected", "#475569",
            "#38BDF8",
          ],
          "circle-stroke-width": 1.6,
          "circle-stroke-color": "#0B1220",
        },
      });

      // --- live BLE crowd-density layer (feature 3) -------------------------
      // Points come from /api/v1/ble/heatmap: one entry per zone with a fresh
      // (<2h) beacon sighting, intensity already recency-decayed server-side.
      // Zone centroids are embedded in the payload as Point features.
      map.addSource("ble-crowd", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("population-heat", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "population-heat-circles",
        type: "circle",
        source: "population-heat",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["coalesce", ["get", "intensity"], 0],
            0, 4, 2000, 10, 20000, 18, 100000, 28,
          ],
          "circle-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "hazard_level"], 0],
            0, "#FACD3A", 2, "#FB923C", 4, "#F87171",
          ],
          "circle-opacity": 0.4,
          "circle-blur": 0.9,
          "circle-stroke-width": 0.6,
          "circle-stroke-color": "#0B1220",
        },
      });
      map.addLayer({
        id: "ble-crowd-glow",
        type: "circle",
        source: "ble-crowd",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["coalesce", ["get", "intensity"], 0],
            0, 4, 10, 14, 40, 26, 120, 40,
          ],
          "circle-color": "#38BDF8",
          "circle-opacity": 0.18,
          "circle-blur": 1.1,
        },
      });
      map.addLayer({
        id: "ble-crowd-core",
        type: "circle",
        source: "ble-crowd",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["coalesce", ["get", "intensity"], 0],
            0, 3, 10, 8, 40, 13, 120, 19,
          ],
          "circle-color": [
            "interpolate", ["linear"], ["coalesce", ["get", "intensity"], 0],
            0, "#0EA5E9", 40, "#38BDF8", 120, "#F472B6",
          ],
          "circle-stroke-width": 1.4,
          "circle-stroke-color": "#0B1220",
        },
      });
      map.on("click", "ble-crowd-core", (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new maplibregl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif;font-size:12px;color:#F8FAFC;background:#111A2C;padding:8px;border-radius:6px;border:1px solid #38BDF8">
               <div style="font-weight:bold;color:#38BDF8;font-size:13px">📡 Live crowd estimate — ${p.name}</div>
               <div style="margin-top:4px">Devices seen: <b>${p.n_devices}</b> · ≈<b>${p.estimated_people}</b> people</div>
               <div style="margin-top:4px;font-size:11px;color:#94A3B8">${p.n_reporters} reporter(s) · ${p.age_min} min ago · zone ${p.zone_code}</div>
             </div>`
          )
          .addTo(map);
      });

      // refresh the crowd layer every 60 s (only while visible)
      const loadCrowd = () => {
        if (!layersRef.current.crowd) return;
        fetch(`${endpoints.API}/api/v1/ble/heatmap`)
          .then((r) => (r.ok ? r.json() : null))
          .then((heat) => {
            const src = map.getSource("ble-crowd") as maplibregl.GeoJSONSource | undefined;
            if (!src || !heat?.zones?.length) return;
            src.setData({
              type: "FeatureCollection",
              features: heat.zones.map((z: { zone_code: string; name: string; n_devices: number; estimated_people: number; n_reporters: number; age_min: number; intensity: number; district?: string }) => ({
                type: "Feature",
                properties: { ...z },
                geometry: centroidRef.current?.[z.zone_code] ?? null,
              })).filter((f: { geometry: unknown }) => f.geometry != null),
            });
          })
          .catch(() => {});
      };
      loadCrowd();
      const crowdTimer = setInterval(loadCrowd, 60_000);
      crowdTimerRef.current = crowdTimer;

      // interactions
      let hovered: string | null = null;
      map.on("mousemove", "risk-fill", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features?.[0];
        const id = f?.properties?.zone_id != null ? String(f.properties.zone_id) : null;
        if (id && id !== hovered) {
          hovered = id;
          map.setFilter("zone-hover-outline", ["==", ["get", "zone_id"], id]);
        }
      });
      map.on("mouseleave", "risk-fill", () => {
        map.getCanvas().style.cursor = "";
        hovered = null;
        map.setFilter("zone-hover-outline", ["==", ["get", "zone_id"], "__none__"]);
      });
      map.on("click", "risk-fill", (e) => {
        const f = e.features?.[0];
        if (f?.properties?.zone_id) selectZone(String(f.properties.zone_id));
      });
      map.on("click", "reports-circles", (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new maplibregl.Popup({ closeButton: false })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif;font-size:12px">
               <b>${p.category}</b> · <span style="color:${p.status === "verified" ? "#16a34a" : "#0ea5e9"}">${p.status}</span>
             </div>`
          )
          .addTo(map);
      });

      // Blockages Popup Handler
      map.on("click", "blockages-points", (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new maplibregl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif;font-size:12px;color:#F8FAFC;background:#111A2C;padding:8px;border-radius:6px;border:1px solid #EF4444">
               <div style="font-weight:bold;color:#F87171;font-size:13px">${p.name}</div>
               <div style="margin-top:4px;color:#FCA5A5;font-weight:600">${p.eta}</div>
               <div style="margin-top:4px;font-size:11px;color:#94A3B8">Alternate Route: <b style="color:#38BDF8">Mountain Bypass Active</b></div>
             </div>`
          )
          .addTo(map);
      });

      // Detour Bypass Popup Handler
      map.on("click", "detour-lines", (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new maplibregl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif;font-size:12px;color:#F8FAFC;background:#111A2C;padding:8px;border-radius:6px;border:1px solid #38BDF8">
               <div style="font-weight:bold;color:#38BDF8;font-size:13px">🛣️ ${p.name}</div>
               <div style="margin-top:4px;color:#E2E8F0">Transit Penalty: <b style="color:#FBBF24">${p.delay}</b></div>
               <div style="margin-top:4px;font-size:11px;color:#6EE7B7">Status: Single-lane emergency convoy cleared ✓</div>
             </div>`
          )
          .addTo(map);
      });

      // Shelter Popup Handler
      map.on("click", "shelters-points", (e) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        new maplibregl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-family:Inter,sans-serif;font-size:12px;color:#F8FAFC;background:#111A2C;padding:8px;border-radius:6px;border:1px solid #10B981">
               <div style="font-weight:bold;color:#34D399;font-size:13px">🏕️ ${p.name}</div>
               <div style="margin-top:4px;color:#E2E8F0">Capacity: <b>${p.capacity} evacuees</b> (${p.district})</div>
               <div style="margin-top:4px;font-size:11px;color:#6EE7B7">Medical Trauma Unit Ready · Water Stockpiled ✓</div>
             </div>`
          )
          .addTo(map);
      });

      // zone centroids (population-heatmap payload) power the BLE crowd layer
      fetch(`${endpoints.API}/api/v1/analytics/population-heatmap`)
        .then((r) => (r.ok ? r.json() : null))
        .then((ph) => {
          if (!ph?.features?.length) return;
          const cents: Record<string, GeoJSON.Feature["geometry"]> = {};
          for (const f of ph.features) {
            if (f?.properties?.zone_code && f?.geometry) cents[f.properties.zone_code] = f.geometry;
          }
          centroidRef.current = cents;
          // population layer shares the same payload
          const psrc = map.getSource("population-heat") as maplibregl.GeoJSONSource | undefined;
          if (psrc) psrc.setData({ type: "FeatureCollection", features: ph.features });
        })
        .catch(() => {});

      // expose flyTo for the rail
      (window as unknown as { __flyTo?: (c: number[], z: number) => void }).__flyTo = (
        c: number[],
        z: number
      ) => map.flyTo({ center: c as [number, number], zoom: z, pitch: 55, duration: 2600, essential: true });
    });

    return () => {
      clearInterval(spin);
      clearInterval(pulser);
      if (crowdTimerRef.current) clearInterval(crowdTimerRef.current);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // layer visibility + selection filters react to store changes
  useEffect(() => {
    layersRef.current = layers;
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const vis = (layer: string, on?: boolean) =>
      on !== undefined &&
      map.getLayer(layer) &&
      map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
    try {
      vis("risk-fill", layers.risk);
      vis("risk-l4-pulse", layers.risk);
      if (map.getLayer("hillshade")) {
        map.setLayoutProperty("hillshade", "visibility", layers.terrain === false ? "none" : "visible");
      }
      vis("susceptibility-fill", layers.susceptibility);
      vis("roads-line", layers.roads);
      vis("reports-circles", layers.reports);
      vis("shelters-points", layers.shelters);
      vis("shelters-labels", layers.shelters);
      vis("detour-lines", layers.detours);
      vis("detour-labels", layers.detours);
      vis("blockages-points", layers.detours);
      vis("blockages-labels", layers.detours);
      vis("machinery-points", layers.detours);
      vis("machinery-labels", layers.detours);
      vis("radar-cells-fill", layers.rainfall);
      vis("radar-cells-outline", layers.rainfall);
      vis("ble-crowd-glow", layers.crowd);
      vis("ble-crowd-core", layers.crowd);
      vis("population-heat-circles", layers.population);
      if (selectedZoneId) {
        map.setFilter("zone-selected-outline", ["==", ["get", "zone_id"], selectedZoneId]);
      } else {
        map.setFilter("zone-selected-outline", ["==", ["get", "zone_id"], "__none__"]);
      }
    } catch {
      /* layers not ready */
    }
  }, [layers, selectedZoneId]);

  const radarStep = useAppStore((s) => s.radarStep);

  // Dynamic Precipitation Radar Time-Lapse Storm Cell Animation
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("radar_cells") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const mults = [0.3, 0.4, 0.55, 0.7, 0.85, 0.95, 1.0, 1.15, 1.3, 1.45, 1.2, 0.8];
    const m = mults[radarStep] ?? 1.0;
    const dx = (radarStep - 6) * 0.012;
    const dy = (radarStep - 6) * 0.008;

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { intensity_mm_h: Math.round(62.0 * m * 10) / 10, name: "Sohra Cloudburst Cell" },
          geometry: {
            type: "Polygon",
            coordinates: [[[91.60 + dx, 25.20 + dy], [91.85 + dx, 25.20 + dy], [91.85 + dx, 25.35 + dy], [91.60 + dx, 25.35 + dy], [91.60 + dx, 25.20 + dy]]],
          },
        },
        {
          type: "Feature",
          properties: { intensity_mm_h: Math.round(48.0 * m * 10) / 10, name: "Tupul Convective Band" },
          geometry: {
            type: "Polygon",
            coordinates: [[[93.58 + dx, 24.72 + dy], [93.78 + dx, 24.72 + dy], [93.78 + dx, 24.90 + dy], [93.58 + dx, 24.90 + dy], [93.58 + dx, 24.72 + dy]]],
          },
        },
        {
          type: "Feature",
          properties: { intensity_mm_h: Math.round(36.0 * m * 10) / 10, name: "Aizawl Ridge Downpour" },
          geometry: {
            type: "Polygon",
            coordinates: [[[92.65 + dx, 23.68 + dy], [92.80 + dx, 23.68 + dy], [92.80 + dx, 23.85 + dy], [92.65 + dx, 23.85 + dy], [92.65 + dx, 23.68 + dy]]],
          },
        },
        {
          type: "Feature",
          properties: { intensity_mm_h: Math.round(42.0 * m * 10) / 10, name: "Kohima-Zubza Cell" },
          geometry: {
            type: "Polygon",
            coordinates: [[[94.00 + dx, 25.60 + dy], [94.18 + dx, 25.60 + dy], [94.18 + dx, 25.75 + dy], [94.00 + dx, 25.75 + dy], [94.00 + dx, 25.60 + dy]]],
          },
        },
      ],
    });
  }, [radarStep]);

  return <div ref={container} className="absolute inset-0" />;
}
