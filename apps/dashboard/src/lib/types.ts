export interface KpisOut {
  zones_l3_l4: number;
  alerts_today: number;
  pending_reports: number;
  sensors_online: number;
  total_zones: number;
}

export interface Driver {
  feature: string;
  value: string | number;
  contribution: number;
}

export interface ZoneOut {
  id: string;
  zone_code: string;
  name: string | null;
  district: string | null;
  state: string | null;
  susc_mean: number | null;
  susc_p90: number | null;
  population: number | null;
  road_km: number | null;
  hazard_level: number;
  prob_24h: number | null;
}

export interface Dossier {
  zone: ZoneOut;
  rainfall_series: { ts: string; rain_1h: number | null; rain_24h: number | null }[];
  sensors: { sensor_id: string; ts: string; soil_moisture: number | null }[];
  reports: { id: string; category: string; status: string; created_at: string }[];
  alerts: { level: number; fired_at: string; message: string }[];
  drivers: { feature: string; value: number; contribution: number }[];
  historical_events: unknown[];
}

export interface TickerEvent {
  type: string;
  zone_code?: string;
  name?: string;
  level?: number;
  message?: string;
  ts?: string;
}
