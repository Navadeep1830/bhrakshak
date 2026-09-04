/**
 * MapLibre style definitions — three basemaps, all free & key-less:
 *  - satellite : Esri World Imagery + real 3-D terrain (AWS terrarium DEM)
 *  - terrain   : OpenTopoMap hillshaded contours + 3-D terrain
 *  - street    : OpenStreetMap standard tiles (no key, no watermark)
 */

export type BaseStyleKey = 'satellite' | 'terrain' | 'street';

const TERRAIN_DEM = {
  type: 'raster-dem' as const,
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium' as const,
  tileSize: 256,
  maxzoom: 13,
};

const LABEL_LAYER = { id: 'dummy-labels', type: 'background' as const, paint: { 'background-color': 'transparent' } };

export const BASE_STYLES: Record<BaseStyleKey, any> = {
  satellite: {
    version: 8,
    name: 'bhr-satellite',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 18,
        attribution: 'Esri World Imagery',
      },
      terrainSource: TERRAIN_DEM,
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0f18' } },
      { id: 'esri-sat', type: 'raster', source: 'esri', paint: { 'raster-saturation': -0.3 } },
    ],
  },
  terrain: {
    version: 8,
    name: 'bhr-terrain',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      topo: {
        type: 'raster',
        tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 16,
        attribution: 'OpenTopoMap (CC-BY-SA)',
      },
      terrainSource: TERRAIN_DEM,
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0f18' } },
      { id: 'topo-base', type: 'raster', source: 'topo' },
    ],
  },
  street: {
    version: 8,
    name: 'bhr-street',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      osm: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0a0f18' } },
      { id: 'street-base', type: 'raster', source: 'osm' },
    ],
  },
};

export const BASE_STYLE_META: Record<BaseStyleKey, { label: string; hint: string; has3d: boolean }> = {
  satellite: { label: 'Satellite', hint: 'Esri imagery + 3-D terrain', has3d: true },
  terrain: { label: 'Terrain', hint: 'Topo contours + 3-D terrain', has3d: true },
  street: { label: 'Street', hint: 'OpenStreetMap street map', has3d: false },
};

export const DISTRICT_CENTERS: Record<string, { center: [number, number]; zoom: number }> = {
  'East Khasi Hills': { center: [91.6, 25.4], zoom: 9.2 },
  Aizawl: { center: [92.8, 23.72], zoom: 9.2 },
  Noney: { center: [93.8, 25.02], zoom: 9.6 },
  'Imphal West': { center: [93.92, 24.84], zoom: 10 },
  Gangtok: { center: [88.55, 27.42], zoom: 10 },
};
