import { useEffect, useRef, useState } from "react";

import { Icon, LEVEL_COLORS, LEVEL_NAMES } from "./ui";

const API = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000";

export interface LiveAlert {
  id: string;
  level: number;
  message: string;
  zone_code?: string;
  district?: string | null;
  fired_at: string;
  lang?: string;
  channels?: string[];
}

const CACHE_KEY = "bh_alerts_cache";

function loadCache(): LiveAlert[] {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]"); } catch { return []; }
}

function saveCache(list: LiveAlert[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(0, 30))); } catch { /* noop */ }
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function AlertsPanel({ online, onLiveAlert }: { online: boolean; onLiveAlert?: (a: LiveAlert) => void }) {
  const [alerts, setAlerts] = useState<LiveAlert[]>(loadCache);
  const [wsOk, setWsOk] = useState(false);
  const spokeRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    // initial fetch (online only); cache keeps it visible offline
    fetch(`${API}/api/v1/alerts?limit=25`)
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => {
        if (!alive || !rows?.length) return;
        const mapped: LiveAlert[] = rows.map((a: any) => ({
          id: String(a.id), level: a.level, message: a.message_en ?? a.message_template ?? "",
          zone_code: a.zone_code, district: a.district, fired_at: a.fired_at, lang: a.lang,
        }));
        setAlerts(mapped);
        saveCache(mapped);
      })
      .catch(() => {});

    // live feed
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    const connect = () => {
      try {
        ws = new WebSocket(`${API.replace(/^http/, "ws")}/ws/live`);
        ws.onopen = () => alive && setWsOk(true);
        ws.onclose = () => { alive && setWsOk(false); retry = window.setTimeout(connect, 5000); };
        ws.onerror = () => ws?.close();
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data);
            if (d.type === "alert") {
              const a: LiveAlert = {
                id: `live-${Date.now()}`, level: d.level ?? 0,
                message: d.message ?? "", zone_code: d.zone_code,
                district: d.district ?? null, fired_at: new Date().toISOString(),
                channels: d.channels,
              };
              setAlerts((l) => {
                const next = [a, ...l].slice(0, 30);
                saveCache(next);
                return next;
              });
              onLiveAlert?.(a);
            } else if (d.type === "allclear") {
              setAlerts((l) => l); // severity displayed per alert; allclear events keep feed alive
            }
          } catch { /* heartbeat / non-json */ }
        };
      } catch { setWsOk(false); }
    };
    connect();
    return () => { alive = false; ws?.close(); if (retry) clearTimeout(retry); };
  }, [online]);

  function speak(a: LiveAlert) {
    if (!window.speechSynthesis) return;
    if (spokeRef.current.has(a.id)) return;
    spokeRef.current.add(a.id);
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(a.message);
    u.lang = "en-IN";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  return (
    <section className="md-card md-card-elevated md-rise" style={{ animationDelay: ".15s", borderColor: alerts[0] && alerts[0].level >= 3 ? "rgba(248,113,113,.55)" : undefined }}>
      <h3 className="md-card-title">
        <span className="md-ico" style={{ color: "#f87171" }}><Icon name="alert" /></span>
        Early Warnings
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, color: wsOk ? "#34d399" : "var(--md-on-surface-variant)" }}>
          <span className={wsOk ? "md-pulse" : undefined}>●</span> {wsOk ? "LIVE" : online ? "CONNECTING" : "OFFLINE CACHE"}
        </span>
      </h3>

      {alerts.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--md-on-surface-variant)", margin: 0 }}>
          No warnings for your area. You will hear a voice alert here the moment the district command escalates your zone.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
        {alerts.slice(0, 10).map((a) => (
          <div key={a.id} className="md-pressable" style={{
            display: "flex", gap: 12, alignItems: "flex-start",
            background: "var(--md-surface-2)", borderRadius: "var(--md-radius-m)",
            padding: "11px 13px", borderLeft: `4px solid ${LEVEL_COLORS[Math.min(a.level, 4)]}`,
          }}>
            <div style={{ minWidth: 44 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: LEVEL_COLORS[Math.min(a.level, 4)] }}>L{a.level}</div>
              <div style={{ fontSize: 10, color: "var(--md-on-surface-variant)" }}>{LEVEL_NAMES[Math.min(a.level, 4)]}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, lineHeight: 1.45 }}>{a.message || "Risk update received."}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 5, fontSize: 10.5, color: "var(--md-on-surface-variant)" }}>
                {a.zone_code && <span>{a.zone_code}</span>}
                <span>{timeAgo(a.fired_at)}</span>
                {a.channels?.length ? <span>via {a.channels.join(" · ")}</span> : null}
              </div>
            </div>
            <button
              aria-label="read aloud"
              onClick={(e) => { e.stopPropagation(); spokeRef.current.delete(a.id); speak(a); }}
              className="md-pressable"
              style={{ border: "none", background: "transparent", color: "var(--md-on-surface-variant)", cursor: "pointer", padding: 6, borderRadius: 8 }}
            >
              <Icon name="volume" size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
