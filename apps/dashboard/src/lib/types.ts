// Shared DTO types between the in-app API and the client views.
export interface KpisOut {
  zones_l3_l4: number;
  alerts_today: number;
  pending_reports: number;
  sensors_online: number;
  total_zones: number;
}

export interface DdmaSop {
  id: string;
  label: string;
  detail: string;
}

export interface DcDirective {
  zone_code: string;
  sop_id: string;
  status: string;
}

export interface Driver {
  feature: string;
  name: string;
  value: string;
  val_num: number;
  contribution: number;
  description: string;
}

export interface ZoneOut {
  id: string;
  zone_code: string;
  name: string;
  district: string;
  state: string;
  hazard_level: number;
  susc_mean: number;
  susc_p90: number;
  prob_24h: number;
  population: number;
  road_km: number;
}

export interface Dossier {
  zone: ZoneOut & {
    center: [number, number];
    rain_intensity: number;
    rain_24h: number;
    antecedent: number;
    soil_moisture: number;
    creep_mm_year: number;
    isolation_score: number;
    flood_index: number;
    road_class: string;
    threshold_tier: number;
    ml_tier: number;
    history: { t: number; level: number; rain: number; prob: number }[];
  };
  drivers: Driver[];
  reports: {
    id: number;
    type: string;
    note: string;
    status: string;
    verdict?: { label: string; confidence: number };
    created_at: number;
  }[];
  weather: {
    intensity_mm_h: number;
    duration_min: number;
    band: string;
    threshold: [number, number, number][];
    check: string;
    forecast_72h: { h: number; mm: number; level: number }[];
  };
  briefing_md: string;
}

export interface TickerEvent {
  id: number;
  kind: string;
  text: string;
  ts: number;
  level?: number;
  zone_code?: string;
}

export interface PriorityRow {
  zone_id: string;
  zone_code: string;
  name: string;
  district: string;
  level: number;
  population: number;
  isolation: number;
  roads_blocked: number;
  priority: number;
  sops: DdmaSop[];
  team: string | null;
  status: "open" | "directed" | "assigned";
}

export interface RegistryRow {
  model: string;
  layer: string;
  approach: string;
  val_metric: string;
  status: string;
  note: string;
}

export interface AlertRow {
  id: number;
  zone_code: string;
  zone_name: string;
  district: string;
  level: number;
  message: string;
  channels: string[];
  created_at: number;
  ack: boolean;
  ack_by?: string;
}

export interface ReportOut {
  id: number;
  zone_code: string;
  type: string;
  note: string;
  status: string;
  lat: number;
  lon: number;
  verdict?: { label: string; confidence: number };
  created_at: number;
  reporter: string;
}

export interface WeatherOut {
  zone: { zone_code: string; name: string; district: string; level: number };
  current: { intensity_mm_h: number; rain_24h: number; soil_moisture: number; antecedent: number };
  id_check: {
    band: string;
    duration_min: number;
    thresholds: [number, number, number][];
    tier: number;
    verdict: string;
  };
  forecast_72h: { h: number; mm: number; level: number }[];
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  role: string;
  user: { email: string; full_name: string; role: string; district: string | null };
}
