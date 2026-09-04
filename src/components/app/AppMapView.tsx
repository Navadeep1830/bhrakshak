'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Map as MlMap, Marker, LngLatBounds, setWorkerUrl } from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Paper, IconButton, Tooltip, Chip, Stack, Typography, Button, CircularProgress, ToggleButtonGroup, ToggleButton, Menu, MenuItem, Divider } from '@mui/material';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import RouteIcon from '@mui/icons-material/Route';
import ThreeSixtyIcon from '@mui/icons-material/ThreeSixty';
import CloseIcon from '@mui/icons-material/Close';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import MapIcon from '@mui/icons-material/Map';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import EditLocationAltIcon from '@mui/icons-material/EditLocationAlt';
import PlaceIcon from '@mui/icons-material/Place';
import FlagIcon from '@mui/icons-material/Flag';
import TripOriginIcon from '@mui/icons-material/TripOrigin';
import TurnLeftIcon from '@mui/icons-material/TurnLeft';
import TurnRightIcon from '@mui/icons-material/TurnRight';
import TurnSlightLeftIcon from '@mui/icons-material/TurnSlightLeft';
import TurnSlightRightIcon from '@mui/icons-material/TurnSlightRight';
import TurnSharpLeftIcon from '@mui/icons-material/TurnSharpLeft';
import TurnSharpRightIcon from '@mui/icons-material/TurnSharpRight';
import UturnLeftIcon from '@mui/icons-material/UTurnLeft';
import StraightIcon from '@mui/icons-material/Straight';
import ListAltIcon from '@mui/icons-material/ListAlt';
import { BASE_STYLES } from '@/components/map/map-styles';
import { hazardColor } from '@/components/theme';
import type { AppZone, AppRoad, RoutePlanUI, RouteOptionUI, HazardMarkUI, AppShelter, RouteStepUI } from './types';

if (typeof window !== 'undefined') setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

interface Props {
  zones: AppZone[];
  roads: AppRoad[];
  shelters: AppShelter[];
  plan: RoutePlanUI | null;
  online: boolean;
  userPos: { lat: number; lon: number } | null;
  onUserPos: (p: { lat: number; lon: number }) => void;
  onPlan: (plan: RoutePlanUI | null) => void;
  onStreetView: (z: { zoneCode: string; name: string; district: string; level: number; probability: number; lat: number; lon: number; drivers?: any[] }) => void;
  onToast: (msg: string, sev?: 'success' | 'error' | 'info') => void;
}

const ROAD_COLORS: Record<string, string> = { open: '#22c55e', watch: '#f59e0b', blocked: '#ef4444' };

export default function AppMapView({ zones, roads, shelters, plan, online, userPos, onUserPos, onPlan, onStreetView, onToast }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [style, setStyle] = useState<'street' | 'satellite'>('street');
  const [routeMode, setRouteMode] = useState(false);
  const [routeBusy, setRouteBusy] = useState(false);
  const [selectedZone, setSelectedZone] = useState<AppZone | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<string>('safest');
  const [destPick, setDestPick] = useState<{ lat: number; lon: number; name?: string } | null>(null);
  const [pickLocMode, setPickLocMode] = useState(false); // tap-the-map location override
  const [placesAnchor, setPlacesAnchor] = useState<null | HTMLElement>(null);
  const [shelterSheet, setShelterSheet] = useState(false);
  const [showSteps, setShowSteps] = useState(true);
  const userMarkerRef = useRef<Marker | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);

  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const routeModeRef = useRef(routeMode);
  routeModeRef.current = routeMode;
  const pickLocRef = useRef(pickLocMode);
  pickLocRef.current = pickLocMode;
  const onUserPosRef = useRef(onUserPos);
  onUserPosRef.current = onUserPos;

  /* ── init map ── */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MlMap({
      container: containerRef.current,
      style: BASE_STYLES.street,
      center: [91.8, 25.3],
      zoom: 6.3,
      attributionControl: false,
    });
    mapRef.current = map;
    (window as unknown as Record<string, unknown>).__bhrAppMap = map; // debug hook
    map.on('load', () => {
      // ── sources ──
      map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('roads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('detours', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('route-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('route-marks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      // ── zones: hex fill + outline ──
      map.addLayer({
        id: 'zone-fill', type: 'fill', source: 'zones',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['interpolate', ['linear'], ['get', 'level'], 0, 0.10, 1, 0.22, 2, 0.34, 3, 0.5, 4, 0.62] },
      });
      map.addLayer({
        id: 'zone-line', type: 'line', source: 'zones',
        paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 12, 1.8] },
      });
      // halo for L3+ (the "marks where landslides could occur")
      map.addLayer({
        id: 'zone-halo', type: 'circle', source: 'zones', filter: ['>=', ['get', 'level'], 3],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 6, 12, 16],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.28,
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 1.4,
          'circle-stroke-opacity': 0.85,
        },
      });

      // ── roads ──
      map.addLayer({
        id: 'road-line', type: 'line', source: 'roads',
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 12, 3.2], 'line-opacity': 0.9 },
      });
      // ── detours: dashed cyan ──
      map.addLayer({
        id: 'detour-line', type: 'line', source: 'detours',
        paint: { 'line-color': '#38bdf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.4, 12, 3], 'line-dasharray': [2.2, 1.6], 'line-opacity': 0.95 },
      });

      // ── route plan lines ──
      map.addLayer({
        id: 'route-casing', type: 'line', source: 'route-lines',
        paint: { 'line-color': '#020617', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 8], 'line-opacity': 0.55 },
      });
      map.addLayer({
        id: 'route-line', type: 'line', source: 'route-lines',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            7, ['case', ['==', ['get', 'id'], ['literal', '']], 0, ['case', ['get', 'rec'], 3.4, 2]],
            12, ['case', ['==', ['get', 'id'], ['literal', '']], 0, ['case', ['get', 'rec'], 7, 4]],
          ],
          'line-dasharray': ['case', ['get', 'rec'], ['literal', [1, 0]], ['literal', [2.4, 1.6]]],
        },
      });
      // ── hazard marks (pins along route) ──
      map.addLayer({
        id: 'mark-pin', type: 'circle', source: 'route-marks',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 11],
          'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.6,
        },
      });

      setReady(true);
    });

    // interactions
    map.on('click', (e) => {
      if (pickLocRef.current) {
        onUserPosRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        setPickLocMode(false);
        onToast(`Position set manually — ${e.lngLat.lat.toFixed(4)}, ${e.lngLat.lng.toFixed(4)}`, 'success');
        return;
      }
      if (routeModeRef.current) {
        setDestPick({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        return;
      }
      const feats = map.queryRenderedFeatures(e.point, { layers: ['zone-fill'] });
      if (feats.length) {
        const z = zonesRef.current.find((zz) => zz.zoneCode === feats[0].properties?.zoneCode);
        if (z) setSelectedZone(z);
        return;
      }
      setSelectedZone(null);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  /* ── swap basemap ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (style === 'street') map.setStyle(BASE_STYLES.street, { diff: false });
    else map.setStyle(BASE_STYLES.satellite, { diff: false });
    // layers must be re-added after style swap
    map.once('styledata', () => {
      // re-add sources + layers (same as load) then re-render data
      if (!map.getSource('zones')) {
        map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: zonesToFeatures(zonesRef.current) } });
        map.addSource('roads', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('detours', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('route-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addSource('route-marks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zones', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['interpolate', ['linear'], ['get', 'level'], 0, 0.1, 1, 0.22, 2, 0.34, 3, 0.5, 4, 0.62] } });
        map.addLayer({ id: 'zone-line', type: 'line', source: 'zones', paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 12, 1.8] } });
        map.addLayer({ id: 'zone-halo', type: 'circle', source: 'zones', filter: ['>=', ['get', 'level'], 3], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 6, 12, 16], 'circle-color': ['get', 'color'], 'circle-opacity': 0.28, 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 1.4, 'circle-stroke-opacity': 0.85 } });
        map.addLayer({ id: 'road-line', type: 'line', source: 'roads', paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 12, 3.2], 'line-opacity': 0.9 } });
        map.addLayer({ id: 'detour-line', type: 'line', source: 'detours', paint: { 'line-color': '#38bdf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.4, 12, 3], 'line-dasharray': [2.2, 1.6], 'line-opacity': 0.95 } });
        map.addLayer({ id: 'route-casing', type: 'line', source: 'route-lines', paint: { 'line-color': '#020617', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 12, 8], 'line-opacity': 0.55 } });
        map.addLayer({ id: 'route-line', type: 'line', source: 'route-lines', paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, ['case', ['==', ['get', 'id'], ['literal', '']], 0, ['case', ['get', 'rec'], 3.4, 2]], 12, ['case', ['==', ['get', 'id'], ['literal', '']], 0, ['case', ['get', 'rec'], 7, 4]]], 'line-dasharray': ['case', ['get', 'rec'], ['literal', [1, 0]], ['literal', [2.4, 1.6]]] } });
        map.addLayer({ id: 'mark-pin', type: 'circle', source: 'route-marks', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 11], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.6 } });
        renderRoads();
        renderPlan();
      }
    });
  }, [style, ready]);

  /* ── data → map ── */
  function zonesToFeatures(zs: AppZone[]) {
    return zs.map((z) => ({
      type: 'Feature' as const,
      id: z.zoneCode,
      geometry: { type: 'Polygon' as const, coordinates: [[...z.geom, z.geom[0]]] },
      properties: { zoneCode: z.zoneCode, name: z.name, level: z.level, color: hazardColor(z.level) },
    }));
  }

  const renderRoads = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('roads')) return;
    (map.getSource('roads') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: roads.map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: r.coords },
        properties: { color: ROAD_COLORS[r.status] ?? '#64748b', roadName: r.roadName, status: r.status },
      })),
    });
    (map.getSource('detours') as GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: roads
        .filter((r) => r.detour)
        .map((r) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: r.detour!.polyline },
          properties: { roadName: r.roadName },
        })),
    });
  }, [roads]);

  const renderPlan = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getSource('route-lines')) return;
    if (!plan) {
      (map.getSource('route-lines') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
      (map.getSource('route-marks') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const sel = plan.routes.find((r) => r.id === selectedRoute) ?? plan.routes.find((r) => r.recommended) ?? plan.routes[0];
    (map.getSource('route-lines') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: plan.routes.map((r) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: r.polyline },
        properties: { id: r.id, color: r.strokeColor, rec: r.id === sel?.id },
      })),
    });
    const marks: HazardMarkUI[] = sel?.hazardMarks ?? [];
    (map.getSource('route-marks') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: marks.map((m) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [m.lon, m.lat] },
        properties: { color: hazardColor(m.level), zoneCode: m.zoneCode },
      })),
    });
  }, [plan, selectedRoute]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    (map.getSource('zones') as GeoJSONSource)?.setData({ type: 'FeatureCollection', features: zonesToFeatures(zones) });
    renderRoads();
  }, [zones, roads, ready, renderRoads]);

  useEffect(() => {
    if (!ready) return;
    renderPlan();
  }, [plan, selectedRoute, ready, renderPlan]);

  /* fit bounds when plan arrives */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !plan) return;
    const sel = plan.routes.find((r) => r.id === selectedRoute) ?? plan.routes[0];
    if (!sel) return;
    const bounds = new LngLatBounds();
    sel.polyline.forEach((p) => bounds.extend([p[0], p[1]]));
    bounds.extend([plan.origin.lon, plan.origin.lat]);
    bounds.extend([plan.destination.lon, plan.destination.lat]);
    map.fitBounds(bounds, { padding: 56, duration: 900, maxZoom: 11.5 });
  }, [plan]);

  /* user position marker */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPos) return;
    if (!userMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#38bdf8;border:3px solid #e2f4ff;box-shadow:0 0 10px #38bdf8aa';
      userMarkerRef.current = new Marker({ element: el }).setLngLat([userPos.lon, userPos.lat]).addTo(map);
    } else {
      userMarkerRef.current.setLngLat([userPos.lon, userPos.lat]);
    }
  }, [userPos, ready]);

  /* destination marker */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (destPick) {
      if (!destMarkerRef.current) {
        const el = document.createElement('div');
        el.style.cssText = 'width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#f59e0b;border:2px solid #fff'
        destMarkerRef.current = new Marker({ element: el }).setLngLat([destPick.lon, destPick.lat]).addTo(map);
      } else {
        destMarkerRef.current.setLngLat([destPick.lon, destPick.lat]);
      }
    } else if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
  }, [destPick, ready]);

  /* ── actions ── */
  const locate = () => {
    if (!navigator.geolocation) {
      onToast('Geolocation unavailable — using district centre', 'info');
      const z = zones.find((zz) => zz.level >= 2) ?? zones[0];
      if (z) { onUserPos({ lat: z.lat, lon: z.lon }); mapRef.current?.flyTo({ center: [z.lon, z.lat], zoom: 10 }); }
      return;
    }
    onToast('Locating…', 'info');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lon: p.coords.longitude };
        onUserPos(pos);
        mapRef.current?.flyTo({ center: [pos.lon, pos.lat], zoom: 10.5 });
        onToast('Location locked', 'success');
      },
      () => {
        const z = zones.find((zz) => zz.level >= 2) ?? zones[0];
        if (z) { onUserPos({ lat: z.lat, lon: z.lon }); onToast('GPS denied — simulating field position', 'info'); mapRef.current?.flyTo({ center: [z.lon, z.lat], zoom: 10 }); }
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  };

  const planRoute = async (dest: { lat: number; lon: number; name?: string }) => {
    const origin = userPos ?? (zones.length ? { lat: zones[0].lat, lon: zones[0].lon } : null);
    if (!origin) { onToast('Set your position first ( Locate or tap-set )', 'error'); return; }
    setRouteBusy(true);
    setRouteMode(false);
    setShelterSheet(false);
    try {
      const res = await fetch('/api/app/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originLat: origin.lat, originLon: origin.lon, destLat: dest.lat, destLon: dest.lon, destName: dest.name ?? null }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || 'Route planning failed');
      const p = d.plan as RoutePlanUI;
      onPlan({ ...p, destination: { ...p.destination, name: dest.name } });
      setSelectedRoute(p.routes.find((r) => r.recommended)?.id ?? 'safest');
      const rec = p.routes.find((r) => r.recommended);
      onToast(`3 routes planned${rec?.via ? ` via ${rec.via}` : ''} — ${rec?.steps.length ?? 0} directions`, 'success');
    } catch (e) {
      onToast((e as Error).message, 'error');
    } finally {
      setRouteBusy(false);
    }
  };

  /* nearest shelters (quick destinations, like a maps app) */
  const ref = userPos ?? (mapRef.current ? (() => { const c = mapRef.current!.getCenter(); return { lat: c.lat, lon: c.lng }; })() : zones[0] ? { lat: zones[0].lat, lon: zones[0].lon } : null);
  const nearestShelters: Array<AppShelter & { distKm: number }> = (ref ? shelters
    .map((s) => ({ ...s, distKm: Math.round(Math.hypot(s.lat - ref.lat, s.lon - ref.lon) * 89) }))
    .sort((a, b) => a.distKm - b.distKm) : []).slice(0, 3);

  /* district / worst-zone quick jump list for the location picker menu */
  const placeMenuItems: Array<{ label: string; sub: string; lat: number; lon: number; level?: number }> = [];
  for (const d of [...new Set(zones.map((z) => z.district))].sort()) {
    const dz = zones.filter((z) => z.district === d);
    const worst = dz.slice().sort((a, b) => b.level - a.level || b.probability - a.probability)[0];
    placeMenuItems.push({
      label: d,
      sub: worst && worst.level >= 2 ? `worst zone: ${worst.zoneCode} · L${worst.level}` : `${dz.length} zones`,
      lat: worst ? worst.lat : dz[0].lat,
      lon: worst ? worst.lon : dz[0].lon,
      level: worst?.level,
    });
  }

  const jumpTo = (p: { label: string; lat: number; lon: number }) => {
    onUserPos({ lat: p.lat, lon: p.lon });
    mapRef.current?.flyTo({ center: [p.lon, p.lat], zoom: 10.5 });
    setPlacesAnchor(null);
    onToast(`Position set — ${p.label}`, 'success');
  };

  const nearestHazard = (): HazardMarkUI | null => {
    // reference point: user position, else current map centre
    const c = mapRef.current?.getCenter();
    const ref = userPos ?? (c ? { lat: c.lat, lon: c.lng } : null) ?? (zones.length ? { lat: zones[0].lat, lon: zones[0].lon } : null);
    if (!ref) return null;
    let best: HazardMarkUI | null = null;
    let bd = Infinity;
    for (const z of zones) {
      if (z.level < 2) continue;
      const d = Math.hypot(z.lat - ref.lat, z.lon - ref.lon);
      if (d < bd) { bd = d; best = { zoneCode: z.zoneCode, name: z.name, district: z.district, level: z.level, probability: z.probability, lat: z.lat, lon: z.lon, side: 'left', distanceKm: 0 }; }
    }
    return best;
  };

  const sel = plan?.routes.find((r) => r.id === selectedRoute) ?? plan?.routes.find((r) => r.recommended);

  return (
    <Box sx={{ position: 'absolute', inset: 0, bgcolor: '#0a0f18' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* top-right controls */}
      <Stack spacing={0.75} sx={{ position: 'absolute', top: 10, right: 10, zIndex: 5 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={style}
          onChange={(_, v) => v && setStyle(v)}
          sx={{ bgcolor: 'rgba(10,15,26,.86)', backdropFilter: 'blur(6px)', borderRadius: 2, '& .MuiToggleButton-root': { p: 0.75, border: 0, color: 'text.secondary' } }}
        >
          <ToggleButton value="street" aria-label="Street map"><Tooltip title="Street map"><MapIcon sx={{ fontSize: 17 }} /></Tooltip></ToggleButton>
          <ToggleButton value="satellite" aria-label="Satellite"><Tooltip title="Satellite"><SatelliteAltIcon sx={{ fontSize: 17 }} /></Tooltip></ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title="My location (GPS)">
          <IconButton size="small" onClick={locate} sx={{ bgcolor: 'rgba(10,15,26,.86)', backdropFilter: 'blur(6px)', color: '#38bdf8', '&:hover': { bgcolor: 'rgba(10,15,26,.95)' } }}>
            <MyLocationIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Set my position manually — tap the map">
          <IconButton
            size="small"
            onClick={() => { setPickLocMode((v) => !v); setRouteMode(false); }}
            sx={{
              bgcolor: pickLocMode ? 'rgba(56,189,248,.9)' : 'rgba(10,15,26,.86)',
              color: pickLocMode ? '#04121f' : '#e2e8f0',
              backdropFilter: 'blur(6px)', '&:hover': { bgcolor: pickLocMode ? '#38bdf8' : 'rgba(10,15,26,.95)' },
            }}
          >
            <EditLocationAltIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Jump to a place / worst zone">
          <IconButton
            size="small"
            onClick={(e) => setPlacesAnchor(e.currentTarget)}
            sx={{ bgcolor: 'rgba(10,15,26,.86)', backdropFilter: 'blur(6px)', color: '#e2e8f0', '&:hover': { bgcolor: 'rgba(10,15,26,.95)' } }}
          >
            <PlaceIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Plan alternative safe routes">
          <IconButton
            size="small"
            onClick={() => { setRouteMode((v) => !v); setDestPick(null); }}
            sx={{
              bgcolor: routeMode ? 'rgba(56,189,248,.9)' : 'rgba(10,15,26,.86)', color: routeMode ? '#04121f' : '#e2e8f0',
              backdropFilter: 'blur(6px)', '&:hover': { bgcolor: routeMode ? '#38bdf8' : 'rgba(10,15,26,.95)' },
            }}
          >
            {routeBusy ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : <RouteIcon sx={{ fontSize: 19 }} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Street view of nearest hazard">
          <IconButton
            size="small"
            onClick={() => {
              const h = nearestHazard();
              if (h) onStreetView(h);
              else onToast('No landslide-risk zone nearby', 'info');
            }}
            sx={{ bgcolor: 'rgba(10,15,26,.86)', backdropFilter: 'blur(6px)', color: '#f59e0b', '&:hover': { bgcolor: 'rgba(10,15,26,.95)' } }}
          >
            <ThreeSixtyIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* route mode banner */}
      {routeMode && !pickLocMode && (
        <Paper sx={{ position: 'absolute', top: 10, left: 10, right: 64, zIndex: 5, p: 1, bgcolor: 'rgba(56,189,248,.14)', borderColor: 'rgba(56,189,248,.4)' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <RouteIcon sx={{ fontSize: 16, color: '#38bdf8' }} />
            <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }}>
              Tap the map to set your destination
            </Typography>
            <Button size="small" sx={{ minWidth: 0, fontSize: 10 }} onClick={() => { setShelterSheet((v) => !v); }}>Shelters</Button>
            <IconButton size="small" onClick={() => setRouteMode(false)}><CloseIcon sx={{ fontSize: 15 }} /></IconButton>
          </Stack>
        </Paper>
      )}

      {/* manual location banner */}
      {pickLocMode && (
        <Paper sx={{ position: 'absolute', top: 10, left: 10, right: 64, zIndex: 5, p: 1, bgcolor: 'rgba(56,189,248,.2)', borderColor: 'rgba(56,189,248,.5)' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <EditLocationAltIcon sx={{ fontSize: 16, color: '#38bdf8' }} />
            <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }}>
              Tap the map to place yourself there
            </Typography>
            <IconButton size="small" onClick={() => setPickLocMode(false)}><CloseIcon sx={{ fontSize: 15 }} /></IconButton>
          </Stack>
        </Paper>
      )}

      {/* place jump menu */}
      <Menu anchorEl={placesAnchor} open={!!placesAnchor} onClose={() => setPlacesAnchor(null)} slotProps={{ paper: { sx: { bgcolor: '#0e1522', maxHeight: 300 } } }}>
        <MenuItem disabled sx={{ opacity: 0.7, fontSize: 11 }}>Set position — pick a district hotspot</MenuItem>
        {placeMenuItems.map((p) => (
          <MenuItem key={p.label} onClick={() => jumpTo(p)} sx={{ display: 'block' }}>
            <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 12.5 }}>{p.label}</Typography>
            <Typography variant="caption" sx={{ color: p.level && p.level >= 2 ? hazardColor(p.level) : 'text.secondary', fontSize: 10 }}>
              {p.sub}
            </Typography>
          </MenuItem>
        ))}
      </Menu>

      {/* nearest shelters sheet (route mode) */}
      {routeMode && shelterSheet && (
        <Paper sx={{ position: 'absolute', bottom: 12, left: 10, right: 10, zIndex: 6, p: 1.25, bgcolor: 'rgba(14,21,34,.97)' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <FlagIcon sx={{ fontSize: 15, color: '#34d399' }} />
            <Typography variant="caption" sx={{ fontWeight: 800, flex: 1 }}>Route to nearest shelter</Typography>
            <IconButton size="small" onClick={() => setShelterSheet(false)}><CloseIcon sx={{ fontSize: 14 }} /></IconButton>
          </Stack>
          <Stack spacing={0.5}>
            {nearestShelters.map((s) => (
              <Stack
                key={s.name}
                direction="row"
                spacing={1}
                onClick={() => planRoute({ lat: s.lat, lon: s.lon, name: s.name })}
                sx={{ alignItems: 'center', p: 0.6, borderRadius: 1.25, bgcolor: 'rgba(52,211,153,.08)', cursor: 'pointer', border: '1px solid rgba(52,211,153,.25)' }}
              >
                <FlagIcon sx={{ fontSize: 14, color: '#34d399' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', lineHeight: 1.15 }}>{s.name}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9.5, lineHeight: 1.1 }}>
                    ~{s.distKm} km · capacity {s.capacity} · {s.occupancy} inside
                  </Typography>
                </Box>
                <Chip size="small" label="go" color="success" sx={{ height: 18, fontSize: 9, fontWeight: 800 }} />
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {/* offline watermark */}
      {!online && (
        <Paper sx={{ position: 'absolute', top: routeMode ? 58 : 10, left: 10, zIndex: 4, px: 1, py: 0.4, bgcolor: 'rgba(239,68,68,.16)', borderColor: 'rgba(239,68,68,.4)' }}>
          <Typography variant="caption" sx={{ fontWeight: 800, color: '#f87171' }}>OFFLINE — cached map data</Typography>
        </Paper>
      )}

      {/* destination picked → confirm */}
      {routeMode && destPick && (
        <Paper sx={{ position: 'absolute', bottom: 12, left: 10, right: 10, zIndex: 6, p: 1.25, bgcolor: 'rgba(14,21,34,.96)' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1 }}>
                Destination
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {destPick.lat.toFixed(4)}, {destPick.lon.toFixed(4)}
              </Typography>
            </Box>
            <Button size="small" onClick={() => setDestPick(null)}>Move</Button>
            <Button size="small" variant="contained" disabled={routeBusy} onClick={() => planRoute(destPick)}>
              {routeBusy ? 'Planning…' : 'Plan routes'}
            </Button>
          </Stack>
        </Paper>
      )}

      {/* zone sheet */}
      {selectedZone && !plan && (
        <Paper sx={{ position: 'absolute', bottom: 12, left: 10, right: 10, zIndex: 6, p: 1.5, bgcolor: 'rgba(14,21,34,.97)' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Chip size="small" label={`L${selectedZone.level}`} sx={{ height: 20, fontWeight: 800, bgcolor: `${hazardColor(selectedZone.level)}22`, color: hazardColor(selectedZone.level) }} />
            <Typography variant="body2" sx={{ fontWeight: 800, flex: 1 }}>{selectedZone.zoneCode}</Typography>
            <IconButton size="small" onClick={() => setSelectedZone(null)}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
            {selectedZone.name} · {selectedZone.district} · P(landslide 24h) = {Math.round(selectedZone.probability * 100)}% · {selectedZone.population.toLocaleString('en-IN')} people
          </Typography>
          <Button
            size="small" variant="outlined" color="warning" startIcon={<ThreeSixtyIcon sx={{ fontSize: 16 }} />}
            onClick={() => onStreetView(selectedZone)}
          >
            Street view
          </Button>
        </Paper>
      )}

      {/* route plan bottom sheet — Google-Maps style */}
      {plan && sel && (
        <Paper sx={{ position: 'absolute', bottom: 12, left: 10, right: 10, zIndex: 6, p: 1.5, bgcolor: 'rgba(14,21,34,.97)', maxHeight: 344, overflowY: 'auto' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
            <RouteIcon sx={{ fontSize: 17, color: '#38bdf8' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 800, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {plan.destination.name ? `→ ${plan.destination.name}` : 'Route options'}
              </Typography>
              {sel.via && (
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, lineHeight: 1 }}>
                  via {sel.via}
                </Typography>
              )}
            </Box>
            <Tooltip title="Turn-by-turn directions">
              <IconButton size="small" onClick={() => setShowSteps((v) => !v)} sx={{ color: showSteps ? '#38bdf8' : 'text.secondary' }}>
                <ListAltIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
            <IconButton size="small" onClick={() => { onPlan(null); setDestPick(null); }}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
          </Stack>
          <Stack spacing={0.75}>
            {plan.routes.map((r) => {
              const active = r.id === selectedRoute;
              return (
                <Box
                  key={r.id}
                  onClick={() => setSelectedRoute(r.id)}
                  sx={{
                    p: 1, borderRadius: 1.5, cursor: 'pointer',
                    border: active ? `1.5px solid ${r.strokeColor}` : '1px solid rgba(148,163,184,.2)',
                    bgcolor: active ? 'rgba(148,163,184,.08)' : 'transparent',
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: r.strokeColor, flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ fontWeight: 800, flex: 1 }}>
                      {r.label}
                      {r.recommended && <span style={{ color: '#34d399' }}> · RECOMMENDED</span>}
                    </Typography>
                    <Chip
                      size="small"
                      label={`${r.etaMinutes} min · ${r.distanceKm} km`}
                      sx={{ height: 18, fontSize: 10, fontWeight: 800, fontFamily: 'monospace' }}
                    />
                    <Chip
                      size="small"
                      label={r.riskLabel}
                      sx={{ height: 18, fontSize: 10, fontWeight: 800, bgcolor: r.riskLabel === 'Low' ? 'rgba(16,185,129,.16)' : r.riskLabel === 'Moderate' ? 'rgba(245,158,11,.16)' : 'rgba(239,68,68,.16)', color: r.riskLabel === 'Low' ? '#34d399' : r.riskLabel === 'Moderate' ? '#f59e0b' : '#f87171' }}
                    />
                  </Stack>
                  {(r.blockedRoads.length > 0 || r.via) && (
                    <Stack direction="row" spacing={1.5} sx={{ mt: 0.4 }}>
                      {r.via && (
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
                          via {r.via}
                        </Typography>
                      )}
                      {r.blockedRoads.length > 0 && (
                        <Typography variant="caption" sx={{ color: '#f87171', fontSize: 10, display: 'flex', alignItems: 'center', gap: 0.3 }}>
                          <WarningAmberIcon sx={{ fontSize: 11 }} /> {r.blockedRoads.join(', ')}
                        </Typography>
                      )}
                    </Stack>
                  )}

                  {/* turn-by-turn directions for the selected route */}
                  {active && showSteps && (
                    <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid rgba(148,163,184,.14)' }}>
                      {r.steps.map((st) => (
                        <Stack
                          key={st.idx}
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'flex-start', py: 0.45 }}
                        >
                          <Box sx={{ color: st.kind === 'hazard' ? hazardColor(st.level ?? 2) : st.kind === 'arrive' ? '#34d399' : '#93c5fd', mt: 0.25, flexShrink: 0 }}>
                            {stepIcon(st)}
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                fontWeight: st.kind === 'hazard' ? 800 : 600,
                                fontSize: 11,
                                lineHeight: 1.25,
                                display: 'block',
                                color: st.kind === 'hazard' ? hazardColor(st.level ?? 2) : 'text.primary',
                              }}
                            >
                              {st.kind === 'hazard' ? `${st.instruction} — on the ${hazardMarkSide(r, st.zoneCode)}` : st.instruction}
                            </Typography>
                            {st.zoneCode && st.level != null && (
                              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9.5, display: 'block', lineHeight: 1 }}>
                                P(24h) {Math.round((hazardMarkProb(r, st.zoneCode) ?? 0) * 100)}% · tap a hazard mark for street view
                              </Typography>
                            )}
                          </Box>
                          <Stack sx={{ flexShrink: 0, textAlign: 'right' }}>
                            {st.distanceKm > 0.2 && (
                              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9.5, lineHeight: 1 }}>
                                {st.distanceKm} km
                              </Typography>
                            )}
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9, lineHeight: 1.2 }}>
                              {st.cumMin < 60 ? `${st.cumMin} min` : `${Math.floor(st.cumMin / 60)}h ${st.cumMin % 60}m`}
                            </Typography>
                          </Stack>
                        </Stack>
                      ))}
                      {r.steps.length === 0 && (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          Short hop — follow the highlighted line.
                        </Typography>
                      )}
                      {r.hazardMarks.length > 0 && (
                        <Divider sx={{ my: 0.5, borderColor: 'rgba(148,163,184,.14)' }} />
                      )}
                      {r.hazardMarks.slice(0, 4).map((m) => (
                        <Stack
                          key={`m-${m.zoneCode}`}
                          direction="row"
                          spacing={1}
                          onClick={() => onStreetView(m)}
                          sx={{ alignItems: 'center', py: 0.3, cursor: 'pointer' }}
                        >
                          <WarningAmberIcon sx={{ fontSize: 12, color: hazardColor(m.level) }} />
                          <Typography variant="caption" sx={{ fontWeight: 700 }}>
                            {m.zoneCode} <span style={{ color: hazardColor(m.level) }}>L{m.level}</span>
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
                            {m.side === 'left' ? '◀ left' : 'right ▶'} {m.distanceKm} km · P {Math.round(m.probability * 100)}%
                          </Typography>
                          <Chip size="small" label="street view" sx={{ height: 16, fontSize: 9, fontWeight: 700, color: '#f59e0b', borderColor: 'rgba(245,158,11,.4)' }} variant="outlined" />
                        </Stack>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}

/* maneuver icon per step kind */
function stepIcon(st: RouteStepUI): React.ReactNode {
  switch (st.kind) {
    case 'depart': return <TripOriginIcon sx={{ fontSize: 14 }} />;
    case 'turn-left': return <TurnLeftIcon sx={{ fontSize: 15 }} />;
    case 'turn-right': return <TurnRightIcon sx={{ fontSize: 15 }} />;
    case 'slight-left': return <TurnSlightLeftIcon sx={{ fontSize: 15 }} />;
    case 'slight-right': return <TurnSlightRightIcon sx={{ fontSize: 15 }} />;
    case 'sharp-left': return <TurnSharpLeftIcon sx={{ fontSize: 15 }} />;
    case 'sharp-right': return <TurnSharpRightIcon sx={{ fontSize: 15 }} />;
    case 'uturn': return <UturnLeftIcon sx={{ fontSize: 15 }} />;
    case 'continue': return <StraightIcon sx={{ fontSize: 15 }} />;
    case 'hazard': return <WarningAmberIcon sx={{ fontSize: 15 }} />;
    case 'arrive': return <FlagIcon sx={{ fontSize: 15 }} />;
    default: return <StraightIcon sx={{ fontSize: 15 }} />;
  }
}

function hazardMarkSide(r: RouteOptionUI, zoneCode?: string): string {
  const m = r.hazardMarks.find((x) => x.zoneCode === zoneCode);
  return m ? (m.side === 'left' ? 'left' : 'right') : 'route';
}

function hazardMarkProb(r: RouteOptionUI, zoneCode?: string): number | null {
  const m = r.hazardMarks.find((x) => x.zoneCode === zoneCode);
  return m ? m.probability : null;
}
