import { useEffect, useMemo, useState } from "react";

import { Icon, LEVEL_COLORS } from "./ui";

const API = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000";

interface WeatherNow {
  rain_1h_mm: number | null;
  rain_24h_mm: number | null;
  rain_72h_mm: number | null;
  rain_7d_mm: number | null;
  eff_rain_mm: number | null;
  soil_moisture_pct: number | null;
  trend: string | null;
}
interface IdCheck {
  exceeded: boolean;
  severity: string | null;
  rain_1h: number | null;
  rain_24h: number | null;
  threshold_rain_1h: number | null;
  threshold_rain_24h: number | null;
  margin_mm: number | null;
}
interface ZoneWeather {
  zone_code: string;
  district: string | null;
  has_data: boolean;
  current?: WeatherNow;
  id_threshold_check?: IdCheck | null;
  series?: { ts: string; rain_1h: number | null; rain_24h: number | null }[];
  note?: string;
}

function Spark({ values, height = 40, color = "#38bdf8" }: { values: number[]; height?: number; color?: string }) {
  const pts = useMemo(() => {
    if (values.length < 2) return null;
    const max = Math.max(...values, 0.001);
    const w = 100;
    return values
      .map((v, i) => `${(i / (values.length - 1)) * w},${height - (v / max) * (height - 4) - 2}`)
      .join(" ");
  }, [values, height]);
  if (!pts) return null;
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      <polyline points={`0,${height} ${pts} 100,${height}`} fill={color} opacity="0.12" stroke="none" />
    </svg>
  );
}

function Gauge({ label, mm, sub, accent }: { label: string; mm: number | null; sub?: string; accent?: string }) {
  return (
    <div style={{ flex: "1 1 0", minWidth: 84 }}>
      <div style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--md-on-surface-variant)", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15, color: accent ?? "var(--md-on-surface)" }}>
        {mm == null ? "–" : mm.toFixed(1)}
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--md-on-surface-variant)", marginLeft: 3 }}>mm</span>
      </div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--md-on-surface-variant)" }}>{sub}</div>}
    </div>
  );
}

export function RainGaugePanel({ token, onZoneResolved }: { token: string | null; onZoneResolved?: (z: { id: string; name: string; hazard_level: number } | null) => void }) {
  const [w, setW] = useState<ZoneWeather | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // resolve nearest zone from device coords (cached for offline)
      let zid = localStorage.getItem("bh_zone_id");
      if (!zid) {
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) =>
            navigator.geolocation?.getCurrentPosition(res, rej, { timeout: 6000 }));
          const c = pos.coords;
          const zones = await fetch(
            `${API}/api/v1/zones?bbox=${c.longitude - 0.35},${c.latitude - 0.35},${c.longitude + 0.35},${c.latitude + 0.35}`
          ).then((r) => r.json());
          if (zones?.length) {
            zid = zones[0].id;
            localStorage.setItem("bh_zone_id", zid!);
            localStorage.setItem("bh_zone_name", zones[0].name ?? zones[0].zone_code);
            if (alive && onZoneResolved) onZoneResolved(zones[0]);
          }
        } catch { /* offline or no gps — cached values still render */ }
      }
      if (!alive || !zid) return;
      try {
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const data = await fetch(`${API}/api/v1/zones/${zid}/weather`, { headers }).then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        });
        if (alive) { setW(data); setZoneId(zid); setErr(false); }
      } catch {
        if (alive) setErr(true);
      }
    })();
    const t = setInterval(() => {
      if (navigator.onLine && zoneId) {
        fetch(`${API}/api/v1/zones/${zoneId}/weather`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setW(d))
          .catch(() => {});
      }
    }, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);

  if (err || !w || !w.has_data) {
    return (
      <section className="md-card md-rise" style={{ animationDelay: ".05s" }}>
        <h3 className="md-card-title"><span className="md-ico"><Icon name="rain" /></span>Live Rain Gauge</h3>
        <p style={{ fontSize: 13, color: "var(--md-on-surface-variant)", margin: 0 }}>
          {err || !w ? "No gauge link — last known values will appear when the station syncs." : (w as ZoneWeather).note}
        </p>
      </section>
    );
  }

  const cur = w.current!;
  const series = w.series ?? [];
  const hourly = series.slice(-24).map((s) => s.rain_1h ?? 0);
  const idc = w.id_threshold_check;
  const breach = idc?.exceeded;
  const soil = cur.soil_moisture_pct;
  const trendIcon = cur.trend === "rising" ? "▲" : cur.trend === "falling" ? "▼" : "■";
  const trendColor = cur.trend === "rising" ? "#f87171" : cur.trend === "falling" ? "#34d399" : "var(--md-on-surface-variant)";

  return (
    <section className="md-card md-rise" style={{ animationDelay: ".05s", borderColor: breach ? "rgba(248,113,113,.5)" : undefined }}>
      <h3 className="md-card-title">
        <span className="md-ico"><Icon name="rain" /></span>Live Rain Gauge
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: trendColor, fontWeight: 800 }}>
          <span>{trendIcon}</span> {cur.trend ?? "steady"}
        </span>
      </h3>

      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <Gauge label="Last hour" mm={cur.rain_1h_mm} accent={breach ? "#f87171" : undefined}
          sub={cur.rain_1h_mm != null && idc?.threshold_rain_1h ? `threshold ${idc.threshold_rain_1h}` : undefined} />
        <Gauge label="24 hours" mm={cur.rain_24h_mm}
          sub={cur.rain_24h_mm != null && idc?.threshold_rain_24h ? `threshold ${idc.threshold_rain_24h}` : undefined} />
        <Gauge label="72 hours" mm={cur.rain_72h_mm} />
      </div>

      {hourly.length > 3 && <Spark values={hourly} />}

      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--md-on-surface-variant)", marginBottom: 4 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="soil" size={13} /> Soil moisture
          </span>
          <b style={{ color: soil != null && soil > 60 ? "#fb923c" : "var(--md-on-surface)" }}>
            {soil != null ? `${soil.toFixed(0)}%` : "n/a"}
          </b>
        </div>
        <div className="md-meter">
          <div style={{ width: `${Math.min(soil ?? 0, 100)}%`, background: "linear-gradient(90deg,#38bdf8,#f97316)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--md-on-surface-variant)", marginTop: 3 }}>
          <span>Antecedent (K-L) index: {cur.eff_rain_mm != null ? `${cur.eff_rain_mm.toFixed(0)} mm` : "n/a"}</span>
          <span>7-day: {cur.rain_7d_mm != null ? `${cur.rain_7d_mm.toFixed(0)} mm` : "n/a"}</span>
        </div>
      </div>

      {idc && (
        <div className="md-badge" style={{
          marginTop: 12,
          background: breach ? "rgba(248,113,113,.15)" : "rgba(52,211,153,.13)",
          color: breach ? "#f87171" : "#34d399",
          border: `1px solid ${breach ? "rgba(248,113,113,.4)" : "rgba(52,211,153,.35)"}`,
        }}>
          <span className={breach ? "md-pulse" : undefined}>●</span>
          {breach
            ? `I-D THRESHOLD EXCEEDED (${idc.severity ?? "trigger"})`
            : "I-D threshold: stable · margin " + (idc.margin_mm != null ? `${idc.margin_mm.toFixed(0)} mm` : "–")}
        </div>
      )}
    </section>
  );
}
