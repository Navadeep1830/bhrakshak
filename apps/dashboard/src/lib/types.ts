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
  feature?: string;
  name: string;
  value?: string | number;
  val_num?: number;
  contribution?: number;
  description?: string;
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
  prob_24h: number | null;
  population: number | null;
  road_km: number | null;
}

export interface Dossier {
  zone: ZoneOut & {
    center?: [number, number];
    rain_intensity?: number;
    rain_24h?: number;
    antecedent?: number;
    soil_moisture?: number;
    creep_mm_year?: number;
    isolation_score?: number;
    flood_index?: number;
    road_class?: string;
    threshold_tier?: number;
    ml_tier?: number;
    history?: { t: number; level: number; rain: number; prob: number }[];
  };
  drivers: Driver[];
  reports: {
    id: number | string;
    type?: string;
    note?: string;
    status: string;
    verdict?: { label: string; confidence: number };
    created_at?: number | string;
  }[];
  /** Demo contract embeds the full weather panel; the live ZoneDossier
   *  omits it — the drawer derives an honest gauge summary from
   *  rainfall_series / id_threshold_check instead. */
  weather?: {
    intensity_mm_h: number;
    duration_min: number;
    band: string;
    threshold: [number, number, number][];
    check: string;
    forecast_72h: { h: number; mm: number; level: number }[];
  };
  /** Live ZoneDossier extras, consumed defensively. */
  rainfall_series?: {
    ts?: string;
    rain_1h?: number | null;
    rain_24h?: number | null;
  }[];
  id_threshold_check?: {
    any_breach?: boolean;
    breach_1h?: boolean;
    breach_24h?: boolean;
  } | null;
  briefing_md?: string;
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
  id: number | string;
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

export interface LoginUser {
  email: string;
  full_name: string;
  role: string;
  district: string | null;
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  role: string;
  /** Demo login route embeds the profile; live FastAPI TokenOut does not. */
  user?: LoginUser;
}

/** GET /api/v1/auth/me — live FastAPI profile (demo embeds it in login). */
export interface MeResponse extends LoginUser {
  id?: string;
  preferred_lang?: string;
}

/** Normalized, backend-agnostic session consumed by the login screen. */
export interface AuthSession {
  token: string;
  role: string;
  email: string;
  fullName: string | null;
  district: string | null;
}
