"use client";

import ReactECharts from "echarts-for-react";
import { useEffect, useState } from "react";

import { apiGet, endpoints, FIXTURE_DRIVERS, FIXTURE_RAINFALL } from "@/lib/api";
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
    <aside className="anim-slide absolute right-0 top-12 z-20 flex h-[calc(100%-3.5rem)] w-96 flex-col overflow-y-auto border-l border-white/5 bg-panel shadow-2xl shadow-black/50 [scrollbar-width:thin]">
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
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="rounded-lg px-3 py-1.5 text-base font-extrabold text-bg"
              style={{ background: LEVEL_COLORS[level], boxShadow: `0 0 18px ${LEVEL_COLORS[level]}66` }}
            >
              L{level} {LEVEL_NAMES[level]}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted">
              P(24h): <strong className="text-sky-400">{Math.round((dossier?.zone.prob_24h ?? (level * 0.22)) * 100)}%</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={async () => {
                if (!zoneId) return;
                try {
                  const res = await fetch(`${endpoints.API}/api/v1/analytics/briefing-dossier/${zoneId}?format=markdown`);
                  const text = await res.text();
                  await navigator.clipboard.writeText(text);
                  alert("Copied Official DDMA Briefing Dossier Markdown to clipboard ✓");
                } catch {
                  alert("Failed to copy dossier.");
                }
              }}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800/80 px-2 py-1 text-[10px] font-bold text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
            >
              📋 Copy MD
            </button>
            <a
              href={`${endpoints.API}/api/v1/analytics/briefing-dossier/${zoneId}?format=markdown`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-1 text-[10px] font-bold text-amber-300 transition-colors hover:bg-amber-900/60 hover:text-white"
            >
              📄 Export
            </a>
          </div>
        </div>

        {/* District Collector Action Directive Card */}
        <div className={`mt-3 rounded-lg border p-3 ${
          level >= 4
            ? "border-red-600/80 bg-red-950/60 shadow-lg shadow-red-950/50"
            : level === 3
            ? "border-orange-600/80 bg-orange-950/50"
            : level === 2
            ? "border-amber-600/60 bg-amber-950/40"
            : "border-slate-800 bg-slate-900/60"
        }`}>
          <div className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${level >= 3 ? "animate-ping bg-red-400" : "bg-amber-400"}`} />
            <div className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400">
              {dossier?.dc_directive?.urgency ?? `DC DIRECTIVE: ${actionTitle}`}
            </div>
          </div>
          <p className="mt-1.5 text-[12px] font-semibold text-slate-100">
            {dossier?.dc_directive?.headline ?? actionBody}
          </p>

          {dossier?.dc_directive && level >= 2 && (
            <div className="mt-2.5 space-y-1.5 border-t border-white/10 pt-2 text-[11px]">
              <div className="text-slate-300">
                <span className="font-bold text-amber-300">🏃 Evacuation:</span> {dossier.dc_directive.evacuation_plan}
              </div>
              <div className="text-slate-300">
                <span className="font-bold text-sky-300">🚒 NDRF/SDRF:</span> {dossier.dc_directive.ndrf_deployment}
              </div>
              <div className="text-slate-300">
                <span className="font-bold text-emerald-300">🚜 Machinery:</span> {dossier.dc_directive.machinery_positioning}
              </div>
              <div className="text-slate-300">
                <span className="font-bold text-rose-300">🛑 Traffic:</span> {dossier.dc_directive.traffic_advisory}
              </div>

              {/* Vulnerable Demographics */}
              {dossier.dc_directive.demographics && (
                <div className="mt-2 grid grid-cols-3 gap-1 rounded bg-black/30 p-1.5 text-center text-[10px]">
                  <div>
                    <span className="text-muted block">Elderly</span>
                    <strong className="text-amber-300 tabular-nums">{dossier.dc_directive.demographics.elderly_count}</strong>
                  </div>
                  <div>
                    <span className="text-muted block">Under 5</span>
                    <strong className="text-sky-300 tabular-nums">{dossier.dc_directive.demographics.children_under_5}</strong>
                  </div>
                  <div>
                    <span className="text-muted block">Ambulances</span>
                    <strong className="text-emerald-300 tabular-nums">{dossier.dc_directive.demographics.ambulances_assigned} units</strong>
                  </div>
                </div>
              )}

              {/* DDMA SOP Action Checklist */}
              {dossier.dc_directive.ddma_sop_checklist && dossier.dc_directive.ddma_sop_checklist.length > 0 && (
                <div className="mt-2 border-t border-white/10 pt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                    DDMA Standard Operating Procedures (SOP)
                  </div>
                  <div className="space-y-1">
                    {dossier.dc_directive.ddma_sop_checklist.map((sop, idx) => (
                      <label key={idx} className="flex items-start gap-1.5 cursor-pointer text-[10px] text-slate-300 hover:text-white">
                        <input type="checkbox" className="mt-0.5 rounded border-slate-700 bg-slate-800 text-sky-500" defaultChecked={level >= 4 && idx < 2} />
                        <div>
                          <span className="rounded bg-white/10 px-1 py-0.2 text-[9px] font-semibold text-sky-300 mr-1">{sop.dept}</span>
                          {sop.task}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Explainable AI: SHAP Factor Attribution Waterfall */}
      <section className="p-4 pb-0">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-orange-400">
            Physical Risk Drivers <span className="rounded bg-edge px-1.5 py-0.5 text-[9px] font-semibold text-muted">SHAP XAI</span>
          </h3>
          <span className="text-[10px] text-muted">Factor Contribution</span>
        </div>
        <ReactECharts
          style={{ height: 190 }}
          option={{
            grid: { left: 140, right: 46, top: 4, bottom: 14 },
            xAxis: { type: "value", axisLabel: { color: "#64748B", fontSize: 9 }, splitLine: { lineStyle: { color: "#1E293B" } } },
            yAxis: {
              type: "category",
              data: drivers.map((d) => `${d.name ?? d.feature} (${d.value})`).reverse(),
              axisLabel: { color: "#E2E8F0", fontSize: 10 },
            },
            series: [
              {
                type: "bar",
                barWidth: 15,
                data: [...drivers].reverse().map((d) => ({
                  value: d.contribution,
                  itemStyle: {
                    color: d.contribution >= 0.25 ? "#EF4444" : d.contribution >= 0.15 ? "#F59E0B" : "#38BDF8",
                    borderRadius: [0, 4, 4, 0],
                  },
                })),
                label: {
                  show: true,
                  position: "right",
                  color: "#94A3B8",
                  fontSize: 10,
                  formatter: (p: { value: number }) => `+${Math.round(p.value * 100)}%`,
                },
              },
            ],
            tooltip: {
              trigger: "axis",
              backgroundColor: "#111A2C",
              borderColor: "#1E293B",
              textStyle: { color: "#E2E8F0", fontSize: 11 },
              formatter: (params: unknown) => {
                const p = Array.isArray(params) ? params[0] : params;
                const d = drivers.find((x) => (x.name ?? x.feature) === (p as { name: string })?.name?.split(" (")[0]);
                return `<strong>${(p as { name: string })?.name}</strong><br/>Contribution: <b>+${Math.round((p as { value: number })?.value * 100)}%</b><br/><span style="color:#94A3B8">${d?.description ?? ""}</span>`;
              },
            },
          }}
        />

        {/* Feature Detail Tiles */}
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {drivers.slice(0, 4).map((d, i) => (
            <div key={i} className="rounded-lg bg-bg/80 p-2 ring-1 ring-white/5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-300 truncate">{d.name ?? d.feature}</span>
                <span className="text-[10px] font-extrabold text-amber-400">+{Math.round(d.contribution * 100)}%</span>
              </div>
              <div className="text-[11px] font-bold text-slate-100 tabular-nums">{d.value}</div>
              <div className="text-[9px] text-muted line-clamp-1">{d.description ?? "Physical telemetry reading"}</div>
            </div>
          ))}
        </div>
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
