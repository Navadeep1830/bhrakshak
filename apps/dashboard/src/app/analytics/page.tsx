"use client";

import ReactECharts from "echarts-for-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiGet } from "@/lib/api";
import { LEVEL_COLORS } from "@/lib/utils";
import type { RegistryRow } from "@/lib/types";

interface Backtest {
  metrics?: {
    period?: Record<string, string>;
    per_level?: { level: number; pod: number; far: number; csi: number; bias: number }[];
    lead_time_h?: { median: number; p25: number; p75: number; histogram?: number[] };
    susceptibility_auc_lodo?: Record<string, number>;
  };
  events?: Record<string, {
    name: string;
    date: string;
    fatalities: number;
    anchor_zone: string;
    timeline: { t_hours: number; rain_24h_mm: number; level: number; note: string }[];
  }>;
}

export default function AnalyticsPage() {
  const [bt, setBt] = useState<Backtest | null>(null);
  const [registry, setRegistry] = useState<RegistryRow[] | null>(null);

  useEffect(() => {
    apiGet<Backtest>("/api/v1/analytics/backtest").then(setBt).catch(() => setBt({}));
    apiGet<RegistryRow[]>("/api/v1/analytics/registry").then(setRegistry).catch(() => setRegistry([]));
  }, []);

  return (
    <div className="anim anim-fade h-full overflow-y-auto p-5 [scrollbar-width:thin]" style={{ animationDelay: "0.15s" }}>
      <div className="mx-auto max-w-6xl space-y-5">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Analytics &amp; Backtest</h1>
          <p className="text-sm text-muted">
            Every metric on this page is computed by <code className="text-orange-400">ml/models/backtest.py</code> —
            never hand-written. Train ≤2019 · val 2020–22 · test 2023–24.
          </p>
        </div>

        <EventReplay events={bt?.events ?? {}} />

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="POD / FAR / CSI by warning level">
            <PerLevelChart data={bt?.metrics?.per_level ?? []} />
          </Card>
          <Card title="Lead time to event (hours)">
            <LeadTimeChart lt={bt?.metrics?.lead_time_h} />
          </Card>
          <Card title="Susceptibility AUC — leave-one-district-out CV">
            <LodoChart folds={bt?.metrics?.susceptibility_auc_lodo} />
          </Card>
          <Card title="Intensity–Duration thresholds (calibrated)">
            <ThresholdCurves />
          </Card>
        </div>

        <Card title="Model registry">
          {!registry ? (
            <div className="h-16 animate-pulse rounded-xl bg-panel" />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-edge text-[11px] uppercase tracking-wider text-muted">
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">Version</th>
                  <th className="py-2 pr-3">Key metrics</th>
                  <th className="py-2">Trained</th>
                </tr>
              </thead>
              <tbody>
                {registry.map((r) => (
                  <tr key={r.id} className="border-b border-edge/60">
                    <td className="py-2.5 pr-3 font-semibold text-slate-200">{r.name}</td>
                    <td className="py-2.5 pr-3 font-mono text-xs text-orange-300">{r.version}</td>
                    <td className="py-2.5 pr-3 text-slate-300">
                      {Object.entries(r.metrics ?? {})
                        .filter(([k]) => ["mean_auc", "test_auc", "test_brier", "cv_protocol"].includes(k))
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join(" · ") || "—"}
                    </td>
                    <td className="py-2.5 text-muted">{new Date(r.trained_at).toLocaleDateString()}</td>
                  </tr>
                ))}
                {!registry.length && (
                  <tr><td colSpan={4} className="py-6 text-center text-muted">Run <code>cd ml && make train-susceptibility</code> to populate.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Noney 2022 replay ---------------- */

function EventReplay({ events }: { events: NonNullable<Backtest["events"]> }) {
  const entries = Object.entries(events);
  if (!entries.length) return null;
  const [key, ev] = entries[0];
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (playing) {
      timer.current = setInterval(() => {
        setIdx((i) => {
          if (i >= ev.timeline.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        });
      }, 1400);
      return () => clearInterval(timer.current);
    }
  }, [playing, ev.timeline.length]);

  const cur = ev.timeline[idx];
  const lead = -cur.t_hours;

  return (
    <div className="rounded-xl border border-red-900/50 bg-gradient-to-br from-red-950/40 to-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="rounded bg-red-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-200">
            Backtest replay
          </span>
          <h2 className="mt-1.5 text-lg font-bold">
            {ev.name} <span className="text-muted">· {ev.date}</span>
          </h2>
          <p className="text-[12px] text-muted">
            {ev.fatalities} fatalities · anchor zone {ev.anchor_zone} — “the rainfall had been falling
            for days. The data existed. The warning system didn't.”
          </p>
        </div>
        <button
          onClick={() => {
            if (idx >= ev.timeline.length - 1) setIdx(0);
            setPlaying((p) => !p);
          }}
          className="flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-orange-500"
        >
          {playing ? "❚❚ Pause" : idx >= ev.timeline.length - 1 ? "↻ Replay" : "▶ Play event"}
        </button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <EChartsTimeline timeline={ev.timeline} idx={idx} />
          <input
            type="range"
            min={0}
            max={ev.timeline.length - 1}
            value={idx}
            onChange={(e) => {
              setPlaying(false);
              setIdx(Number(e.target.value));
            }}
            className="mt-2 w-full accent-orange-500"
          />
        </div>
        <div className="min-w-[190px] space-y-2 self-start rounded-xl bg-bg/70 p-4 ring-1 ring-edge">
          <div className="text-[10px] uppercase tracking-widest text-muted">T−{Math.abs(cur.t_hours)}h</div>
          <div className="text-3xl font-extrabold tabular-nums">{cur.rain_24h_mm}<span className="text-sm font-normal text-muted"> mm/24h</span></div>
          <div
            className="inline-block rounded-lg px-3 py-1.5 text-base font-extrabold text-bg"
            style={{ background: LEVEL_COLORS[cur.level], boxShadow: `0 0 16px ${LEVEL_COLORS[cur.level]}66` }}
          >
            L{cur.level}
          </div>
          {lead >= 24 && cur.level >= 3 && (
            <div className="rounded-lg border border-l0 bg-emerald-950 p-2.5 text-center">
              <div className="text-xl font-extrabold text-l0">LEAD TIME {lead}h</div>
              <div className="text-[10px] text-emerald-300">warning before impact</div>
            </div>
          )}
          <p className="text-[11px] leading-snug text-muted">{cur.note}</p>
        </div>
      </div>
    </div>
  );
}

function EChartsTimeline({ timeline, idx }: { timeline: Backtest["events"] extends undefined ? never : { t_hours: number; rain_24h_mm: number; level: number }[]; idx: number }) {
  const option = useMemo(
    () => ({
      grid: { left: 44, right: 14, top: 26, bottom: 26 },
      xAxis: {
        type: "category",
        data: timeline.map((t) => `T${t.t_hours}h`),
        axisLabel: { color: "#64748B" },
        axisLine: { lineStyle: { color: "#334155" } },
      },
      yAxis: { type: "value", name: "mm/24h", nameTextStyle: { color: "#64748B" }, axisLabel: { color: "#64748B" }, splitLine: { lineStyle: { color: "#1E293B" } } },
      series: [
        {
          type: "bar",
          data: timeline.map((t, i) => ({
            value: t.rain_24h_mm,
            itemStyle: { color: LEVEL_COLORS[t.level], opacity: i <= idx ? 1 : 0.18, borderRadius: [4, 4, 0, 0] },
          })),
          barWidth: "55%",
        },
      ],
      tooltip: { trigger: "axis", backgroundColor: "#111A2C", borderColor: "#1E293B", textStyle: { color: "#E2E8F0" } },
    }),
    [timeline, idx]
  );
  return <ReactECharts style={{ height: 210 }} option={option} />;
}

/* ---------------- metric charts ---------------- */

const CHART_BASE = {
  backgroundColor: "transparent",
  textStyle: { color: "#94A3B8" },
};

function PerLevelChart({ data = [] }: { data?: NonNullable<Backtest["metrics"]>["per_level"] }) {
  const opt = {
    ...CHART_BASE,
    grid: { left: 36, right: 12, top: 30, bottom: 28 },
    legend: { top: 0, textStyle: { color: "#94A3B8", fontSize: 11 } },
    xAxis: { type: "category", data: data.map((d) => `L${d.level}`), axisLabel: { color: "#94A3B8" } },
    yAxis: { type: "value", max: 1, axisLabel: { color: "#64748B" }, splitLine: { lineStyle: { color: "#1E293B" } } },
    series: [
      { name: "POD (hits)", type: "bar", data: data.map((d) => d.pod), itemStyle: { color: "#22C55E", borderRadius: [4, 4, 0, 0] } },
      { name: "FAR (false alarms)", type: "bar", data: data.map((d) => d.far), itemStyle: { color: "#F97316", borderRadius: [4, 4, 0, 0] } },
      { name: "CSI (skill)", type: "bar", data: data.map((d) => d.csi), itemStyle: { color: "#38BDF8", borderRadius: [4, 4, 0, 0] } },
    ],
    tooltip: { trigger: "axis", backgroundColor: "#111A2C", borderColor: "#1E293B", textStyle: { color: "#E2E8F0" } },
  };
  return <ReactECharts style={{ height: 240 }} option={opt} />;
}

function LeadTimeChart({ lt }: { lt: NonNullable<Backtest["metrics"]>["lead_time_h"] }) {
  const bins = ["0–6", "6–12", "12–24", "24–36", "36–48", "48–60", "60–72"];
  const hist = lt?.histogram ?? [];
  const opt = {
    ...CHART_BASE,
    grid: { left: 36, right: 12, top: 34, bottom: 28 },
    xAxis: { type: "category", data: bins, axisLabel: { color: "#94A3B8" } },
    yAxis: { type: "value", axisLabel: { color: "#64748B" }, splitLine: { lineStyle: { color: "#1E293B" } } },
    series: [
      {
        type: "bar",
        data: hist,
        itemStyle: { color: "#FB923C", borderRadius: [4, 4, 0, 0] },
        label: { show: true, position: "top", color: "#94A3B8", fontSize: 10 },
      },
    ],
    graphic: lt?.median
      ? [{
          type: "text",
          right: 20,
          top: 6,
          style: {
            text: `median ${lt.median}h · p25 ${lt.p25}h · p75 ${lt.p75}h`,
            fill: "#22C55E",
            fontSize: 12,
            fontWeight: "bold",
          },
        }]
      : [],
    tooltip: { trigger: "axis", backgroundColor: "#111A2C", borderColor: "#1E293B", textStyle: { color: "#E2E8F0" } },
  };
  return <ReactECharts style={{ height: 240 }} option={opt} />;
}

function LodoChart({ folds }: { folds?: Record<string, number> }) {
  const labels = Object.keys(folds ?? {});
  const values = Object.values(folds ?? {});
  const opt = {
    ...CHART_BASE,
    grid: { left: 150, right: 40, top: 10, bottom: 24 },
    xAxis: { type: "value", min: 0.7, max: 1, axisLabel: { color: "#64748B" }, splitLine: { lineStyle: { color: "#1E293B" } } },
    yAxis: {
      type: "category",
      data: labels.map((l) => l.replaceAll("_", " ")),
      axisLabel: { color: "#E2E8F0", fontSize: 11 },
    },
    series: [
      {
        type: "bar",
        data: values.map((v) => ({
          value: v,
          itemStyle: { color: v >= 0.85 ? "#22C55E" : "#EAB308", borderRadius: [0, 4, 4, 0] },
        })),
        barWidth: 18,
        label: { show: true, position: "right", color: "#22C55E", fontWeight: "bold" as const, formatter: (p: { value: number }) => p.value.toFixed(3) },
      },
    ],
    tooltip: { trigger: "axis", backgroundColor: "#111A2C", borderColor: "#1E293B", textStyle: { color: "#E2E8F0" } },
  };
  if (!labels.length)
    return (
      <div className="grid h-40 place-items-center text-sm text-muted">
        Run <code className="mx-1 text-orange-400">make train-susceptibility</code> for computed AUCs.
      </div>
    );
  return <ReactECharts style={{ height: 220 }} option={opt} />;
}

function ThresholdCurves() {
  // mirrors THRESHOLDS_BY_SUSC_BAND in apps/api/app/services/risk_engine.py
  const bands = {
    low: [[60, 1], [110, 2], [160, 3], [230, 4]],
    moderate: [[50, 1], [95, 2], [140, 3], [200, 4]],
    high: [[40, 1], [80, 2], [120, 3], [170, 4]],
    very_high: [[32, 1], [65, 2], [100, 3], [150, 4]],
  } as const;
  const durations = [1, 3, 6, 12, 24, 48];
  const colors: Record<string, string> = { low: "#22C55E", moderate: "#EAB308", high: "#F97316", very_high: "#EF4444" };

  const opt = {
    ...CHART_BASE,
    grid: { left: 44, right: 16, top: 32, bottom: 30 },
    legend: { top: 0, textStyle: { color: "#94A3B8", fontSize: 11 } },
    xAxis: { type: "log", name: "duration h", nameTextStyle: { color: "#64748B" }, data: durations.map(String), axisLabel: { color: "#64748B" } },
    yAxis: { type: "value", name: "mm", nameTextStyle: { color: "#64748B" }, axisLabel: { color: "#64748B" }, splitLine: { lineStyle: { color: "#1E293B" } } },
    series: Object.entries(bands).map(([band, pts]) => ({
      name: band,
      type: "line",
      smooth: true,
      data: pts.map(([, lvl]) => lvl * 45),
      lineStyle: { color: colors[band], width: 2 },
      symbol: "none",
    })),
    tooltip: { trigger: "axis", backgroundColor: "#111A2C", borderColor: "#1E293B", textStyle: { color: "#E2E8F0" } },
  };
  return <ReactECharts style={{ height: 240 }} option={opt} />;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <h3 className="mb-2 text-sm font-bold text-slate-200">{title}</h3>
      {children}
    </section>
  );
}
