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

const ACTIONS_BY_LEVEL: Record<number, [string, string]> = {
  0: ["Normal ops", "Routine monitoring; no action required."],
  1: ["Watch", "Field teams on standby; monitor rainfall updates."],
  2: ["Alert", "Notify ward volunteers; inspect known crack zones."],
  3: ["Warning", "Pre-position JCB & rescue kit; brief DC control room."],
  4: ["Emergency", "Begin evacuation via marked routes; sirens active."],
};

export function DossierDrawer() {
  const zoneId = useZoneId();
  const selectZone = useAppStore((s) => s.selectZone);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!zoneId) return setOpen(false);
    setOpen(true);
    setDossier(null);
    apiGet<Dossier>(`/api/v1/zones/${zoneId}/dossier`)
      .then(setDossier)
      .catch(() => setDossier(null));
  }, [zoneId]);

  if (!open) return null;
  const level = dossier?.zone.hazard_level ?? 0;
  const drivers = dossier?.drivers?.length ? dossier.drivers : FIXTURE_DRIVERS;
  const rain = dossier?.rainfall_series.length ? dossier.rainfall_series : FIXTURE_RAINFALL;
  const [actionTitle, actionBody] = ACTIONS_BY_LEVEL[level] ?? ACTIONS_BY_LEVEL[0];

  return (
    <aside className="absolute right-0 top-14 z-20 flex h-[calc(100%-3.5rem)] w-96 flex-col overflow-y-auto border-l border-edge bg-panel shadow-2xl shadow-black/50 [scrollbar-width:thin]">
      <div className="sticky top-0 z-10 border-b border-edge bg-panel/95 p-4 backdrop-blur">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted">
              {dossier?.zone.district ?? "…"} · {dossier?.zone.state ?? ""}
            </div>
            <div className="text-lg font-bold tracking-tight">
              {dossier?.zone.name ?? dossier?.zone.zone_code ?? (zoneId ?? "").slice(0, 8)}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted">{dossier?.zone.zone_code}</div>
          </div>
          <button
            onClick={() => selectZone(null)}
            className="rounded-md px-2 py-1 text-muted transition-colors hover:bg-edge hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <span
            className="rounded-lg px-3 py-1.5 text-base font-extrabold text-bg"
            style={{ background: LEVEL_COLORS[level], boxShadow: `0 0 18px ${LEVEL_COLORS[level]}66` }}
          >
            L{level} {LEVEL_NAMES[level]}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted">
            ↗ rising · next 72h
          </span>
        </div>
        <div className="mt-3 rounded-lg border border-orange-900/60 bg-orange-950/40 p-2.5">
          <div className="text-xs font-bold uppercase tracking-wide text-orange-400">
            Recommended: {actionTitle}
          </div>
          <p className="mt-1 text-[12px] leading-snug text-slate-300">{actionBody}</p>
        </div>
      </div>

      <section className="p-4 pb-0">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-orange-400">
          Why this risk <span className="rounded bg-edge px-1.5 py-0.5 text-[9px] font-semibold text-muted">SHAP</span>
        </h3>
        <ReactECharts
          style={{ height: 200 }}
          option={{
            grid: { left: 130, right: 44, top: 6, bottom: 18 },
            xAxis: { type: "value", axisLabel: { color: "#64748B", fontSize: 10 }, splitLine: { lineStyle: { color: "#1E293B" } } },
            yAxis: {
              type: "category",
              data: drivers.map((d) => `${d.feature} (${d.value})`).reverse(),
              axisLabel: { color: "#E2E8F0", fontSize: 11 },
            },
            series: [
              {
                type: "bar",
                barWidth: 16,
                data: [...drivers].reverse().map((d) => ({
                  value: d.contribution,
                  itemStyle: {
                    color: d.contribution >= 0 ? "#EF4444" : "#22C55E",
                    borderRadius: [0, 4, 4, 0],
                  },
                })),
                label: {
                  show: true,
                  position: "right",
                  color: "#94A3B8",
                  fontSize: 10,
                  formatter: (p: { value: number }) => (p.value >= 0 ? `+${p.value}` : `${p.value}`),
                },
              },
            ],
            tooltip: { trigger: "axis", backgroundColor: "#111A2C", borderColor: "#1E293B", textStyle: { color: "#E2E8F0" } },
          }}
        />
      </section>

      <section className="p-4 pb-0">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-sky-400">
          Rainfall vs L3 threshold
        </h3>
        <ReactECharts
          style={{ height: 170 }}
          option={{
            grid: { left: 38, right: 12, top: 26, bottom: 24 },
            xAxis: {
              type: "category",
              data: rain.map((r) => new Date(r.ts).getHours() + ":00"),
              axisLabel: { color: "#64748B", fontSize: 10 },
              axisLine: { lineStyle: { color: "#334155" } },
            },
            yAxis: { type: "value", axisLabel: { color: "#64748B", fontSize: 10 }, splitLine: { lineStyle: { color: "#1E293B" } } },
            series: [
              {
                type: "line",
                name: "24h cum. mm",
                smooth: true,
                showSymbol: false,
                data: rain.map((r) => Math.round(((r.rain_24h ?? r.rain_1h) as number) * 10) / 10),
                lineStyle: { color: "#38BDF8", width: 2.4 },
                areaStyle: { opacity: 0.15, color: "#38BDF8" },
              },
              {
                type: "line",
                name: "L3 threshold",
                data: Array(rain.length).fill(120),
                lineStyle: { color: "#EF444466", type: [6, 5], width: 1.6 },
                symbol: "none",
              },
            ],
            legend: { textStyle: { color: "#94A3B8", fontSize: 10 }, top: 0, right: 0 },
            tooltip: { trigger: "axis", backgroundColor: "#111A2C", borderColor: "#1E293B", textStyle: { color: "#E2E8F0" } },
          }}
        />
      </section>

      <section className="grid grid-cols-2 gap-2 p-4 pb-2">
        {[
          ["Population exposed", (dossier?.zone.population ?? 8200).toLocaleString()],
          ["Road km in zone", `${dossier?.zone.road_km ?? 12.4} km`],
          ["Susceptibility mean", `${Math.round(dossier?.zone.susc_mean ?? 72)} / 100`],
          ["Citizen reports", String(dossier?.reports.length ?? 0)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-bg/70 p-3 ring-1 ring-edge">
            <div className="text-lg font-bold tabular-nums">{value}</div>
            <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
          </div>
        ))}
      </section>

      {(dossier?.alerts.length ?? 0) > 0 && (
        <section className="border-t border-edge p-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-l3">Recent alerts</h3>
          <ul className="space-y-1.5">
            {dossier!.alerts.slice(0, 4).map((a, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-bg/60 p-2 text-[12px]">
                <span
                  className="mt-1 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: LEVEL_COLORS[a.level] }}
                />
                <div>
                  <div className="text-slate-200">{a.message}</div>
                  <div className="text-[10px] text-muted">{new Date(a.fired_at).toLocaleString()}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
