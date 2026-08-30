"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { endpoints } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";

import { DossierDrawer } from "@/components/dossier/DossierDrawer";
import { LayerRail } from "@/components/map/LayerRail";
import { Legend } from "@/components/map/Legend";
import { RadarSlider } from "@/components/map/RadarSlider";
import { Button } from "@/components/ui/button";

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

export default function CommandCenter() {
  const setDemoMode = useAppStore((s) => s.setDemoMode);
  const demoMode = useAppStore((s) => s.demoMode);
  const [injecting, setInjecting] = useState(false);

  async function injectStorm() {
    setInjecting(true);
    try {
      const login = await fetch(`${endpoints.API}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@bhrakshak.in", password: "Admin@123" }),
      }).then((r) => r.json());
      await fetch(`${endpoints.API}/api/v1/demo/inject-rainfall-storm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.access_token}` },
        body: JSON.stringify({ district: "East Khasi Hills", peak_mm_h: 55, hours: 3 }),
      });
      setDemoMode(true);
      setTimeout(() => window.location.reload(), 2200);
    } catch {
      alert("Storm injection failed — is the API up at :8000?");
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
      <div className="anim anim-fade absolute bottom-4 left-3 z-10 flex items-center gap-3 rounded-xl border border-orange-800 bg-panel/90 p-3 shadow-2xl shadow-black/50 backdrop-blur-md" style={{ animationDelay: "0.9s" }}>
        <Button variant="primary" size="lg" onClick={injectStorm} disabled={injecting}>
          {injecting ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Injecting…
            </span>
          ) : (
            "⛈ Inject Monsoon Cell (Demo)"
          )}
        </Button>
        <p className="max-w-[240px] text-[11px] leading-snug text-muted">
          synthetic extreme rainfall → live threshold+hysteresis pipeline → escalation &amp;
          multilingual alerts
        </p>
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
