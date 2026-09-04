'use client';

/** Shared client types for the BhuRakshak field phone app. */

export interface AppZone {
  zoneCode: string;
  name: string;
  district: string;
  lat: number;
  lon: number;
  geom: Array<[number, number]>; // hex ring [lon,lat]
  level: number;
  probability: number;
  drivers: Array<{ feature: string; name: string; value: string; contribution: number; description?: string }>;
  population: number;
  suscMean: number;
}

export interface AppAlert {
  id: string;
  level: number;
  title: string;
  message: string;
  probability: number;
  createdAt: string;
}

export interface AppRoad {
  roadName: string;
  district: string;
  status: string;
  coords: Array<[number, number]>;
  note: string | null;
  detour: { polyline: Array<[number, number]>; extraKm: number; delayMinutes: number; reason: string } | null;
}

export interface AppNotification {
  id: string;
  kind: string;
  level: number;
  title: string;
  body: string;
  zoneCode: string | null;
  district: string | null;
  probability: number | null;
  channels: string[];
  reportId: string | null;
  createdAt: string;
}

export interface AppSms {
  id: string;
  phone: string;
  body: string;
  status: string;
  queuedAt: string;
  deliveredAt: string | null;
}

export interface AppShelter {
  name: string;
  district: string;
  lat: number;
  lon: number;
  capacity: number;
  occupancy: number;
}

export interface BootstrapData {
  serverTime: string;
  zones: AppZone[];
  alerts: AppAlert[];
  roads: AppRoad[];
  notifications: AppNotification[];
  sms: AppSms[];
  shelters: AppShelter[];
}

export interface HazardMarkUI {
  zoneCode: string;
  name: string;
  district: string;
  level: number;
  probability: number;
  lat: number;
  lon: number;
  side: 'left' | 'right';
  distanceKm: number;
}

export interface RouteStepUI {
  idx: number;
  kind:
    | 'depart'
    | 'turn-left' | 'turn-right'
    | 'slight-left' | 'slight-right'
    | 'sharp-left' | 'sharp-right'
    | 'uturn'
    | 'continue'
    | 'hazard'
    | 'arrive';
  instruction: string;
  roadName: string | null;
  distanceKm: number;
  cumKm: number;
  cumMin: number;
  zoneCode?: string;
  level?: number;
}

export interface RouteOptionUI {
  id: 'fastest' | 'safest' | 'alternate';
  label: string;
  summary: string;
  polyline: Array<[number, number]>;
  distanceKm: number;
  etaMinutes: number;
  riskScore: number;
  riskLabel: string;
  hazardMarks: HazardMarkUI[];
  blockedRoads: string[];
  bypasses: string | null;
  recommended: boolean;
  strokeColor: string;
  steps: RouteStepUI[];
  via: string | null;
}

export interface RoutePlanUI {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number; name?: string };
  routes: RouteOptionUI[];
  generatedAt: string;
}

export interface SubmitOutcome {
  ok: boolean;
  zoneCode?: string | null;
  zoneName?: string | null;
  aiPreScreen?: string;
  aiConfidence?: number;
  aiSource?: string;
  aiFindings?: string | null;
  fanOut?: { notifications: number; sms: number } | null;
  error?: string;
}

export const CATEGORY_LABELS: Record<string, string> = {
  crack: 'Ground / road crack',
  slope_movement: 'Slope movement',
  blocked_road: 'Blocked road',
  past_slide: 'Past landslide',
  water_seepage: 'Water seepage',
};

/** Field message — two-way comms with the command centre. */
export interface AppFieldMessage {
  id: string;
  authorName: string;
  authorRole: 'field' | 'command' | string;
  category: string; // sos | help | status | info | gauge
  body: string;
  priority: number;
  zoneCode: string | null;
  district: string | null;
  replyToId: string | null;
  createdAt: string;
}
