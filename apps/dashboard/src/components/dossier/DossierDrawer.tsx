"use client";

import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";

import { apiGet, FIXTURE_DRIVERS, FIXTURE_RAINFALL } from "@/lib/api";
import { LEVEL_COLORS, LEVEL_NAMES } from "@/lib/utils";
import type { Dossier } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";

function useZoneId(): string | null {
  return useAppStore((s) => s.selectedZoneId);
}

export function DossierDrawer() {
  const zoneId = useZoneId();
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!zoneId) return setOpen(false);
    setOpen(true);
    apiGet<Dossier>(`/api/v1/zones/${zoneId}/dossier`)
      .then(setDossier)
      .catch(() => setDossier(null));
  }, [zoneId]);

  if (!open) return null;
  const level = dossier?.zone.hazard_level ?? 0;
  const drivers =
    dossier?.drivers?.map((d) => ({ ...d })) ?? FIXTURE_DRIVERS;

  return (
    <aside className="absolute right-0 top-14 z-20 flex h-[calc(100%-3.5rem)] w-96 flex-col overflow-y-auto border-l border-edge bg-panel">
      <div className="flex items-start justify-between border-b border-edge p-4">
        <div>
          <div className="text-xs text-muted">{dossier?.zone.district ?? "loading…"}</div>
          <div className="text-lg font-bold">{dossier?.zone.zone_code ?? zoneId}</div>
          <div className="mt-2 inline-flex items-center gap-2">
            <span
              className="rounded px-2 py-0.5 text-sm font-bold text-bg"
              style={{ background: LEVEL_COLORS[level] }}
            >
              L{level} {LEVEL_NAMES[level]}
            </span>
            <span className="text-xs text-muted">↑ trend</span>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink">
          ✕
        </button>
      </div>

      <section className="p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-orange-400">
          Why this risk (SHAP)
        </h3>
        <ReactECharts
          style={{ height: 220 }}
          option={{
            grid: { left: 110, right: 30, top: 10, bottom: 20 },
            xAxis: { type: "value", axisLabel: { color: "#64748B" } },
            yAxis: {
              type: "category",
              data: drivers.map((d) => `${d.feature} (${d.value})`).reverse(),
              axisLabel: { color: "#E2E8F0", fontSize: 11 },
            },
            series: [
              {
                type: "bar",
                data: [...drivers].reverse().map((d) => ({
                  value: d.contribution,
                  itemStyle: {
                    color: d.contribution >= 0 ? "#EF4444" : "#22C55E",
                  },
                })),
                label: { show: true, position: "right", color: "#94A3B8", fontSize: 10 },
              },
            ],
            tooltip: { trigger: "axis" },
          }}
        />
      </section>

      <section className="border-t border-edge p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-orange-400">
          Rainfall vs threshold
        </h3>
        <ReactECharts
          style={{ height: 180 }}
          option={{
            grid: { left: 40, right: 10, top: 10, bottom: 24 },
            xAxis: {
              type: "category",
              data: (dossier?.rainfall_series.length ? dossier.rainfall_series : FIXTURE_RAINFALL).map(
                (r) => new Date(r.ts).getHours() + ":00"
              ),
              axisLabel: { color: "#64748B" },
            },
            yAxis: { type: "value", axisLabel: { color: "#64748B" } },
            series: [
              {
                type: "line",
                name: "24h cum.",
                smooth: true,
                showSymbol: false,
                data: (dossier?.rainfall_series.length ? dossier.rainfall_series : FIXTURE_RAINFALL).map(
                  (r) => r.rain_24h ?? r.rain_1h
                ),
                lineStyle: { color: "#38BDF8" },
                areaStyle: { opacity: 0.15 },
              },
              {
                type: "line",
                name: "L3 threshold",
                data: Array(48).fill(120),
                lineStyle: { color: "#EF4444", type: "dashed" },
                symbol: "none",
              },
            ],
            legend: { textStyle: { color: "#94A3B8" }, top: -4 },
          }}
        />
      </section>

      <section className="grid grid-cols-2 gap-3 border-t border-edge p-4 text-sm">
        <Stat label="Population exposed" value={(dossier?.zone.population ?? 8200).toLocaleString()} />
        <Stat label="Road km in zone" value={`${dossier?.zone.road_km ?? 12.4} km`} />
        <Stat label="Susceptibility mean" value={`${Math.round(dossier?.zone.susc_mean ?? 72)} / 100`} />
        <Stat label="Verified reports (7d)" value={String(dossier?.reports.length ?? 3)} />
      </section>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-bg/60 p-2.5">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
