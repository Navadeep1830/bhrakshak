"use client";
// Live field chat — ported from the repo dashboard, restyled Material 3.
// DEMO MODE: polls the in-memory /api/v1/chat/messages every 3 s (the demo
// API simulates field chatter). LIVE MODE (NEXT_PUBLIC_API_URL): attaches
// the /ws/live WebSocket with reconnect + backoff, polling as fallback.
import { MessageSquare, Send, X, User, MapPin } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api, endpoints } from "@/lib/client/api";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

interface ChatMsg {
  id: string;
  sender_name: string;
  location: string;
  message: string;
  role: string;
  timestamp: string;
}

const LIVE_MODE = !!endpoints.API;

export function ChatWidget() {
  const { token, role, fullName, district } = useAppStore();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const fetchMsgs = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.chatMessages(token);
      if (Array.isArray(data) && data.length) {
        setMessages((prev) => {
          if (prev.length && prev[prev.length - 1]?.id === data[data.length - 1]?.id) return prev;
          if (!openRef.current) setUnread((u) => u + Math.max(0, data.length - prev.length));
          return data;
        });
      }
    } catch {
      /* offline: keep last known messages */
    }
  }, [token]);

  // Initial load + polling (fallback that survives WS hiccups).
  useEffect(() => {
    fetchMsgs();
    const interval = setInterval(fetchMsgs, 3000);
    return () => clearInterval(interval);
  }, [fetchMsgs]);

  // Live WebSocket (live mode only) with reconnect + backoff.
  useEffect(() => {
    if (!LIVE_MODE || !token) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(`${endpoints.API.replace(/^http/, "ws")}/ws/live?token=${encodeURIComponent(token)}`);
      } catch {
        return;
      }
      ws.onopen = () => { retry = 0; setConnected(true); };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m?.type === "chat" && m.message) {
            setMessages((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m as ChatMsg]));
            if (!openRef.current) setUnread((u) => u + 1);
          }
        } catch { /* non-JSON frame */ }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!stopped && ++retry < 6) setTimeout(connect, Math.min(15_000, 1000 * 2 ** retry));
      };
    };
    connect();
    return () => { stopped = true; ws?.close(); };
  }, [token]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput("");
    try {
      const m = await api.chatSend(token, text);
      setMessages((prev) => [...prev, m]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, sender_name: fullName ?? "Me", location: district ?? "NER", message: text, role: role ?? "admin", timestamp: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  };

  if (role === "citizen") return null;

  return (
    <>
      {/* floating chat FAB */}
      <button
        onClick={() => { setOpen((o) => !o); setUnread(0); }}
        aria-label="Field chat"
        className={cn(
          "fixed bottom-16 right-5 z-40 h-14 w-14 rounded-full grid place-items-center elevation-3 state-layer m3-press transition-colors",
          "bg-primary text-on-primary",
        )}
      >
        <MessageSquare className="h-6 w-6" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-5 min-w-5 px-1 rounded-full bg-error text-on-error text-label-sm grid place-items-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {/* chat panel — M3 side panel */}
      {open && (
        <div className="fixed bottom-32 right-5 z-40 w-[min(380px,calc(100vw-2.5rem))] rounded-lg border border-outline-variant/60 bg-surface-low elevation-3 overflow-hidden flex flex-col"
          style={{ maxHeight: "min(520px, calc(100vh - 220px))" }}>
          <header className="flex items-center gap-2.5 px-4 h-14 bg-surface-container border-b border-outline-variant/60 shrink-0">
            <span className="h-9 w-9 rounded-full bg-secondary-container grid place-items-center">
              <MessageSquare className="h-4 w-4 text-on-secondary-container" />
            </span>
            <div className="leading-tight min-w-0">
              <div className="text-title-sm truncate">Field Chat</div>
              <div className="text-label-sm text-on-surface-variant truncate">
                {connected ? "live · ws connected" : LIVE_MODE ? "live · polling 3s" : "demo · polling 3s"}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="ml-auto h-9 w-9 rounded-full grid place-items-center text-on-surface-variant state-layer hover:text-on-surface"
              aria-label="Close chat"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto bhu-scroll p-3 space-y-2.5">
            {messages.map((m) => {
              const mine = m.role === role && m.sender_name === (fullName ?? m.sender_name);
              return (
                <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-lg px-3.5 py-2.5",
                    mine
                      ? "bg-primary-container text-on-primary-container rounded-br-xs"
                      : "bg-surface-container border border-outline-variant/50 text-on-surface rounded-bl-xs",
                  )}>
                    {!mine && (
                      <div className="flex items-center gap-1.5 text-label-sm font-semibold mb-0.5 flex-wrap">
                        <User className="h-3 w-3" /> {m.sender_name}
                        <span className="flex items-center gap-0.5 font-normal opacity-70">
                          <MapPin className="h-2.5 w-2.5" />{m.location}
                        </span>
                      </div>
                    )}
                    <p className="text-body-md leading-relaxed">{m.message}</p>
                    <div className="text-label-sm opacity-60 mt-0.5 text-right">
                      {new Date(m.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <div className="p-3 border-t border-outline-variant/60 flex gap-2 shrink-0 bg-surface-low">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Message field teams…"
              className="flex-1 h-10 rounded-full bg-surface-container border border-outline-variant/60 px-4 text-body-md outline-none focus:border-primary placeholder:text-on-surface-variant/60"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              aria-label="Send"
              className="h-10 w-10 rounded-full grid place-items-center bg-primary text-on-primary state-layer m3-press disabled:opacity-40 shrink-0"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default ChatWidget;
