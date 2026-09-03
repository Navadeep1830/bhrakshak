"use client";

import { useEffect, useRef, useState } from "react";

import { LEVEL_COLORS } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { TickerEvent } from "@/lib/types";

function getWsUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace("http", "ws");
  }
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    return "wss://bhrakshak-api-demo.loca.lt";
  }
  return "ws://localhost:8000";
}

export function Ticker() {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const demoMode = useAppStore((s) => s.demoMode);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      try {
        const wsUrl = getWsUrl();
        const ws = new WebSocket(`${wsUrl}/ws/live`);
        wsRef.current = ws;
        ws.onmessage = (m) => {
          try {
            const ev: TickerEvent = JSON.parse(m.data);
            if (ev.type === "heartbeat") return;
            setEvents((prev) =>
              [{ ...ev, ts: new Date().toISOString() }, ...prev].slice(0, 30)
            );
          } catch {
            /* ignore */
          }
        };
        ws.onclose = () => {
          if (alive) retry = setTimeout(connect, 3000);
        };
      } catch {
        retry = setTimeout(connect, 3000);
      }
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  return (
    <footer className="z-20 flex h-10 shrink-0 items-center gap-3 overflow-hidden border-t border-edge bg-panel px-4 text-xs">
      <span className="flex shrink-0 items-center gap-1.5 font-bold uppercase tracking-widest text-orange-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
        Live feed
        {demoMode && (
          <span className="ml-1 rounded bg-orange-900/80 px-1.5 py-0.5 text-[9px] tracking-normal text-orange-300">
            DEMO MODE
          </span>
        )}
      </span>
      <div className="flex flex-1 gap-6 overflow-hidden whitespace-nowrap">
        {events.length === 0 && (
          <span className="text-muted">connected — inject a storm or wait for sensor events…</span>
        )}
        {events.map((e, i) => (
          <span key={i} className="text-muted">
            {e.ts && <time className="mr-1.5 tabular-nums">{new Date(e.ts).toLocaleTimeString()}</time>}
            {e.type === "alert" ? (
              <span>
                <b style={{ color: LEVEL_COLORS[e.level ?? 0] }}>L{e.level}</b>{" "}
                <span className="text-slate-200">{e.name ?? e.zone_code}:</span> {e.message}
              </span>
            ) : e.type === "risk_diff" ? (
              <span>
                risk update · {e.zone_code} → L{e.level}
              </span>
            ) : e.type === "sensor" ? (
              <span>
                📡 sensor ping · {JSON.stringify(e).slice(0, 70)}…
              </span>
            ) : (
              JSON.stringify(e).slice(0, 90)
            )}
          </span>
        ))}
      </div>
    </footer>
  );
}
