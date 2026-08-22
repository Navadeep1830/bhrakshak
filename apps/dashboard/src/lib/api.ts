const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MARTIN = process.env.NEXT_PUBLIC_MARTIN_URL ?? "http://localhost:3001";

export const endpoints = { API, MARTIN };

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`API ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

// ---- offline-safe fixture fallbacks (venue WiFi proof) ----
export const FIXTURE_KPIS = {
  zones_l3_l4: 3,
  alerts_today: 5,
  pending_reports: 12,
  sensors_online: 4,
  total_zones: 45,
};

export const FIXTURE_DRIVERS = [
  { feature: "7-day rainfall", value: "412 mm", contribution: 0.21 },
  { feature: "slope", value: "38 deg", contribution: 0.14 },
  { feature: "susceptibility class", value: "High", contribution: 0.12 },
  { feature: "soil moisture", value: "91 %", contribution: 0.09 },
];

export const FIXTURE_RAINFALL = Array.from({ length: 48 }, (_, i) => ({
  ts: new Date(Date.now() - (47 - i) * 3600_000).toISOString(),
  rain_1h: Math.max(0, Math.sin(i / 6) * 8 + i * 0.35),
  rain_24h: 40 + i * 2.2,
}));
