// Client-side API helpers.
// DEMO MODE (default): all calls go to the in-memory Next.js route handlers
// mounted at /api/v1/* — the dashboard runs fully standalone.
// LIVE MODE: set NEXT_PUBLIC_API_URL (e.g. http://localhost:8000) and every
// call is routed to the real FastAPI backend with the same contract.
// Serving the dashboard over https without an explicit URL assumes the
// public api localtunnel (phone-to-PC demo workflow).
import type {
  Dossier, KpisOut, AlertRow, PriorityRow, RegistryRow, LoginResponse,
  MeResponse, AuthSession, LoginUser,
  TickerEvent, WeatherOut, ReportOut,
} from "@/lib/types";

function getApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "https://bhrakshak-api-demo.loca.lt";
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
      .then(j<Dossier>),

  briefing: (zoneId: string, token: string | null) =>
    fetch(`${B}/api/v1/analytics/briefing-dossier/${zoneId}`, { headers: { ...tunnelHeaders, ...authHeaders(token) } })
      .then(j<{ zone_code: string; briefing_md: string }>),

  weather: (zoneId: string) =>
    fetch(`${B}/api/v1/zones/${zoneId}/weather`, { headers: tunnelHeaders }).then(j<WeatherOut>),

  alerts: (token: string | null) =>
    fetch(`${B}/api/v1/alerts`, { headers: { ...tunnelHeaders, ...authHeaders(token) } }).then(j<AlertRow[]>),

  ackAlert: (id: number, token: string | null) =>
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
      .then(j<PriorityRow[]>),

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
