"use client";

import { AlertTriangle, Radio, Siren, Wifi } from "lucide-react";
import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api";
import type { KpisOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export function KpiBar() {
  const [kpis, setKpis] = useState<KpisOut | null>(null);
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
    { icon: Siren, label: "Zones L3/L4", value: kpis?.zones_l3_l4, cls: "text-l4" },
    { icon: Radio, label: "Alerts (24h)", value: kpis?.alerts_today, cls: "text-l2" },
    { icon: AlertTriangle, label: "Reports pending", value: kpis?.pending_reports, cls: "text-l1" },
    { icon: Wifi, label: "Sensors online", value: kpis?.sensors_online, cls: "text-l0" },
  ];

  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-edge bg-panel px-4">
      <div className="flex items-center gap-7">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight">
            Bhu<span className="text-orange-500">Rakshak</span>
          </span>
          <span className="hidden rounded bg-edge px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-muted lg:inline">
            Command Center · NER · SIH26001
          </span>
        </div>
        {items.map(({ icon: Icon, label, value, cls }) => (
          <div key={label} className="hidden items-center gap-2 md:flex">
            <Icon size={15} className={cn(cls, "opacity-80")} />
            <span className={cn("text-lg font-bold tabular-nums", value == null ? "text-muted" : cls)}>
              {value ?? "–"}
            </span>
            <span className="text-[11px] leading-tight text-muted">{label}</span>
          </div>
        ))}
      </div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold",
          live ? "bg-emerald-900/60 text-l0" : "bg-edge text-muted"
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", live ? "animate-pulse bg-l0" : "bg-muted")} />
        {live ? "LIVE" : "FIXTURE MODE"}
      </div>
    </header>
  );
}
