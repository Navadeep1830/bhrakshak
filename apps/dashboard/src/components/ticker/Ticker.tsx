"use client";

import { useEffect, useRef, useState } from "react";

import { LEVEL_COLORS } from "@/lib/utils";
import type { TickerEvent } from "@/lib/types";

const WS_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace("http", "ws");

export function Ticker() {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    const connect = () => {
      const ws = new WebSocket(`${WS_URL}/ws/live`);
      wsRef.current = ws;
      ws.onmessage = (m) => {
        try {
          const ev: TickerEvent = JSON.parse(m.data);
          if (ev.type === "heartbeat") return;
          setEvents((prev) => [{ ...ev, ts: new Date().toISOString() }, ...prev].slice(0, 30));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => alive && setTimeout(connect, 3000);
    };
    connect();
    return () => {
      alive = false;
      wsRef.current?.close();
    };
  }, []);

  return (
    <footer className="z-20 flex h-9 items-center gap-3 overflow-hidden border-t border-edge bg-panel px-4 text-xs">
      <span className="shrink-0 font-bold uppercase tracking-wider text-orange-400">Live feed</span>
      <div className="flex gap-6 overflow-hidden whitespace-nowrap">
        {events.length === 0 && <span className="text-muted">connected — waiting for events…</span>}
        {events.map((e, i) => (
          <span key={i} className="text-muted">
            {e.ts && <time className="mr-1">{new Date(e.ts).toLocaleTimeString()}</time>}
            {e.type === "alert" ? (
              <>
                <b style={{ color: LEVEL_COLORS[e.level ?? 0] }}>L{e.level}</b>{" "}
                {e.message ?? `${e.zone_code} escalated`}
              </>
            ) : e.type === "risk_diff" ? (
              <>
                {e.zone_code}: L{e.level}
              </>
            ) : (
              JSON.stringify(e).slice(0, 90)
            )}
          </span>
        ))}
      </div>
    </footer>
  );
}
