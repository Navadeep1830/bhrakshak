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

const CARTO_TILES = ["a", "b", "c", "d"].map(
  (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`
);

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

      // expose flyTo for the rail
      (window as unknown as { __flyTo?: (c: number[], z: number) => void }).__flyTo = (
        c: number[],
        z: number
      ) => map.flyTo({ center: c as [number, number], zoom: z, pitch: 55, duration: 2600, essential: true });
    });

    return () => {
      clearInterval(spin);
      clearInterval(pulser);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // layer visibility + selection filters react to store changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const vis = (layer: string, on?: boolean) =>
      on !== undefined &&
      map.getLayer(layer) &&
      map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
    try {
      vis("risk-fill", layers.risk);
      vis("risk-l4-pulse", layers.risk);
      vis("susceptibility-fill", layers.susceptibility);
      vis("roads-line", layers.roads);
      vis("reports-circles", layers.reports);
      if (selectedZoneId) {
        map.setFilter("zone-selected-outline", ["==", ["get", "zone_id"], selectedZoneId]);
      } else {
        map.setFilter("zone-selected-outline", ["==", ["get", "zone_id"], "__none__"]);
      }
    } catch {
      /* layers not ready */
    }
  }, [layers, selectedZoneId]);

  return <div ref={container} className="absolute inset-0" />;
}
