"use client";

import { useEffect, useState } from "react";

import { apiGet, endpoints, FIXTURE_KPIS } from "@/lib/api";
import type { KpisOut } from "@/lib/types";
import { Badge } from "@/components/ui/card";

export function KpiBar() {
  const [kpis, setKpis] = useState<KpisOut>(FIXTURE_KPIS);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      apiGet<KpisOut>("/api/v1/analytics/kpis")
        .then((k) => alive && (setKpis(k), setLive(true)))
        .catch(() => alive && setLive(false));
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const items = [
    { label: "Zones at L3/L4", value: kpis.zones_l3_l4, cls: "text-l4" },
    { label: "Alerts today", value: kpis.alerts_today, cls: "text-l2" },
    { label: "Pending reports", value: kpis.pending_reports, cls: "text-l1" },
    { label: "Sensors online", value: kpis.sensors_online, cls: "text-l0" },
  ];

  return (
    <header className="z-20 flex h-14 items-center justify-between border-b border-edge bg-panel px-4">
      <div className="flex items-center gap-6">
        <div className="text-base font-bold tracking-tight">
          Bhu<span className="text-orange-500">Rakshak</span>
          <span className="ml-2 text-xs font-normal text-muted">Command Center · NER</span>
        </div>
        {items.map((i) => (
          <div key={i.label} className="hidden items-baseline gap-2 md:flex">
            <span className={`text-xl font-bold ${i.cls}`}>{i.value}</span>
            <span className="text-xs text-muted">{i.label}</span>
          </div>
        ))}
      </div>
      <Badge className={live ? "bg-emerald-900 text-l0" : "bg-edge text-muted"}>
        {live ? "LIVE" : "FIXTURE MODE"}
      </Badge>
    </header>
  );
}

export const API_BASE = endpoints.API;
