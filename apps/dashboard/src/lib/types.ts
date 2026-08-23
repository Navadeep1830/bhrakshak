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
  flood_level?: number;
  isolation?: number;
}

export interface TickerEvent {
  type: string;
  zone_code?: string;
  name?: string;
  level?: number;
  message?: string;
  ts?: string;
}

export interface PriorityRow {
  zone_id: string;
  zone_code: string | null;
  name: string | null;
  district: string | null;
  hazard_level: number;
  flood_level: number;
  susc_mean: number | null;
  population: number | null;
  road_km: number | null;
  isolation: number;
  score: number;
  reasons: string[];
  recommended_action: string;
}

export interface RegistryRow {
  id: number;
  name: string;
  version: string;
  git_sha: string | null;
  metrics: Record<string, unknown>;
  artifact_uri: string | null;
  notes: string | null;
  trained_at: string;
}

export interface AlertRow {
  id: string;
  zone_id: string;
  level: number;
  lang: string;
  channels: string[] | null;
  recipients: number;
  message_template: string | null;
  ack_at: string | null;
  fired_at: string;
}
