"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { endpoints } from "@/lib/api";
import { useAppStore } from "@/store/useAppStore";

import { DossierDrawer } from "@/components/dossier/DossierDrawer";
import { KpiBar } from "@/components/kpi/KpiBar";
import { LayerRail } from "@/components/map/LayerRail";
import { Ticker } from "@/components/ticker/Ticker";
import { Button } from "@/components/ui/button";

const MapView = dynamic(() => import("@/components/map/MapView"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-muted">loading terrain…</div>,
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
      setTimeout(() => window.location.reload(), 2500);
    } finally {
      setInjecting(false);
    }
  }

  return (
    <main className="flex h-screen flex-col">
      <KpiBar />
      <div className="relative flex-1">
        <MapView />
        <LayerRail />

        {/* Demo control — the judge button */}
        <div className="absolute bottom-4 left-3 z-10 flex items-center gap-3 rounded-lg border border-orange-700 bg-panel/90 p-3 backdrop-blur">
          <Button variant="primary" onClick={injectStorm} disabled={injecting}>
            {injecting ? "Injecting…" : "⛈ Inject Monsoon Cell (Demo)"}
          </Button>
          <span className="text-xs text-muted">
            synthetic extreme rainfall → live pipeline → escalation + alerts
          </span>
          {demoMode && (
            <span className="rounded bg-orange-900 px-2 py-0.5 text-xs font-bold text-orange-300">
              DEMO MODE
            </span>
          )}
        </div>

        <DossierDrawer />
      </div>
      <Ticker />
    </main>
  );
}
