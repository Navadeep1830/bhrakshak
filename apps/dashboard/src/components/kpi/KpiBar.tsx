"use client";
// KPI bar — 5 live metrics over the map (Material 3 tonal cards).
import { TriangleAlert, BellRing, Inbox, Wifi, LayoutGrid } from "lucide-react";
import { usePoll } from "@/hooks/use-poll";
import { api } from "@/lib/client/api";
import type { KpisOut } from "@/lib/types";
import { cn } from "@/lib/utils";

const CARDS: {
  key: keyof KpisOut; label: string; icon: any; hint: string;
  danger?: (v: number) => boolean;
}[] = [
  { key: "zones_l3_l4", label: "Zones L3/L4", icon: TriangleAlert, hint: "warning + emergency", danger: (v) => v > 0 },
  { key: "alerts_today", label: "Alerts (24h)", icon: BellRing, hint: "SMS / app / IVR / siren", danger: (v) => v > 25 },
  { key: "pending_reports", label: "Pending reports", icon: Inbox, hint: "awaiting verification" },
  { key: "sensors_online", label: "IoT sensors", icon: Wifi, hint: "soil-moisture mesh" },
  { key: "total_zones", label: "Response zones", icon: LayoutGrid, hint: "6 NER districts" },
];

export default function KpiBar() {
  const { data } = usePoll<KpisOut>(api.kpis, 6000);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {CARDS.map(({ key, label, icon: Icon, hint, danger }) => {
        const v = data?.[key] ?? 0;
        const isDanger = danger?.(v) ?? false;
        return (
          <div
            key={key}
            className={cn(
              "rounded-lg border p-3.5 flex items-center gap-3.5 elevation-1 transition-shadow duration-200 hover:elevation-2",
              isDanger
                ? "bg-error-container border-outline-variant/60 text-on-error-container"
                : "bg-surface-low border-outline-variant/60 text-on-surface",
            )}
          >
            <div
              className={cn(
                "h-11 w-11 rounded-full grid place-items-center shrink-0",
                isDanger ? "bg-error text-on-error" : "bg-secondary-container text-on-secondary-container",
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-headline-sm font-medium leading-none tabular-nums">{v}</div>
              <div className="text-label-md text-on-surface-variant truncate">{label}</div>
              <div className="text-label-sm text-on-surface-variant/60 truncate">{hint}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
