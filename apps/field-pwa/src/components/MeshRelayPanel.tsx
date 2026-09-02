import { useEffect, useRef, useState } from "react";

import { db } from "../db";
import { Icon } from "./ui";

const API = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000";

/* Feature 4 — direct offline image transfer (P2P mesh).

   Two field devices agree on a short session id; the sender pushes WebRTC
   offer/answer + ICE candidates through the API's /api/v1/mesh/signal
   rendezvous (works over the relay peer's hotspot), then streams queued
   reports — photos included — over an RTCDataChannel in 16 KB chunks. The
   receiving peer writes them into its own Dexie queue and syncs. Same-device
   testing works too because the channel falls back to BroadcastChannel. */

const CHUNK = 16 * 1024;

type Role = "idle" | "sender" | "receiver";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.split(",").pop() ?? b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function MeshRelayPanel({ onReceived }: { onReceived?: () => void }) {
  const [role, setRole] = useState<Role>("idle");
  const [session, setSession] = useState(() => localStorage.getItem("bh_mesh_session") ?? "");
  const [peerId] = useState(() => `dev-${crypto.randomUUID().slice(0, 6)}`);
  const [log, setLog] = useState<string[]>([]);
  const [stats, setStats] = useState({ sent: 0, received: 0 });
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<DataChannel | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);

  function say(m: string) { setLog((l) => [`${new Date().toLocaleTimeString()} · ${m}`, ...l].slice(0, 6)); }

  useEffect(() => () => { try { pcRef.current?.close(); bcRef.current?.close(); } catch { /* noop */ } }, []);

  /* ---- transport abstraction: WebRTC preferred, BroadcastChannel fallback ---- */
  class DataChannel {
    constructor(private sendFn: (s: string) => void) {}
    onmessage: ((data: string) => void) | null = null;
    send = (s: string) => this.sendFn(s);
  }

  async function signal(msg: Record<string, unknown>) {
    const login = await fetch(`${API}/api/v1/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "citizen@bhrakshak.in", password: "Citizen@123" }),
    }).then((r) => r.json()).catch(() => ({}));
    if (!login.access_token) throw new Error("signaling needs a login (relay must be online)");
    const r = await fetch(`${API}/api/v1/mesh/signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.access_token}` },
      body: JSON.stringify({ ...msg, sender_id: peerId }),
    });
    if (!r.ok) throw new Error(`signal ${r.status}`);
    return (await r.json()) as { inbox: any[] };
  }

  function transport(mode: "rtc" | "bc") {
    if (mode === "bc") {
      const bc = new BroadcastChannel(`bh-mesh-${session}`);
      bcRef.current = bc;
      const ch = new DataChannel((s) => bc.postMessage(s));
      bc.onmessage = (ev) => ch.onmessage?.(String(ev.data));
      return ch;
    }
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;
    pc.onicecandidate = (ev) => {
      if (ev.candidate) signal({ session_id: session, kind: "candidate", body: JSON.stringify(ev.candidate) }).catch(() => {});
    };
    return null; // channel is attached by the role
  }

  function wireDataChannel(pc: RTCPeerConnection, creating: boolean) {
    const ch = creating ? pc.createDataChannel("bh-media") : undefined;
    if (ch) ch.binaryType = "arraybuffer";
    if (!creating) {
      pc.ondatachannel = (ev) => {
        ev.channel.binaryType = "arraybuffer";
        handlePeerChannel(ev.channel);
      };
    }
    return ch ?? null;
  }

  function handlePeerChannel(ch: RTCDataChannel) {
    const meta: Record<string, any> = {};
    const chunks: any[] = [];
    ch.onmessage = async (ev) => {
      try {
        const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
        const frame = JSON.parse(text);
        if (frame.kind === "manifest") {
          Object.assign(meta, frame.payload);
          say(`receiving "${frame.payload.category ?? "report"}" from ${frame.payload.from ?? "peer"}…`);
        } else if (frame.kind === "chunk") {
          chunks[frame.payload.i] = frame.payload.d;
        } else if (frame.kind === "done") {
          const photo = meta.photo ? chunks.filter(Boolean).join("") : undefined;
          await db.reports.add({
            client_id: meta.client_id ?? crypto.randomUUID(),
            category: meta.category ?? "other",
            lat: meta.lat ?? null, lon: meta.lon ?? null,
            description: meta.description,
            photo_b64: photo,
            status: "pending",
            created_at: new Date().toISOString(),
          });
          ch.send(JSON.stringify({ kind: "ack", payload: { client_id: meta.client_id } }));
          setStats((st) => ({ ...st, received: st.received + 1 }));
          onReceived?.();
          say(`✓ stored ${meta.client_id?.slice(0, 8) ?? "report"} — will sync`);
        } else if (frame.kind === "ack") {
          if (frame.payload?.client_id) {
            await db.reports.update(frame.payload.client_id, { status: "synced" });
            setStats((st) => ({ ...st, sent: st.sent + 1 }));
            say(`✓ peer confirmed ${String(frame.payload.client_id).slice(0, 8)}`);
          }
        }
      } catch { /* ignore malformed frames */ }
    };
  }

  async function startSender() {
    try {
      if (!session) throw new Error("enter the session id shown on the relay device");
      localStorage.setItem("bh_mesh_session", session);
      const pending = await db.reports.where("status").equals("pending").toArray();
      if (!pending.length) { say("queue empty — nothing to send"); return; }
      setRole("sender");

      const useBc = location.protocol === "blob:" || new URLSearchParams(location.search).has("bc");
      if (useBc) {
        const ch = transport("bc") as DataChannel;
        dcRef.current = ch;
        say("BroadcastChannel transport (same-device test)");
        for (const r of pending) await transmit(ch, r);
        return;
      }

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pcRef.current = pc;
      const ch = pc.createDataChannel("bh-media");
      ch.binaryType = "arraybuffer";
      ch.onopen = async () => { say("data channel open — streaming…"); for (const r of pending) await transmitRTC(ch, r); };
      ch.onmessage = (ev) => {
        try {
          const f = JSON.parse(ev.data);
          if (f.kind === "ack" && f.payload?.client_id) {
            db.reports.update(f.payload.client_id, { status: "synced" });
            setStats((st) => ({ ...st, sent: st.sent + 1 }));
            say(`✓ peer confirmed ${String(f.payload.client_id).slice(0, 8)}`);
          }
        } catch { /* noop */ }
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) signal({ session_id: session, kind: "candidate", body: JSON.stringify(ev.candidate) }).catch(() => {});
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await signal({ session_id: session, kind: "offer", body: JSON.stringify(offer) });
      say("offer sent — waiting for relay device…");
      poll(pc);
    } catch (e: any) { say(`✗ ${e?.message ?? e}`); }
  }

  async function poll(pc: RTCPeerConnection, cursor = 0) {
    try {
      const { inbox, cursor: cur } = await (await fetch(
        `${API}/api/v1/mesh/signal/${session}?after=${cursor}&_=${peerId}`,
        { headers: {} }
      ).then((r) => r.json())) as any;
      for (const m of inbox ?? []) {
        if (m.kind === "answer") await pc.setRemoteDescription(JSON.parse(m.body));
        if (m.kind === "candidate") { try { await pc.addIceCandidate(JSON.parse(m.body)); } catch { /* noop */ } }
      }
      if (pc.connectionState !== "connected" && pc.connectionState !== "failed") {
        setTimeout(() => poll(pc, cur ?? cursor), 1500);
      }
    } catch { setTimeout(() => poll(pc, cursor), 2500); }
  }

  async function startReceiver() {
    try {
      if (!session) throw new Error("generate a session id first");
      localStorage.setItem("bh_mesh_session", session);
      setRole("receiver");
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pcRef.current = pc;
      wireDataChannel(pc, false);
      pc.onconnectionstatechange = () => say(`peer connection: ${pc.connectionState}`);

      // answer the sender's offer when it arrives
      let cursor = 0;
      const tick = async () => {
        try {
          const { inbox, cursor: cur } = await (await fetch(
            `${API}/api/v1/mesh/signal/${session}?after=${cursor}`
          ).then((r) => r.json())) as any;
          cursor = cur ?? cursor;
          for (const m of inbox ?? []) {
            if (m.kind === "offer" && !pc.localDescription) {
              await pc.setRemoteDescription(JSON.parse(m.body));
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await signal({ session_id: session, kind: "answer", body: JSON.stringify(answer), to: m.sender_id });
              say("answered sender offer");
            } else if (m.kind === "candidate") {
              try { await pc.addIceCandidate(JSON.parse(m.body)); } catch { /* noop */ }
            }
          }
        } catch { /* relay offline; keep polling */ }
        if (role !== "idle") setTimeout(tick, 1500);
      };
      tick();
      say(`listening as ${peerId} — share session id with the offline device`);
    } catch (e: any) { say(`✗ ${e?.message ?? e}`); }
  }

  async function transmit(ch: DataChannel, r: any) {
    const meta = {
      client_id: r.client_id, category: r.category, lat: r.lat, lon: r.lon,
      description: r.description, photo: !!r.photo_b64, from: peerId,
    };
    ch.send(JSON.stringify({ kind: "manifest", payload: meta }));
    if (r.photo_b64) {
      const bytes = b64ToBytes(r.photo_b64);
      const text = new TextDecoder().decode(bytes);
      const n = Math.ceil(text.length / CHUNK);
      for (let i = 0; i < n; i++) ch.send(JSON.stringify({ kind: "chunk", payload: { i, d: text.slice(i * CHUNK, (i + 1) * CHUNK) } }));
    }
    ch.send(JSON.stringify({ kind: "done", payload: { client_id: r.client_id } }));
    setStats((st) => ({ ...st, sent: st.sent + 1 }));
    say(`sent ${r.client_id.slice(0, 8)}${r.photo_b64 ? " (photo)" : ""}`);
  }

  async function transmitRTC(ch: RTCDataChannel, r: any) {
    const meta = {
      client_id: r.client_id, category: r.category, lat: r.lat, lon: r.lon,
      description: r.description, photo: !!r.photo_b64, from: peerId,
    };
    ch.send(JSON.stringify({ kind: "manifest", payload: meta }));
    if (r.photo_b64) {
      const bin = atob((r.photo_b64.split(",").pop() ?? ""));
      const n = Math.ceil(bin.length / CHUNK);
      for (let i = 0; i < n; i++) ch.send(JSON.stringify({ kind: "chunk", payload: { i, d: bin.slice(i * CHUNK, (i + 1) * CHUNK) } }));
    }
    ch.send(JSON.stringify({ kind: "done", payload: { client_id: r.client_id } }));
    say(`streaming ${r.client_id.slice(0, 8)}${r.photo_b64 ? ` (photo, ${Math.ceil((r.photo_b64.length / 4) * 3 / 1024)} KB)` : ""}`);
  }

  return (
    <section className="md-card md-rise" style={{ animationDelay: ".3s" }}>
      <h3 className="md-card-title">
        <span className="md-ico"><Icon name="share" /></span>Peer Mesh Relay
        {role !== "idle" && (
          <span className="md-badge" style={{ marginLeft: "auto", background: "rgba(52,211,153,.14)", color: "#34d399" }}>
            {role.toUpperCase()}
          </span>
        )}
      </h3>
      <p style={{ fontSize: 12, color: "var(--md-on-surface-variant)", margin: "0 0 10px" }}>
        Send queued photos straight to a connected peer over Wi-Fi Direct / hotspot — no cell signal needed.
      </p>

      <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--md-on-surface-variant)" }}>
        Mesh session
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 6, marginBottom: 12 }}>
        <input className="md-input" placeholder="session id" value={session}
          onChange={(e) => setSession(e.target.value)} style={{ minWidth: 0 }} />
        <button className="md-btn md-btn-outline md-pressable" style={{ padding: "8px 14px" }}
          onClick={() => { const id = crypto.randomUUID().slice(0, 8); setSession(id); localStorage.setItem("bh_mesh_session", id); }}>
          New
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="md-btn md-btn-filled md-pressable" onClick={startSender} disabled={role !== "idle"}>
          <Icon name="upload" size={16} /> Send my queue
        </button>
        <button className="md-btn md-btn-tonal md-pressable" onClick={startReceiver} disabled={role !== "idle"}>
          <Icon name="download" size={16} /> Receive as relay
        </button>
      </div>

      {log.length > 0 && (
        <div style={{ marginTop: 12, background: "var(--md-surface-2)", borderRadius: "var(--md-radius-m)", padding: "10px 12px", fontFamily: "monospace", fontSize: 11.5, lineHeight: 1.7, color: "var(--md-on-surface-variant)" }}>
          {log.map((l, i) => <div key={i} style={{ color: i === 0 ? "var(--md-on-surface)" : undefined }}>{l}</div>)}
        </div>
      )}
      {(stats.sent > 0 || stats.received > 0) && (
        <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12, color: "var(--md-on-surface-variant)" }}>
          <span>▲ sent via mesh: <b style={{ color: "#34d399" }}>{stats.sent}</b></span>
          <span>▼ received: <b style={{ color: "#38bdf8" }}>{stats.received}</b></span>
        </div>
      )}
    </section>
  );
}
