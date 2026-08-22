"use client";

import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { endpoints } from "@/lib/api";
import { LEVEL_COLORS } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";

const emptyStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0B1220" } }],
};

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const selectZone = useAppStore((s) => s.selectZone);
  const layers = useAppStore((s) => s.layers);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: emptyStyle,
      center: [92.7, 24.4],
      zoom: 5.4,
      pitch: 60,
      bearing: -18,
      antialias: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    let bearing = -18;
    const spin = setInterval(() => {
      bearing += 0.15;
      if (map.getPitch() > 30 && !map.isMoving()) map.setBearing(bearing);
    }, 80);

    map.on("error", (e) => console.error("[maplibre]", e?.error ?? e));

    map.on("load", () => {
      // Martin vector tiles straight from PostGIS
      for (const src of ["risk_cells", "zones", "road_status"]) {
        map.addSource(src, {
          type: "vector",
          tiles: [`${endpoints.MARTIN}/${src}/{z}/{x}/{y}`],
          maxzoom: 14,
        });
      }

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
          "fill-opacity": ["case", [">=", ["get", "hazard_level"], 2], 0.55, 0.25],
        },
      });

      map.addLayer({
        id: "zone-outline",
        type: "line",
        source: "zones",
        "source-layer": "zones",
        paint: { "line-color": "#334155", "line-width": 0.8 },
      });

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
          "line-width": 2.4,
        },
      });

      map.on("click", "risk-fill", (e) => {
        const f = e.features?.[0];
        if (f?.properties?.zone_id) selectZone(String(f.properties.zone_id));
      });
      map.on("mousemove", "risk-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "risk-fill", () => (map.getCanvas().style.cursor = ""));
    });

    return () => {
      clearInterval(spin);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const visibility = (layerId: string, on: boolean) =>
      map.setLayoutProperty(layerId, "visibility", on ? "visible" : "none");
    try {
      visibility("risk-fill", layersRef.current.risk);
      visibility("zone-outline", layersRef.current.susceptibility || true);
      visibility("roads-line", layersRef.current.roads);
    } catch {
      /* layer not ready */
    }
  }, [layers]);

  return <div ref={container} className="absolute inset-0" />;
}
