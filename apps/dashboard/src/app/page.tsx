"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { endpoints } from "@/lib/api";
import { DossierDrawer } from "@/components/dossier/DossierDrawer";
import { LayerRail } from "@/components/map/LayerRail";
import { Legend } from "@/components/map/Legend";
import { RadarSlider } from "@/components/map/RadarSlider";
import { useAppStore } from "@/store/useAppStore";

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3 text-muted">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
        <span className="text-sm">loading terrain…</span>
      </div>
    </div>
  ),
});

const DISTRICTS = ["East Khasi Hills", "Noney", "Aizawl", "Gangtok", "Imphal West"];

async function demoLogin(): Promise<string> {
  const res = await fetch(`${endpoints.API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@bhrakshak.in", password: "Admin@123" }),
  }).then((r) => r.json());
  return res.access_token as string;
}

export default function CommandCenter() {
  const setDemoMode = useAppStore((s) => s.setDemoMode);
  const demoMode = useAppStore((s) => s.demoMode);
  const [injecting, setInjecting] = useState(false);
  const [district, setDistrict] = useState("East Khasi Hills");
  const [result, setResult] = useState<string | null>(null);

  async function injectStormFlow() {
    setInjecting(true);
    try {
      const token = await demoLogin();
      const r = (await fetch(`${endpoints.API}/api/v1/demo/inject-rainfall-storm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ district, peak_mm_h: 55, hours: 3 }),
      }).then((x) => x.json())) as {
        zones_injected?: number;
        zones_at_l2_plus?: number;
      };
      setDemoMode(true);
      setResult(
        `${r.zones_injected ?? 0} zones ramped · ${r.zones_at_l2_plus ?? 0} at L2+ — alerts firing`
      );
      setTimeout(() => window.location.reload(), 1800);
    } catch {
      setResult("Storm injection failed — is the API healthy?");
    } finally {
      setInjecting(false);
    }
  }

  async function resetFlow() {
    setInjecting(true);
    try {
      const token = await demoLogin();
      const r = (await fetch(`${endpoints.API}/api/v1/demo/reset-storm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: "{}",
      }).then((x) => x.json())) as { deleted_obs?: number };
      setDemoMode(false);
      setResult(`storm cleared (${r.deleted_obs ?? 0} obs) — hysteresis relaxed`);
      setTimeout(() => window.location.reload(), 1800);
    } catch {
      setResult("Reset failed — is the API healthy?");
    } finally {
      setInjecting(false);
    }
  }

  return (
    <>
      <MapView />
      <LayerRail />
      <Legend />

      {/* Demo control — the judge button */}
      <div
        className="anim anim-fade absolute bottom-4 left-3 z-10 flex items-center gap-3 rounded-xl border border-orange-800 bg-panel/90 p-3 shadow-2xl shadow-black/50 backdrop-blur-md"
        style={{ animationDelay: "0.9s" }}
      >
        <select
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          className="rounded-lg border border-edge bg-bg px-2 py-2 text-[12px] font-semibold text-ink outline-none"
          aria-label="storm district"
        >
          {DISTRICTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button
          onClick={injectStormFlow}
          disabled={injecting}
          className="rounded-lg bg-orange-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-orange-900/40 transition-colors hover:bg-orange-500 disabled:opacity-60"
        >
          {injecting ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Injecting…
            </span>
          ) : (
            "⛈ Inject Monsoon Cell (Demo)"
          )}
        </button>
        <button
          onClick={resetFlow}
          disabled={injecting}
          title="Reset demo state to the seeded monsoon posture"
          className="grid h-9 w-9 place-items-center rounded-lg border border-edge text-muted transition-colors hover:text-ink"
          aria-label="reset demo"
        >
          <RotateCcw size={14} />
        </button>
        <div className="max-w-[240px]">
          <p className="text-[11px] leading-snug text-muted">
            synthetic extreme rainfall → live threshold+hysteresis pipeline → escalation &amp; multilingual alerts
          </p>
          {result && <p className="mt-0.5 text-[10px] font-semibold text-orange-300">{result}</p>}
        </div>
        {demoMode && (
          <span className="animate-pulse rounded-lg bg-orange-900 px-2 py-1 text-[11px] font-bold text-orange-300">
            DEMO MODE
          </span>
        )}
      </div>

      <RadarSlider />
      <DossierDrawer />
    </>
  );
}
