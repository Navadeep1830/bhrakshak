// Client-side API helpers.
// DEMO MODE (default): all calls go to the in-memory Next.js route handlers
// mounted at /api/v1/* — the dashboard runs fully standalone. Any https
// origin that is NOT a *.loca.lt tunnel also runs demo (preview hosts,
// static deploys) — never depend on a backend that may not be running.
// LIVE MODE: (a) NEXT_PUBLIC_API_URL set explicitly (e.g.
// http://localhost:8000), or (b) the dashboard itself is served from a
// *.loca.lt localtunnel (phone-to-PC demo workflow) -> auto-pair with the
// API tunnel https://bhrakshak-api-demo.loca.lt.
import type {
  Dossier, KpisOut, AlertRow, PriorityRow, RegistryRow, LoginResponse,
  MeResponse, AuthSession, LoginUser,
  TickerEvent, WeatherOut, ReportOut,
} from "@/lib/types";

function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    // Auto-live ONLY when the dashboard itself is tunnelled (*.loca.lt) —
    // that is the workflow the API tunnel belongs to. Preview hosts and
    // other https deploys stay in demo mode so the app always boots.
    if (/(^|\.)loca\.lt$/.test(window.location.hostname)) {
      return "https://bhrakshak-api-demo.loca.lt";
    }
  }
  return "";
}

export const endpoints = { API: getApiUrl() };

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((detail as { detail?: string }).detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const authHeaders = (token?: string | null): Record<string, string> | undefined =>
  token ? { Authorization: `Bearer ${token}` } : undefined;

// ---- live/demo contract normalization ---------------------------------
// The in-app demo routes and the FastAPI backend answer a few endpoints
// with different response shapes (dossier / priority / alerts). These
// adapters map EITHER contract onto the client types so no view ever
// reads a field that is undefined.

const num = (v: unknown, dflt = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : dflt;

function normAlert(a: Record<string, unknown>): AlertRow {
  return {
    id: typeof a.id === "string" ? a.id : num(a.id),
    zone_code: String(a.zone_code ?? ""),
    zone_name: String(a.zone_name ?? a.zone_id ?? "—"),
    district: String(a.district ?? ""),
    level: num(a.level),
    message: String(a.message ?? a.message_template ?? ""),
    channels: Array.isArray(a.channels) ? (a.channels as string[]) : [],
    created_at: num(a.created_at, a.fired_at ? Date.parse(String(a.fired_at)) : Date.now()),
    ack: typeof a.ack === "boolean" ? a.ack : a.ack_at != null,
    ack_by: a.ack_by as string | undefined,
  };
}

function normPriority(r: Record<string, unknown>): PriorityRow {
  // demo isolation is 0..1, live is 0..100 — normalize to 0..1
  const iso = num(r.isolation);
  return {
    zone_id: String(r.zone_id ?? r.id ?? ""),
    zone_code: String(r.zone_code ?? "—"),
    name: String(r.name ?? r.zone_name ?? "Zone"),
    district: String(r.district ?? ""),
    level: num(r.level, num(r.hazard_level)),
    population: num(r.population),
    isolation: iso > 1 ? iso / 100 : iso,
    roads_blocked: num(r.roads_blocked),
    priority: num(r.priority, num(r.score)),
    sops: Array.isArray(r.sops) ? (r.sops as PriorityRow["sops"]) : [],
    team: (r.team as string | null) ?? null,
    status: (r.status as PriorityRow["status"]) ?? "open",
  };
}

function normDossier(raw: Record<string, any>): Dossier {
  const zone = raw.zone ?? {};
  const series: Record<string, any>[] = Array.isArray(raw.rainfall_series) ? raw.rainfall_series : [];
  const last = series.length ? series[series.length - 1] : null;
  const idc = raw.id_threshold_check ?? null;
  const susc = typeof zone.susc_mean === "number" ? zone.susc_mean : null;
  // Demo embeds the weather panel; live ZoneDossier does not — derive an
  // honest gauge summary from its rainfall series instead of crashing.
  const weather: Dossier["weather"] = raw.weather ?? (last
    ? {
        intensity_mm_h: num(last.rain_1h),
        duration_min: Math.max(60, series.length * 60),
        band: susc == null ? "—" : susc >= 75 ? "high" : susc >= 50 ? "medium" : "low",
        threshold: [],
        check: idc
          ? (idc as { any_breach?: boolean }).any_breach
            ? "I-D envelope breached (live gauge)"
            : "Within I-D envelope (live gauge)"
          : `Live gauge — ${series.length} obs in 72h window`,
        forecast_72h: [],
      }
    : undefined);
  return {
    ...raw,
    zone: {
      ...zone,
      hazard_level: num(zone.hazard_level),
      population: num(zone.population),
      road_km: num(zone.road_km),
      prob_24h: num(zone.prob_24h),
      road_class: zone.road_class ?? "access",
      threshold_tier: num(zone.threshold_tier, num(zone.hazard_level)),
      ml_tier: num(zone.ml_tier, num(zone.hazard_level)),
      history: Array.isArray(zone.history) ? zone.history : [],
    },
    drivers: (Array.isArray(raw.drivers) ? raw.drivers : []).map((dr: Record<string, any>) => ({
      ...dr,
      name: String(dr.name ?? dr.feature ?? "driver"),
      value: dr.value ?? dr.val_num ?? "—",
      contribution: num(dr.contribution),
      description: dr.description ?? "",
    })),
    reports: (Array.isArray(raw.reports) ? raw.reports : []).map((r: Record<string, any>) => ({
      ...r,
      id: r.id ?? "",
      status: r.status ?? "pending",
      note: r.note ?? r.description ?? "",
      type: r.type ?? r.category ?? "other",
    })),
    weather,
    briefing_md: raw.briefing_md ?? "",
  };
}

const B = endpoints.API;
// localtunnel interstitial bypass (no-op against a direct backend)
const tunnelHeaders: Record<string, string> = B ? { "Bypass-Tunnel-Remainder": "true" } : {};

export const api = {
  login: async (email: string, password: string): Promise<AuthSession> => {
    const out = await fetch(`${B}/api/v1/auth/login`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).then(j<LoginResponse>);
    // Demo route embeds the profile; the live FastAPI TokenOut returns only
    // tokens — hydrate the profile from /auth/me, with a typed-email fallback
    // so a missing profile can never crash the login screen.
    let user: LoginUser | undefined = out.user;
    if (!user) {
      user = await fetch(`${B}/api/v1/auth/me`, {
        headers: { ...tunnelHeaders, ...authHeaders(out.access_token) },
      })
        .then(j<MeResponse>)
        .catch(() => undefined);
    }
    return {
      token: out.access_token,
      role: user?.role ?? out.role,
      email: user?.email ?? email,
      fullName: user?.full_name ?? null,
      district: user?.district ?? null,
    };
  },

  kpis: () => fetch(`${B}/api/v1/analytics/kpis`, { headers: tunnelHeaders }).then(j<KpisOut>),

  zonesGeo: (district?: string | null, horizon = 0) => {
    const p = new URLSearchParams();
    if (district) p.set("district", district);
    if (horizon) p.set("horizon", String(horizon));
    const qs = p.toString();
    return fetch(`${B}/api/v1/geo/zones${qs ? `?${qs}` : ""}`).then(j<any>);
  },
  roadsGeo: () => fetch(`${B}/api/v1/geo/roads`, { headers: tunnelHeaders }).then(j<any>),
  reportsGeo: () => fetch(`${B}/api/v1/geo/reports`, { headers: tunnelHeaders }).then(j<any>),

  dossier: (zoneId: string, token: string | null) =>
    fetch(`${B}/api/v1/zones/${zoneId}/dossier`, { headers: { ...tunnelHeaders, ...authHeaders(token) } })
      .then(j<Record<string, any>>)
      .then(normDossier),

  briefing: (zoneId: string, token: string | null) =>
    fetch(`${B}/api/v1/analytics/briefing-dossier/${zoneId}`, { headers: { ...tunnelHeaders, ...authHeaders(token) } })
      .then(j<{ zone_code: string; briefing_md: string }>),

  weather: (zoneId: string) =>
    fetch(`${B}/api/v1/zones/${zoneId}/weather`, { headers: tunnelHeaders }).then(j<WeatherOut>),

  alerts: (token: string | null) =>
    fetch(`${B}/api/v1/alerts`, { headers: { ...tunnelHeaders, ...authHeaders(token) } })
      .then(j<Record<string, any>[]>)
      .then((rows) => rows.map(normAlert)),

  ackAlert: (id: number | string, token: string | null) =>
    fetch(`${B}/api/v1/alerts/${id}/ack`, { method: "POST", headers: authHeaders(token) })
      .then(j<{ acked: number }>),

  previewFire: (zoneId: string, language: string) =>
    fetch(`${B}/api/v1/alerts/preview-fire`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ zone_id: zoneId, language }),
    }).then(j<{ zone_code: string; level: number; lang: string; message: string; channels: string[] }>),

  priority: (token: string | null) =>
    fetch(`${B}/api/v1/analytics/priority`, { headers: { ...tunnelHeaders, ...authHeaders(token) } })
      .then(j<Record<string, any>[]>)
      .then((rows) => rows.map(normPriority)),

  applySop: (zoneId: string, sopId: string, token: string | null) =>
    fetch(`${B}/api/v1/analytics/priority`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ zone_id: zoneId, sop_id: sopId }),
    }).then(j<{ status?: string; zone_code?: string }>),

  assignTeam: (zoneId: string, team: string, token: string | null) =>
    fetch(`${B}/api/v1/analytics/priority`, {
      method: "PUT",
      headers: { ...tunnelHeaders, "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ zone_id: zoneId, team }),
    }).then(j<any>),

  registry: () => fetch(`${B}/api/v1/analytics/registry`, { headers: tunnelHeaders }).then(j<RegistryRow[]>),
  backtest: () => fetch(`${B}/api/v1/analytics/backtest`, { headers: tunnelHeaders }).then(j<any>),

  events: (since = 0) =>
    fetch(`${B}/api/v1/events?since=${since}`, { headers: tunnelHeaders }).then(j<{ events: TickerEvent[]; latest_id: number }>),

  shelters: () => fetch(`${B}/api/v1/evacuation/shelters`, { headers: tunnelHeaders }).then(j<any[]>),
  safeRoute: (zoneCode: string) =>
    fetch(`${B}/api/v1/evacuation/safe-route?zone=${encodeURIComponent(zoneCode)}`, { headers: tunnelHeaders }).then(j<any>),

  roadsStatus: () => fetch(`${B}/api/v1/roads/status`, { headers: tunnelHeaders }).then(j<any>),
  detour: (from: string, to: string) =>
    fetch(`${B}/api/v1/roads/detour`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to }),
    }).then(j<any>),
  clearance: (roadId: string) =>
    fetch(`${B}/api/v1/roads/clearance-estimate`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ road_id: roadId }),
    }).then(j<any>),

  reports: (token: string | null) =>
    fetch(`${B}/api/v1/reports`, { headers: { ...tunnelHeaders, ...authHeaders(token) } }).then(j<ReportOut[]>),
  createReport: (r: any) =>
    fetch(`${B}/api/v1/reports`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(r),
    }).then(j<{ id: number; zone_code: string; status: string }>),
  syncReports: (queued: any[]) =>
    fetch(`${B}/api/v1/reports/sync`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ queued }),
    }).then(j<{ results: any[]; synced: number }>),
  verifyReport: (id: number, token: string | null, reject = false) =>
    fetch(`${B}/api/v1/reports/${id}/verify`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ reject }),
    }).then(j<{ id: number; status: string }>),

  injectStorm: (token: string | null) =>
    fetch(`${B}/api/v1/demo/inject-rainfall-storm`, { method: "POST", headers: authHeaders(token) })
      .then(j<any>),
  resetStorm: (token: string | null) =>
    fetch(`${B}/api/v1/demo/reset-storm`, { method: "POST", headers: authHeaders(token) })
      .then(j<any>),

  chatMessages: (token: string | null) =>
    fetch(`${B}/api/v1/chat/messages`, { headers: { ...tunnelHeaders, ...authHeaders(token) } }).then(j<any[]>),

  chatSend: (token: string | null, message: string) =>
    fetch(`${B}/api/v1/chat/send`, {
      method: "POST",
      headers: { ...tunnelHeaders, "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ message }),
    }).then(j<{ id: string; sender_name: string; location: string; message: string; role: string; timestamp: string }>),
};
