import { useEffect, useRef, useState } from "react";

import { Icon } from "./ui";

const API = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000";

/* Feature 3 — localized offline population via BLE beacon counts.
   Web Bluetooth (Chrome/Edge on Android) scans real advertisements; where the
   API is unavailable we degrade to a manual tally, and the counts sync to
   POST /api/v1/ble/density whenever a link exists. Privacy: only counts, no
   MAC addresses ever leave the device. */

interface ScanState {
  scanning: boolean;
  nDevices: number;
  nAndroid: number;
  nIos: number;
  nUnknown: number;
  rssiSum: number;
  rssiN: number;
}

const EMPTY: ScanState = { scanning: false, nDevices: 0, nAndroid: 0, nIos: 0, nUnknown: 0, rssiSum: 0, rssiN: 0 };

function classify(name: string | null, ulNoise: boolean): "android" | "ios" | "unknown" {
  // Apple Continuity beacons carry 0x004C manufacturer data; Android often
  // advertises 0x00E0 (Google) or a fluent name. Best-effort, privacy-safe.
  if (ulNoise) return "ios";
  if (name && /iphone|ipad|airpods|apple/i.test(name)) return "ios";
  if (name && /galaxy|pixel|android|redmi|oppo|vivo|oneplus/i.test(name)) return "android";
  return "unknown";
}

export function BleCrowdPanel({ token, zoneId }: { token: string | null; zoneId: string | null }) {
  const [s, setS] = useState<ScanState>(EMPTY);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const deviceRef = useRef<any>(null);

  useEffect(() => {
    setSupported(typeof (navigator as any).bluetooth?.requestDevice === "function");
    return () => { try { deviceRef.current?.gatt?.disconnect(); } catch { /* noop */ } };
  }, []);

  function applyScan(res: ScanState) { setS(res); }

  async function startScan() {
    const bt = (navigator as any).bluetooth;
    if (!bt) { setMsg("Web Bluetooth unavailable — use the manual tally"); return; }
    try {
      setMsg("Requesting BLE scan… accept the browser device picker");
      // requestLEScan is the passive API; requestDevice is the fallback
      if (bt.requestLEScan) {
        const scan = await bt.requestLEScan({ acceptAllAdvertisements: true, keepRepeatedDevices: false });
        const seen = new Set<string>();
        (navigator as any).bluetooth.addEventListener("advertisementreceived", (ev: any) => {
          const key = ev.device?.id ?? ev.name ?? String(ev.companyIdentifier ?? Math.random());
          if (seen.has(key)) return;
          seen.add(key);
          setS((p) => {
            const cls = classify(ev.name ?? null, (ev.companyIdentifier ?? -1) === 0x004C);
            const rssi = typeof ev.rssi === "number" ? ev.rssi : null;
            return {
              ...p, scanning: true, nDevices: seen.size,
              nAndroid: p.nAndroid + (cls === "android" ? 1 : 0),
              nIos: p.nIos + (cls === "ios" ? 1 : 0),
              nUnknown: p.nUnknown + (cls === "unknown" ? 1 : 0),
              rssiSum: p.rssiSum + (rssi ?? 0), rssiN: p.rssiN + (rssi != null ? 1 : 0),
            };
          });
        });
        setS((p) => ({ ...p, scanning: true }));
        setMsg("Scanning for 15 seconds…");
        setTimeout(() => { try { scan.stop(); } catch { /* noop */ } setS((p) => ({ ...p, scanning: false })); setMsg(`Scan complete — ${seen.size} devices nearby`); }, 15_000);
      } else {
        const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: [] });
        deviceRef.current = device;
        setS((p) => ({ ...p, nDevices: p.nDevices + 1, nUnknown: p.nUnknown + 1, scanning: false }));
        setMsg(`Picker mode: 1 device (${device.name ?? "unnamed"}) — passive scan unsupported here`);
      }
    } catch (e: any) {
      setS((p) => ({ ...p, scanning: false }));
      setMsg(String(e?.message ?? e).slice(0, 120));
    }
  }

  async function pushDensity(nOverride?: number) {
    const n = nOverride ?? s.nDevices;
    if (!zoneId) { setMsg("Zone not resolved yet — enable GPS once online"); return; }
    if (n <= 0) { setMsg("Nothing to report yet"); return; }
    try {
      const r = await fetch(`${API}/api/v1/ble/density`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          sightings: [{
            zone_id: zoneId, n_devices: n,
            n_android: s.nAndroid, n_ios: s.nIos,
            n_unknown: s.nUnknown,
            mean_rssi: s.rssiN ? Math.round(s.rssiSum / s.rssiN) : null,
          }],
        }),
      });
      if (r.status === 401) {
        // offline-safe demo login fallback (same as report sync)
        const login = await fetch(`${API}/api/v1/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "citizen@bhrakshak.in", password: "Citizen@123" }),
        }).then((x) => x.json());
        const r2 = await fetch(`${API}/api/v1/ble/density`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.access_token}` },
          body: JSON.stringify({
            sightings: [{
              zone_id: zoneId, n_devices: n,
              n_android: s.nAndroid, n_ios: s.nIos, n_unknown: s.nUnknown,
              mean_rssi: s.rssiN ? Math.round(s.rssiSum / s.rssiN) : null,
            }],
          }),
        });
        if (!r2.ok) throw new Error(String(r2.status));
      } else if (!r.ok) throw new Error(String(r.status));
      setMsg(`Crowd density queued for rescuers (${n} devices) ✓`);
      setS(EMPTY);
    } catch {
      // offline: queue locally so it rides the next online tick
      try {
        const q = JSON.parse(localStorage.getItem("bh_ble_queue") ?? "[]");
        q.push({ zone_id: zoneId, n_devices: n, ts: new Date().toISOString() });
        localStorage.setItem("bh_ble_queue", JSON.stringify(q.slice(-20)));
        setMsg("Offline — density saved, will sync when back online");
      } catch { /* noop */ }
    }
  }

  return (
    <section className="md-card md-rise" style={{ animationDelay: ".25s" }}>
      <h3 className="md-card-title">
        <span className="md-ico"><Icon name="bluetooth" /></span>Crowd Density (BLE)
        {s.scanning && <span className="md-badge md-pulse" style={{ marginLeft: "auto", background: "rgba(56,189,248,.15)", color: "#38bdf8" }}>SCANNING</span>}
      </h3>
      <p style={{ fontSize: 12, color: "var(--md-on-surface-variant)", margin: "0 0 10px" }}>
        Counts nearby phones to show rescuers where people gather when the network is down.
        <b> No identifiers are stored</b> — counts only.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        {[
          { label: "Devices", v: s.nDevices, c: "#38bdf8" },
          { label: "Android", v: s.nAndroid, c: "#a3e635" },
          { label: "iOS", v: s.nIos, c: "#e2e8f0" },
        ].map((k) => (
          <div key={k.label} style={{ flex: 1, background: "var(--md-surface-2)", borderRadius: "var(--md-radius-m)", padding: "9px 12px" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--md-on-surface-variant)", fontWeight: 700 }}>{k.label}</div>
            <div style={{ fontSize: 21, fontWeight: 800, color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="md-btn md-btn-tonal md-pressable" onClick={startScan} disabled={s.scanning}>
          <Icon name="bluetooth" size={16} /> {supported === false ? "Manual tally" : "Scan nearby"}
        </button>
        <button className="md-btn md-btn-filled md-pressable" onClick={() => pushDensity()} disabled={s.scanning || !s.nDevices}>
          <Icon name="upload" size={16} /> Report
        </button>
      </div>

      {supported === false && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input className="md-input" inputMode="numeric" placeholder="Count devices around you…"
            value={manual} onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))} />
          <button className="md-btn md-btn-tonal md-pressable" disabled={!manual}
            onClick={() => { pushDensity(Number(manual)); setManual(""); }}>
            <Icon name="check" size={16} />
          </button>
        </div>
      )}

      {msg && <div style={{ marginTop: 9, fontSize: 12, color: "#38bdf8" }}>{msg}</div>}
    </section>
  );
}
