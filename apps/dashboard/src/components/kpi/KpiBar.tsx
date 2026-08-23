"use client";

import { AlertTriangle, Radio, Siren, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { apiGet } from "@/lib/api";
import type { KpisOut } from "@/lib/types";
import { cn } from "@/lib/utils";

function useCountUp(target: number | null | undefined, duration = 1100) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (target == null) return;
    const from = prev.current;
    const t0 = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function Stat({ icon: Icon, label, value, cls }: {
  icon: typeof Siren; label: string; value: number | null; cls: string;
}) {
  const n = useCountUp(value);
  return (
    <div className="hidden items-center gap-2.5 md:flex">
      <span className={cn("grid h-8 w-8 place-items-center rounded-lg bg-bg/80 ring-1 ring-edge", cls)}>
        <Icon size={15} />
      </span>
      <div className="leading-none">
        <div className={cn("text-lg font-bold tabular-nums tracking-tight", cls)}>
          {value == null ? "–" : Math.round(n).toLocaleString()}
        </div>
        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-muted">{label}</div>
      </div>
    </div>
  );
}

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
    return () => { alive = false; clearInterval(t); };
  }, []);

  const items = [
    { icon: Siren, label: "Zones L3/L4", value: kpis?.zones_l3_l4 ?? null, cls: "text-l4" },
    { icon: Radio, label: "Alerts (24h)", value: kpis?.alerts_today ?? null, cls: "text-l2" },
    { icon: AlertTriangle, label: "Reports pending", value: kpis?.pending_reports ?? null, cls: "text-l1" },
    { icon: Wifi, label: "Sensors online", value: kpis?.sensors_online ?? null, cls: "text-l0" },
  ];

  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-panel px-4">
      <div className="flex items-center gap-7">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-extrabold tracking-tight">
            Bhu<span className="text-orange-500">Rakshak</span>
            <span className="font-playfair italic text-muted"> · भूरक्षक</span>
          </span>
          <span className="hidden rounded-full bg-edge px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-muted lg:inline">
            MDoNER · SIH26001
          </span>
        </div>
        {items.map(({ icon, label, value, cls }) => (
          <Stat key={label} icon={icon} label={label} value={value} cls={cls} />
        ))}
      </div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold ring-1",
          live ? "bg-emerald-950/70 text-l0 ring-l0/30" : "bg-edge/60 text-muted ring-white/10"
        )}
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", live ? "glow-pulse bg-l0" : "bg-muted")} />
        {live ? "LIVE" : "FIXTURE MODE"}
      </div>
    </header>
  );
}
