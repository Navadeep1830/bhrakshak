'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Map as MlMap, NavigationControl, ScaleControl, Marker, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Paper, ToggleButton, ToggleButtonGroup, Tooltip as MuiTooltip, Chip, Stack, Typography } from '@mui/material';
import LayersIcon from '@mui/icons-material/Layers';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import TerrainIcon from '@mui/icons-material/Terrain';
import MapIcon from '@mui/icons-material/Map';
import ThreeSixtyIcon from '@mui/icons-material/ThreeSixty';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { BASE_STYLES, BASE_STYLE_META, BaseStyleKey, DISTRICT_CENTERS } from './map-styles';

// MapLibre v6 resolves its worker script relative to the bundled chunk URL, which 404s
// under Next.js dev/turbopack — every GeoJSON/vector layer then silently never renders.
// Serve the dist worker assets from /public and point MapLibre at them.
if (typeof window !== 'undefined') setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

export interface ZoneFeature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  properties: {
    zoneCode: string;
    name: string;
    district: string;
    state: string;
    hazardLevel: number;
    probability: number;
    suscMean: number;
    suscP90: number;
    population: number;
    roadKm: number;
    centroidLat: number;
    centroidLon: number;
    rain1h: number;
    rain24h: number;
    soilMoisture: number | null;
    floodLevel: number;
    isolation: number;
    modelVersion: string;
    topDriver?: { name: string; sharePct: number } | null;
  };
}

export interface RoadRow {
  id: string;
  roadName: string;
  district: string;
  coords: [number, number][];
  status: string;
  source: string;
  note: string | null;
  detour?: {
    available: boolean;
    reason: string;
    polyline: [number, number][];
    extraKm: number;
    delayMinutes: number;
    clearanceEtaHours: number;
    corridorHazard: number;
    blockageAt: [number, number] | null;
  } | null;
}

export interface ShelterRow {
  id: string;
  name: string;
  district: string;
  lat: number;
  lon: number;
  shelterType: string;
  capacity: number;
  occupancy: number;
  hasMedical: boolean;
}

export interface ReportPin {
  id: string;
  category: string;
  status: string;
  lat: number;
  lon: number;
}

export interface EvacRoute {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number; name: string };
  route: [number, number][];
  etaMinutes: number;
  routeLengthKm: number;
}

const LEVEL_COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#b91c1c'];

/** shrink hex ring toward its centroid → visible seams between hexagons */
function shrinkRing(ring: [number, number][], f = 0.93): [number, number][] {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return ring.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f] as [number, number]);
}

const emptyGeo = (): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: [],
});

const zonesFeatureCollection = (zones: ZoneFeature[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: zones.map((z) => ({
    ...z,
    geometry: {
      type: 'Polygon',
      coordinates: [shrinkRing(z.geometry.coordinates[0] as [number, number][])],
    },
  })),
});

interface MapViewProps {
  zones: ZoneFeature[];
  roads: RoadRow[];
  shelters: ShelterRow[];
  reportPins: ReportPin[];
  evacRoute: EvacRoute | null;
  selectedZone: string | null;
  originMode: boolean;
  onZoneSelect: (zoneCode: string | null) => void;
  onMapClick: (lat: number, lon: number) => void;
  flyTo: { center: [number, number]; zoom: number; key: number } | null;
}

export default function MapView({
  zones,
  roads,
  shelters,
  reportPins,
  evacRoute,
  selectedZone,
  originMode,
  onZoneSelect,
  onMapClick,
  flyTo,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [styleKey, setStyleKey] = useState<BaseStyleKey>('satellite');
  const [is3d, setIs3d] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });
  const stateRef = useRef({ originMode, onZoneSelect, onMapClick, selectedZone, is3d, styleKey });
  const dataRef = useRef({ zones, roads, shelters, reportPins, evacRoute });

  // keep latest props/data in refs for map event handlers (after commit, not during render)
  useEffect(() => {
    stateRef.current = { originMode, onZoneSelect, onMapClick, selectedZone, is3d, styleKey };
    dataRef.current = { zones, roads, shelters, reportPins, evacRoute };
  });

  // track container size for tooltip clamping (avoids ref access during render)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  const safeSetData = useCallback((sourceId: string, fc: GeoJSON.FeatureCollection) => {
    const map = mapRef.current;
    if (!map) return;
    try {
      const src = map.getSource(sourceId) as GeoJSONSource | undefined;
      if (src && map.isStyleLoaded()) src.setData(fc);
      else if (src) {
        // style still loading — retry once it goes idle
        map.once('idle', () => {
          try { src.setData(fc); } catch { /* noop */ }
        });
      }
    } catch { /* noop */ }
  }, []);

  const addDataLayers = useCallback((map: MlMap) => {
    // ---- zone hexagons -----------------------------------------------------
    if (!map.getSource('zones')) {
      map.addSource('zones', { type: 'geojson', data: zonesFeatureCollection(dataRef.current.zones) });
      map.addLayer({
        id: 'zones-3d',
        type: 'fill-extrusion',
        source: 'zones',
        minzoom: 6,
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'hazardLevel'],
            0, LEVEL_COLORS[0], 1, LEVEL_COLORS[1], 2, LEVEL_COLORS[2], 3, LEVEL_COLORS[3], 4, LEVEL_COLORS[4],
          ],
          'fill-extrusion-height': [
            'interpolate', ['linear'], ['zoom'], 7, 0, 9,
            ['interpolate', ['linear'], ['get', 'hazardLevel'],
              0, 60, 1, 240, 2, 620, 3, 1050, 4, 1600],
          ],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.78,
        },
      });
      map.addLayer({
        id: 'zones-outline',
        type: 'line',
        source: 'zones',
        minzoom: 7.5,
        paint: {
          'line-color': ['case', ['>=', ['get', 'hazardLevel'], 2], '#ffffff', '#94a3b8'],
          'line-width': ['case', ['>=', ['get', 'hazardLevel'], 2], 1.4, 0.5],
          'line-opacity': ['case', ['>=', ['get', 'hazardLevel'], 2], 0.9, 0.35],
        },
      });
      map.addLayer({
        id: 'zones-selected',
        type: 'line',
        source: 'zones',
        filter: ['==', ['get', 'zoneCode'], '___none___'],
        paint: { 'line-color': '#ffffff', 'line-width': 3 },
      });
    }

    // ---- roads --------------------------------------------------------------
    if (!map.getSource('roads')) {
      map.addSource('roads', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: dataRef.current.roads.map((r) => ({
            type: 'Feature' as const,
            id: r.id,
            geometry: { type: 'LineString', coordinates: r.coords },
            properties: { roadName: r.roadName, status: r.status },
          })),
        },
      });
      map.addLayer({
        id: 'roads-line',
        type: 'line',
        source: 'roads',
        paint: {
          'line-color': [
            'match', ['get', 'status'], 'open', '#34d399', 'watch', '#eab308', 'blocked', '#ef4444', '#64748b',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 10, 4.5],
        },
      });
    }

    // ---- alternative routes (detours) + blockage points ----------------------
    if (!map.getSource('detours')) {
      const detourFeatures: GeoJSON.Feature[] = [];
      const blockageFeatures: GeoJSON.Feature[] = [];
      for (const r of dataRef.current.roads) {
        if (!r.detour?.available || r.detour.polyline.length < 2) continue;
        detourFeatures.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: r.detour.polyline },
          properties: {
            roadName: r.roadName,
            delayMinutes: r.detour.delayMinutes,
            extraKm: r.detour.extraKm,
            clearanceEtaHours: r.detour.clearanceEtaHours,
            corridorHazard: r.detour.corridorHazard,
            reason: r.detour.reason,
          },
        });
        if (r.detour.blockageAt) {
          blockageFeatures.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: r.detour.blockageAt },
            properties: {
              roadName: r.roadName,
              status: r.status,
              clearanceEtaHours: r.detour.clearanceEtaHours,
              corridorHazard: r.detour.corridorHazard,
            },
          });
        }
      }
      map.addSource('detours', { type: 'geojson', data: { type: 'FeatureCollection', features: detourFeatures } });
      map.addSource('blockages', { type: 'geojson', data: { type: 'FeatureCollection', features: blockageFeatures } });

      map.addLayer({
        id: 'detour-casing',
        type: 'line',
        source: 'detours',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#082f49', 'line-width': 8, 'line-opacity': 0.75 },
      });
      map.addLayer({
        id: 'detour-line',
        type: 'line',
        source: 'detours',
        minzoom: 5.5,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38bdf8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2, 10, 4],
          'line-dasharray': [2.2, 1.6],
        },
      });
      map.addLayer({
        id: 'detour-label',
        type: 'symbol',
        source: 'detours',
        minzoom: 7,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['concat', ['get', 'roadName'], ' ALTERNATE  +', ['to-string', ['get', 'delayMinutes']], ' min'],
          'text-size': 10,
          'text-font': ['Open Sans Bold', 'Noto Sans Bold'],
          'symbol-spacing': 220,
        },
        paint: {
          'text-color': '#7dd3fc',
          'text-halo-color': '#04121f',
          'text-halo-width': 1.6,
        },
      });
      map.addLayer({
        id: 'blockage-pin',
        type: 'circle',
        source: 'blockages',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 11, 10],
          'circle-color': ['match', ['get', 'status'], 'blocked', '#ef4444', '#f97316'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.2,
        },
      });
      map.addLayer({
        id: 'blockage-label',
        type: 'symbol',
        source: 'blockages',
        minzoom: 6.5,
        layout: {
          'text-field': [
            'concat',
            ['match', ['get', 'status'], 'blocked', 'X ', '! '],
            ['get', 'roadName'],
            ' — ',
            ['to-string', ['get', 'clearanceEtaHours']],
            'h clearance',
          ],
          'text-size': 10.5,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-font': ['Open Sans Bold', 'Noto Sans Bold'],
        },
        paint: {
          'text-color': ['match', ['get', 'status'], 'blocked', '#fca5a5', '#fdba74'] as any,
          'text-halo-color': '#1a0505',
          'text-halo-width': 1.8,
        },
      });
    }

    // ---- shelters ------------------------------------------------------------
    if (!map.getSource('shelters')) {
      map.addSource('shelters', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: dataRef.current.shelters.map((s) => ({
            type: 'Feature' as const,
            id: s.id,
            geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
            properties: {
              name: s.name, district: s.district, capacity: s.capacity,
              hasMedical: s.hasMedical ? 'true' : 'false',
            },
          })),
        },
      });
      map.addLayer({
        id: 'shelter-pin',
        type: 'circle',
        source: 'shelters',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 11, 9],
          'circle-color': '#ffffff',
          'circle-stroke-color': '#10b981',
          'circle-stroke-width': 2.5,
        },
      });
    }

    // ---- citizen reports -----------------------------------------------------
    if (!map.getSource('reports')) {
      map.addSource('reports', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: dataRef.current.reportPins.map((r) => ({
            type: 'Feature' as const,
            id: r.id,
            geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
            properties: { category: r.category, status: r.status },
          })),
        },
      });
      map.addLayer({
        id: 'report-pin',
        type: 'circle',
        source: 'reports',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 11, 6],
          'circle-color': ['match', ['get', 'status'], 'verified', '#f97316', 'pending', '#eab308', '#64748b'],
          'circle-stroke-color': '#0b1120',
          'circle-stroke-width': 1,
        },
      });
    }

    // ---- evacuation route ------------------------------------------------------
    if (!map.getSource('evac')) {
      map.addSource('evac', {
        type: 'geojson',
        data: dataRef.current.evacRoute
          ? {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: { type: 'LineString', coordinates: dataRef.current.evacRoute.route },
                  properties: {},
                },
              ],
            }
          : emptyGeo(),
      });
      map.addLayer({
        id: 'evac-route-casing',
        type: 'line',
        source: 'evac',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#052e16', 'line-width': 9, 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'evac-route-line',
        type: 'line',
        source: 'evac',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#4ade80', 'line-width': 4.5, 'line-opacity': 0.95 },
      });
    }

    // ---- interactions -----------------------------------------------------------
    // hover + click on hexagons
    map.on('mousemove', 'zones-3d', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as any;
      map.getCanvas().style.cursor = 'pointer';
      setHover({
        x: e.point.x,
        y: e.point.y,
        text: `${p.zoneCode} · ${p.district}\nL${p.hazardLevel} hazard · ${p.rain24h?.toFixed?.(0) ?? 0}mm/24h · susc ${Math.round(p.suscMean)}/100`,
      });
    });
    map.on('mouseleave', 'zones-3d', () => {
      map.getCanvas().style.cursor = '';
      setHover(null);
    });
    map.on('click', 'zones-3d', (e) => {
      const f = e.features?.[0];
      if (f) stateRef.current.onZoneSelect((f.properties as any).zoneCode);
    });

    map.on('mousemove', 'roads-line', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as any;
      setHover({ x: e.point.x, y: e.point.y, text: `${p.roadName} — ${p.status}` });
    });
    map.on('mouseleave', 'roads-line', () => setHover(null));

    map.on('mousemove', 'detour-line', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as any;
      setHover({
        x: e.point.x,
        y: e.point.y,
        text: `ALTERNATE ROUTE — ${p.roadName}\n+${p.delayMinutes} min · ${p.extraKm} km extra · clearance ~${p.clearanceEtaHours} h\n${p.reason}`,
      });
    });
    map.on('mouseleave', 'detour-line', () => setHover(null));

    map.on('mousemove', 'blockage-pin', (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as any;
      setHover({
        x: e.point.x,
        y: e.point.y,
        text: `${p.status === 'blocked' ? 'BLOCKED' : 'AT RISK'} — ${p.roadName}\nCorridor hazard L${p.corridorHazard} · clearance ETA ${p.clearanceEtaHours} h`,
      });
    });
    map.on('mouseleave', 'blockage-pin', () => setHover(null));

    map.on('click', 'shelter-pin', (e) => {
      const f = e.features?.[0];
      const p = f?.properties as any;
      if (p) setHover({ x: e.point!.x, y: e.point!.y, text: `SHELTER · ${p.name}\n${p.district} · cap ${p.capacity} · ${p.hasMedical ? 'medical' : 'no medical'}` });
    });

    map.on('click', (e) => {
      if (stateRef.current.originMode) {
        stateRef.current.onMapClick(e.lngLat.lat, e.lngLat.lng);
      }
    });
  }, []);

  // ---- map init -------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MlMap({
      container: containerRef.current,
      style: BASE_STYLES.satellite,
      center: [91.65, 25.35],
      zoom: 8.3,
      pitch: 55,
      bearing: -18,
      maxPitch: 85,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-left');
    map.addControl(new ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');

    map.on('style.load', () => {
      addDataLayers(map);
      try {
        const src = (map as any).getStyle().sources;
        if (src?.terrainSource) {
          if (stateRef.current.is3d && stateRef.current.styleKey !== 'street') map.setTerrain({ source: 'terrainSource', exaggeration: 1.25 });
        }
      } catch { /* noop */ }
      setMapReady(true);
    });
    map.on('error', (e) => {
      // tolerate individual tile failures (raster providers rate-limit)
      if ((e as any)?.error?.message?.includes('tiles')) return;
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- style switch ----------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if ((map as any).getStyle()?.name === BASE_STYLES[styleKey].name) return;
    try {
      map.setStyle(BASE_STYLES[styleKey], { diff: false });
    } catch { /* noop */ }
  }, [styleKey]);

  // ---- 3D toggle ---------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!map.isStyleLoaded()) return; // style.load will re-apply terrain when ready
    try {
      const hasTerrain = !!(map as any).getSource?.('terrainSource');
      if (is3d && styleKey !== 'street' && hasTerrain) {
        map.setTerrain({ source: 'terrainSource', exaggeration: 1.25 });
      } else {
        map.setTerrain(null);
      }
    } catch { /* noop */ }
  }, [is3d, styleKey, mapReady]);

  // ---- data updates --------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    safeSetData('zones', zonesFeatureCollection(zones));
  }, [zones, mapReady, safeSetData]);

  // roads + detours + blockages refresh together (detours derive from road rows)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    safeSetData('roads', {
      type: 'FeatureCollection',
      features: roads.map((r) => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: { type: 'LineString', coordinates: r.coords },
        properties: { roadName: r.roadName, status: r.status },
      })),
    });
    const detourFeatures: GeoJSON.Feature[] = [];
    const blockageFeatures: GeoJSON.Feature[] = [];
    for (const r of roads) {
      if (!r.detour?.available || r.detour.polyline.length < 2) continue;
      detourFeatures.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: r.detour.polyline },
        properties: {
          roadName: r.roadName,
          delayMinutes: r.detour.delayMinutes,
          extraKm: r.detour.extraKm,
          clearanceEtaHours: r.detour.clearanceEtaHours,
          corridorHazard: r.detour.corridorHazard,
          reason: r.detour.reason,
        },
      });
      if (r.detour.blockageAt) {
        blockageFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: r.detour.blockageAt },
          properties: {
            roadName: r.roadName,
            status: r.status,
            clearanceEtaHours: r.detour.clearanceEtaHours,
            corridorHazard: r.detour.corridorHazard,
          },
        });
      }
    }
    safeSetData('detours', { type: 'FeatureCollection', features: detourFeatures });
    safeSetData('blockages', { type: 'FeatureCollection', features: blockageFeatures });
  }, [roads, mapReady, safeSetData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    safeSetData('shelters', {
      type: 'FeatureCollection',
      features: shelters.map((s) => ({
        type: 'Feature' as const,
        id: s.id,
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: {
          name: s.name, district: s.district, capacity: s.capacity,
          hasMedical: s.hasMedical ? 'true' : 'false',
        },
      })),
    });
  }, [shelters, mapReady, safeSetData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    safeSetData('reports', {
      type: 'FeatureCollection',
      features: reportPins.map((r) => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
        properties: { category: r.category, status: r.status },
      })),
    });
  }, [reportPins, mapReady, safeSetData]);

  // ---- flatten 3-D towers while an evacuation route is shown -----------------
  // (pitched extrusions otherwise occlude the ground-level route polyline)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.isStyleLoaded()) return;
    try {
      if (map.getLayer('zones-3d')) {
        map.setPaintProperty('zones-3d', 'fill-extrusion-height', [
          'interpolate', ['linear'], ['zoom'], 7, 0, 9,
          ['interpolate', ['linear'], ['get', 'hazardLevel'],
            0, 60, 1, 240, 2, 620, 3, 1050, 4, 1600],
        ] as any, { validate: false });
      }
      if (map.getLayer('evac-route-line')) {
        map.setPaintProperty('evac-route-line', 'line-width', 4.5);
      }
      if (map.getLayer('evac-route-casing')) {
        map.setPaintProperty('evac-route-casing', 'line-width', 9);
      }
      if (evacRoute && map.getLayer('zones-3d')) {
        // squash to 12% height + drop opacity so the pathway stays readable
        map.setPaintProperty('zones-3d', 'fill-extrusion-height', [
          'interpolate', ['linear'], ['zoom'], 7, 0, 9,
          ['interpolate', ['linear'], ['get', 'hazardLevel'],
            0, 12, 1, 30, 2, 75, 3, 126, 4, 192],
        ] as any, { validate: false });
        map.setPaintProperty('zones-3d', 'fill-extrusion-opacity', 0.62);
        if (map.getLayer('evac-route-line')) map.setPaintProperty('evac-route-line', 'line-width', 6.5);
        if (map.getLayer('evac-route-casing')) map.setPaintProperty('evac-route-casing', 'line-width', 12);
      } else if (map.getLayer('zones-3d')) {
        map.setPaintProperty('zones-3d', 'fill-extrusion-opacity', 0.78);
      }
    } catch { /* noop */ }
  }, [evacRoute, mapReady]);

  // ---- evacuation route + markers ---------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    if (evacRoute) {
      safeSetData('evac', {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: evacRoute.route },
            properties: {},
          },
        ],
      });
      const originEl = document.createElement('div');
      originEl.style.cssText =
        'width:18px;height:18px;border-radius:50%;background:#f59e0b;border:3px solid #fff;box-shadow:0 0 0 4px rgba(245,158,11,.35);cursor:pointer;';
      markersRef.current.push(
        new Marker({ element: originEl }).setLngLat([evacRoute.origin.lon, evacRoute.origin.lat]).addTo(map)
      );
      const destEl = document.createElement('div');
      destEl.style.cssText =
        'width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#10b981;border:3px solid #fff;box-shadow:0 0 0 4px rgba(16,185,129,.35);';
      markersRef.current.push(
        new Marker({ element: destEl }).setLngLat([evacRoute.destination.lon, evacRoute.destination.lat]).addTo(map)
      );
      const bounds = evacRoute.route.reduce(
        (b, c) => b.extend(c as [number, number]),
        new LngLatBounds(evacRoute.route[0] as [number, number], evacRoute.route[0] as [number, number])
      );
      map.fitBounds(bounds, { padding: { top: 240, bottom: 240, left: 140, right: 140 }, maxZoom: 11.5, duration: 1600, essential: true });
    } else {
      safeSetData('evac', emptyGeo());
    }
  }, [evacRoute, mapReady, safeSetData]);

  // ---- selected zone filter ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getLayer('zones-selected')) {
      map.setFilter('zones-selected', ['==', ['get', 'zoneCode'], selectedZone ?? '___none___']);
    }
    if (selectedZone) {
      const z = zones.find((f) => f.properties.zoneCode === selectedZone);
      if (z) {
        map.flyTo({ center: [z.properties.centroidLon, z.properties.centroidLat], zoom: Math.max(map.getZoom(), 10.5), duration: 1200 });
      }
    }
  }, [selectedZone]);

  // ---- flyTo -------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: flyTo.center, zoom: flyTo.zoom, pitch: 52, duration: 1800, essential: true });
  }, [flyTo]);

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: '12px' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* style switcher + 3D toggle */}
      <Paper
        sx={{
          position: 'absolute', top: 10, right: 10, zIndex: 5, p: 0.75, display: 'flex', gap: 0.75,
          alignItems: 'center', bgcolor: 'rgba(14,21,34,.88)', backdropFilter: 'blur(8px)',
        }}
        elevation={0}
      >
        <ToggleButtonGroup
          size="small"
          exclusive
          value={styleKey}
          onChange={(_, v) => v && setStyleKey(v as BaseStyleKey)}
        >
          <ToggleButton value="satellite" aria-label="Satellite" sx={{ px: 1.25, py: 0.5 }}>
            <MuiTooltip title={BASE_STYLE_META.satellite.hint}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <SatelliteAltIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontWeight: 600 }}>Sat</Typography>
              </Stack>
            </MuiTooltip>
          </ToggleButton>
          <ToggleButton value="terrain" aria-label="Terrain" sx={{ px: 1.25, py: 0.5 }}>
            <MuiTooltip title={BASE_STYLE_META.terrain.hint}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <TerrainIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontWeight: 600 }}>Terrain</Typography>
              </Stack>
            </MuiTooltip>
          </ToggleButton>
          <ToggleButton value="street" aria-label="Street" sx={{ px: 1.25, py: 0.5 }}>
            <MuiTooltip title={BASE_STYLE_META.street.hint}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <MapIcon sx={{ fontSize: 16 }} />
                <Typography variant="caption" sx={{ fontWeight: 600 }}>Street</Typography>
              </Stack>
            </MuiTooltip>
          </ToggleButton>
        </ToggleButtonGroup>
        <ToggleButton
          size="small"
          value="3d"
          aria-label="Toggle 3D terrain"
          selected={is3d && styleKey !== 'street'}
          onChange={() => setIs3d((v) => !v)}
          sx={{ px: 1.25, py: 0.5 }}
        >
          <MuiTooltip title="Toggle 3-D terrain (pitch & rotate with compass)">
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <ThreeSixtyIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>3D</Typography>
            </Stack>
          </MuiTooltip>
        </ToggleButton>
      </Paper>

      {/* hover tooltip */}
      {hover && (
        <Paper
          sx={{
            position: 'absolute', left: Math.min(hover.x + 16, containerSize.w - 260),
            top: Math.min(hover.y + 12, containerSize.h - 90),
            zIndex: 6, px: 1.5, py: 1, bgcolor: 'rgba(7,12,20,.92)', border: '1px solid rgba(148,163,184,.3)',
            pointerEvents: 'none', maxWidth: 260,
          }}
          elevation={0}
        >
          {hover.text.split('\n').map((line, i) => (
            <Typography key={i} variant="caption" sx={{ display: 'block', mt: 0.5, color: i === 0 ? '#e2e8f0' : '#94a3b8', fontWeight: i === 0 ? 700 : 500, whiteSpace: 'pre-line' }}>
              {line}
            </Typography>
          ))}
        </Paper>
      )}

      {/* origin mode hint */}
      {originMode && (
        <Paper
          sx={{
            position: 'absolute', top: 64, right: 10, zIndex: 6, px: 1.5, py: 1,
            bgcolor: 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.5)', maxWidth: 230,
          }}
          elevation={0}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <MyLocationIcon sx={{ fontSize: 18, color: 'warning.main' }} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Click anywhere on the map to set the evacuation origin — the engine will route to the safest shelter.
            </Typography>
          </Stack>
        </Paper>
      )}

      {/* legend */}
      <Paper
        sx={{
          position: 'absolute', bottom: 12, left: 52, zIndex: 5, px: 1.5, py: 1.25,
          bgcolor: 'rgba(14,21,34,.88)', backdropFilter: 'blur(8px)', maxWidth: 285,
        }}
        elevation={0}
      >
        <Stack direction="row" spacing={1} sx={{ mb: 0.75, alignItems: 'center' }}>
          <LayersIcon sx={{ fontSize: 15, color: 'primary.main' }} />
          <Typography variant="overline" sx={{ lineHeight: 1, fontWeight: 700, letterSpacing: '.08em' }}>
            Response Zones (~5 km hexes)
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          {['L0 Normal', 'L1 Watch', 'L2 Alert', 'L3 Warning', 'L4 Emergency'].map((label, i) => (
            <Chip
              key={label}
              size="small"
              label={label}
              sx={{
                height: 20, fontSize: 10, fontWeight: 700,
                bgcolor: `${LEVEL_COLORS[i]}22`, color: LEVEL_COLORS[i],
                border: `1px solid ${LEVEL_COLORS[i]}66`,
              }}
            />
          ))}
        </Stack>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.5 }}>
          <Chip size="small" label="- - Alternate route (detour)" sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(56,189,248,.14)', color: '#38bdf8', border: '1px solid rgba(56,189,248,.4)' }} />
          <Chip size="small" label="• Shelter / relief camp" sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(16,185,129,.14)', color: '#10b981', border: '1px solid rgba(16,185,129,.4)' }} />
          <Chip size="small" label="• ML-predicted blockage" sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: 'rgba(239,68,68,.14)', color: '#ef4444', border: '1px solid rgba(239,68,68,.4)' }} />
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary', lineHeight: 1.35 }}>
          Color = live hazard level · tower height = escalation · each hex ≈ 5 km zone · dashed cyan = ML-suggested bypass around blocked corridors
        </Typography>
      </Paper>

      {/* cursor crosshair in origin mode */}
      <style>{originMode ? '* { cursor: crosshair !important; }' : ''}</style>
    </Box>
  );
}
