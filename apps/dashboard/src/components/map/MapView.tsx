"use client";
// MapLibre v6 command map — hex risk layer (click → dossier), roads,
// citizen reports, rainfall radar sweep, forecast-horizon repaint, demo
// storm inject/reset.
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

const emptyStyle: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0A0F0C" } }],
};

const RAIN_CELLS_BASE = [
  { intensity: 62.0, name: "Sohra Cloudburst Cell", coords: [[[91.60, 25.20], [91.85, 25.20], [91.85, 25.35], [91.60, 25.35], [91.60, 25.20]]] as [number, number][][] },
  { intensity: 48.0, name: "Tupul Convective Band", coords: [[[93.58, 24.72], [93.78, 24.72], [93.78, 24.90], [93.58, 24.90], [93.58, 24.72]]] as [number, number][][] },
  { intensity: 36.0, name: "Aizawl Ridge Downpour", coords: [[[92.65, 23.68], [92.80, 23.68], [92.80, 23.85], [92.65, 23.85], [92.65, 23.68]]] as [number, number][][] },
  { intensity: 42.0, name: "Kohima-Zubza Cell", coords: [[[94.00, 25.60], [94.18, 25.60], [94.18, 25.75], [94.00, 25.75], [94.00, 25.60]]] as [number, number][][] },
];

export default function MapView({ onInjectResult }: { onInjectResult?: (n: number) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const { selectedZoneId, selectZone, districtFilter, horizon, radarStep, layers, role, token } = useAppStore();
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

    map.on("load", () => {
      // --- GeoJSON sources served by the in-app API
      for (const src of ["zones", "roads", "report_points"]) {
        map.addSource(src, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      map.addSource("radar_cells", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: RAIN_CELLS_BASE.map((c) => ({
            type: "Feature",
            properties: { intensity_mm_h: c.intensity, name: c.name },
            geometry: { type: "Polygon", coordinates: c.coords },
          })),
        },
      });

      // --- zones: fused hazard hex fill
      map.addLayer({
        id: "zones-fill", type: "fill", source: "zones",
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "hazard_level"],
            0, "#0B3A2A", 1, "#1E6B3C", 2, "#9A7B18", 3, "#C25615", 4, "#C21F1F",
          ],
          "fill-opacity": 0.62,
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
      // radar cells (above fills, translucent)
      map.addLayer({
        id: "radar-cells-fill", type: "fill", source: "radar_cells",
        paint: {
          "fill-color": [
            "interpolate", ["linear"], ["get", "intensity_mm_h"],
            5, "rgba(14,116,144,0.25)", 20, "rgba(8,145,178,0.55)",
            40, "rgba(245,158,11,0.65)", 60, "rgba(239,68,68,0.75)",
          ],
        },
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
        paint: {
          "line-color": "#06B6D4",
          "line-width": 1.4,
          "line-dasharray": [2, 2],
        },
      });
      map.addLayer({
        id: "zones-selected", type: "line", source: "zones",
        filter: ["==", ["get", "zone_id"], ""],
        paint: { "line-color": "#FFFFFF", "line-width": 2.6 },
      });
      // roads
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
      // citizen report points
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

      // --- click → select zone (opens DossierDrawer)
      map.on("click", "zones-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const zid = f.properties?.zone_id as string | undefined;
        if (zid) selectZone(zid);
      });
      map.on("mouseenter", "zones-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "zones-fill", () => {
        map.getCanvas().style.cursor = "";
      });
      // --- hover popup
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

      // sources + layers now exist — allow the data effect to (re)run.
      setMapReady(true);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [selectZone]);

  // ---------------------------------------------------------------- data
  useEffect(() => {
    const set = (id: string, url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((fc) => {
          const m = mapRef.current;
          const s = m?.getSource(id) as GeoJSONSource | undefined;
          if (s && fc) s.setData(fc);
        })
        .catch(() => { /* offline-safe */ });
    const p = new URLSearchParams();
    if (districtFilter) p.set("district", districtFilter);
    if (horizon) p.set("horizon", String(horizon));
    const qs = p.toString();
    const B = endpoints.API;
    set("zones", `${B}/api/v1/geo/zones${qs ? `?${qs}` : ""}`);
    set("roads", `${B}/api/v1/geo/roads`);
    set("report_points", `${B}/api/v1/geo/reports`);
  }, [districtFilter, horizon, stormActive, mapReady]);

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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("radar_cells")) return;
    const source = map.getSource("radar_cells") as GeoJSONSource;
    const mults = [0.3, 0.4, 0.55, 0.7, 0.85, 0.95, 1.0, 1.15, 1.3, 1.45, 1.2, 0.8];
    const m = mults[radarStep] ?? 1.0;
    const dx = (radarStep - 6) * 0.012;
    const dy = (radarStep - 6) * 0.008;
    const features: GeoJSON.Feature[] = RAIN_CELLS_BASE.map((c) => ({
      type: "Feature",
      properties: {
        intensity_mm_h: Math.round(c.intensity * m * 10) / 10,
        name: c.name,
      },
      geometry: {
        type: "Polygon",
        // wrap the shifted ring in an outer array: Polygon coordinates are
        // Position[][] (array of rings), not a bare ring
        coordinates: [c.coords[0].map(([x, y]) => [x + dx, y + dy] as [number, number])],
      },
    }));
    source.setData({ type: "FeatureCollection", features });
  }, [radarStep]);

  // ---------------------------------------------------------------- layers visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const vis = (id: string, on: boolean) =>
      map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("susceptibility-fill", layers.susceptibility);
    vis("zones-fill", layers.hazard && !layers.susceptibility);
    vis("radar-cells-fill", layers.radar);
    vis("creep-outline", layers.creep);
    vis("population-fill", layers.population);
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
