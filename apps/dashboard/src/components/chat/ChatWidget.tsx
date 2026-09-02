"use client";

import { MessageSquare, Send, X, User, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { endpoints } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ChatMsg {
  id: string;
  sender_name: string;
  location: string;
  message: string;
  role: string;
  timestamp: string;
}

const WS_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace("http", "ws");

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [unread, setUnread] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchMsgs = () => {
      fetch(`${endpoints.API}/api/v1/chat/messages`, {
        headers: { "Bypass-Tunnel-Remainder": "true" },
      })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) {
            const list = data.reverse();
            setMessages(list);
          }
        })
        .catch(() => {});
    };

    fetchMsgs();
    const interval = setInterval(fetchMsgs, 3000);

    // Live WebSocket listener
    let ws: WebSocket | null = null;
    try {
      const getWs = () => {
        if (typeof window !== "undefined" && window.location.protocol === "https:") {
          return "wss://bhrakshak-api-demo.loca.lt/ws/live";
        }
        return `${WS_URL}/ws/live`;
      };
      ws = new WebSocket(getWs());
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "chat_message") {
            fetchMsgs();
            setUnread((u) => u + 1);
          }
        } catch {}
      };
    } catch {}

    return () => {
      clearInterval(interval);
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (open) {
      setUnread(0);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [open, messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const txt = input.trim();
    setInput("");

    const newMsg: ChatMsg = {
      id: String(Date.now()),
      sender_name: "DC Command Center (HQ)",
      location: "East Khasi Hills HQ",
      message: txt,
      role: "admin",
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMsg]);

    try {
      await fetch(`${endpoints.API}/api/v1/chat/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Bypass-Tunnel-Remainder": "true",
        },
        body: JSON.stringify(newMsg),
      });
    } catch {}
  };

  return (
    <div className="fixed bottom-12 right-5 z-50 flex flex-col items-end">
      {open ? (
        <div className="anim anim-fade flex h-[460px] w-96 flex-col overflow-hidden rounded-2xl border border-orange-500/30 bg-panel/95 shadow-2xl shadow-black/80 backdrop-blur">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-edge bg-orange-950/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <span className="text-sm font-bold text-ink">Field Emergency Chat</span>
              <span className="rounded bg-orange-600/30 px-1.5 py-0.5 text-[9px] font-bold text-orange-300">
                LIVE
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-muted transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 [scrollbar-width:thin]">
            {messages.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted">
                No field messages yet. Mobile app messages appear here in real-time.
              </div>
            ) : (
              messages.map((m, i) => {
                const isHq = m.role === "admin" || m.sender_name.includes("HQ") || m.sender_name.includes("DC");
                return (
                  <div
                    key={m.id || i}
                    className={cn(
                      "flex flex-col max-w-[85%] rounded-xl p-3 text-xs leading-relaxed shadow-md",
                      isHq
                        ? "ml-auto bg-orange-600/20 text-orange-100 border border-orange-500/40 rounded-br-none"
                        : "mr-auto bg-slate-800/90 text-slate-100 border border-slate-700 rounded-bl-none"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1 mb-1">
                      <span className="font-bold flex items-center gap-1 text-[11px] text-orange-300">
                        <User size={11} /> {m.sender_name}
                      </span>
                      <span className="text-[9px] text-slate-400">
                        {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[10px] font-mono text-sky-400 mb-1">
                      <MapPin size={10} /> {m.location || "Field Location"}
                    </div>

                    <p className="text-[12px]">{m.message}</p>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input Bar */}
          <div className="border-t border-edge bg-bg/80 p-2.5 flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Reply to field team..."
              className="flex-1 rounded-xl border border-edge bg-panel px-3 py-2 text-xs text-ink placeholder:text-muted focus:border-orange-500 focus:outline-none"
            />
            <button
              onClick={handleSend}
              className="grid h-9 w-9 place-items-center rounded-xl bg-orange-600 text-white transition-all hover:bg-orange-500 shadow-md shadow-orange-950"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="relative flex items-center gap-2 rounded-full border border-orange-500/40 bg-orange-600 px-4 py-2.5 text-xs font-bold text-white shadow-xl shadow-orange-950/80 transition-all hover:scale-105 active:scale-95"
        >
          <MessageSquare size={16} />
          <span>Field Emergency Chat</span>
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-red-600 text-[10px] font-black text-white ring-2 ring-panel">
              {unread}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
