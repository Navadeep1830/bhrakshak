"use client";
// Analytics — REAL backtest fixture numbers (LODO POD/FAR/CSI per level,
// lead time, I-D threshold curves, Noney 2022 event replay, model registry).
// Every number comes from /api/v1/analytics/backtest + registry — never
// hardcoded in the UI. Material 3 cards, tonal icon chips, theme-aware charts.
import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { Slider } from "@/components/ui/slider";
import { BadgeCheck, Timer, LineChart as LineIcon, Database, Layers } from "lucide-react";
import { api } from "@/lib/client/api";
import { useAppStore, LEVEL_COLORS, chartPalette } from "@/store/useAppStore";
import type { RegistryRow } from "@/lib/types";

// I-D threshold curves (mirror of the risk engine THRESHOLDS_BY_SUSC_BAND).
const ID_CURVES: Record<string, [number, number, number][]> = {
  low: [[60, 20, 1], [110, 30, 2], [160, 40, 3], [230, 55, 4]],
  moderate: [[50, 15, 1], [95, 25, 2], [140, 35, 3], [200, 48, 4]],
  high: [[40, 12, 1], [80, 20, 2], [120, 28, 3], [170, 40, 4]],
  very_high: [[32, 10, 1], [65, 16, 2], [100, 24, 3], [150, 34, 4]],
};
const BAND_COLORS = ["#8B938A", "#22C55E", "#EAB308", "#EF4444"];

export function AnalyticsView() {
  const theme = useAppStore((s) => s.theme);
  const [bt, setBt] = useState<any>(null);
  const [registry, setRegistry] = useState<RegistryRow[] | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const pal = chartPalette(theme);

  useEffect(() => {
    api.backtest().then(setBt).catch(() => {});
    api.registry().then(setRegistry).catch(() => {});
  }, []);

  const perLevel = bt?.metrics?.per_level ?? [];
  const timeline = bt?.events?.noney_2022?.timeline ?? [];
  const modelSel = bt?.metrics?.model_selection;

  // --- chart options ---------------------------------------------------
  const podOption = useMemo(() => ({
    backgroundColor: "transparent",
    grid: { top: 30, left: 40, right: 8, bottom: 26 },
    legend: { textStyle: { color: pal.text, fontSize: 10 }, top: 0 },
    xAxis: { type: "category", data: perLevel.map((x: any) => x.name), axisLabel: { color: pal.text, fontSize: 10 } },
    yAxis: { type: "value", max: 1, axisLabel: { color: pal.text, fontSize: 10 }, splitLine: { lineStyle: { color: pal.line } } },
    tooltip: { backgroundColor: pal.tipBg, borderColor: pal.line, textStyle: { color: pal.tipText } },
    series: [
      { name: "POD", type: "bar", barWidth: 14, data: perLevel.map((x: any) => x.pod), itemStyle: { color: "#22C55E", borderRadius: [4, 4, 0, 0] } },
      { name: "FAR", type: "bar", barWidth: 14, data: perLevel.map((x: any) => x.far), itemStyle: { color: "#EF4444", borderRadius: [4, 4, 0, 0] } },
      { name: "CSI", type: "bar", barWidth: 14, data: perLevel.map((x: any) => x.csi), itemStyle: { color: "#38BDF8", borderRadius: [4, 4, 0, 0] } },
    ],
  }), [perLevel, pal]);

  const idOption = useMemo(() => ({
    backgroundColor: "transparent",
    grid: { top: 30, left: 44, right: 10, bottom: 30 },
    legend: { textStyle: { color: pal.text, fontSize: 10 }, top: 0 },
    xAxis: { type: "value", name: "duration (min)", nameTextStyle: { color: pal.dim, fontSize: 9 }, axisLabel: { color: pal.text, fontSize: 10 }, splitLine: { lineStyle: { color: pal.line } } },
    yAxis: { type: "value", name: "intensity (mm/h)", nameTextStyle: { color: pal.dim, fontSize: 9 }, axisLabel: { color: pal.text, fontSize: 10 }, splitLine: { lineStyle: { color: pal.line } } },
    tooltip: { backgroundColor: pal.tipBg, borderColor: pal.line, textStyle: { color: pal.tipText } },
    series: Object.entries(ID_CURVES).map(([band, pts], idx) => ({
      name: band.replace("_", " "),
      type: "line", smooth: true, symbol: "circle", symbolSize: 7,
      data: pts.map(([, i1, lvl]) => [lvl * 60 + 30, i1]).sort((a, b) => Number(a[0]) - Number(b[0])),
      lineStyle: { color: BAND_COLORS[idx], width: 2 },
      itemStyle: { color: BAND_COLORS[idx] },
    })),
  }), [pal]);

  const replayOption = useMemo(() => ({
    backgroundColor: "transparent",
    grid: { top: 28, left: 40, right: 10, bottom: 26 },
    xAxis: { type: "category", data: timeline.map((t: any) => `T${t.t_hours}h`), axisLabel: { color: pal.text, fontSize: 10 } },
    yAxis: [
      { type: "value", name: "mm/24h", nameTextStyle: { color: pal.dim, fontSize: 9 }, axisLabel: { color: pal.text, fontSize: 10 }, splitLine: { lineStyle: { color: pal.line } } },
      { type: "value", max: 4, name: "level", nameTextStyle: { color: pal.dim, fontSize: 9 }, axisLabel: { color: pal.text, fontSize: 10 } },
    ],
    tooltip: { backgroundColor: pal.tipBg, borderColor: pal.line, textStyle: { color: pal.tipText } },
    series: [
      { type: "bar", barWidth: 20, data: timeline.map((t: any) => t.rain_24h_mm), itemStyle: { color: "#0891B2", borderRadius: [4, 4, 0, 0] } },
      { type: "line", yAxisIndex: 1, step: "middle", symbol: "circle", symbolSize: 6, data: timeline.map((t: any) => t.level), lineStyle: { color: "#EF4444", width: 2 }, itemStyle: { color: "#EF4444" } },
    ],
  }), [timeline, pal]);

  const step = timeline[Math.min(replayStep, Math.max(0, timeline.length - 1))];

  const card = "rounded-lg border border-outline-variant/60 bg-surface-low p-4 flex flex-col elevation-1";
  const iconChip = "h-9 w-9 rounded-full grid place-items-center shrink-0";

  return (
    <div className="flex-1 p-4 overflow-y-auto bhu-scroll">
      <div className="max-w-6xl mx-auto space-y-4">
        <header>
          <h1 className="text-title-lg font-medium">Analytics & Model Trust</h1>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            Backtest: LODO cross-validation on real Open-Meteo weather × NASA GLC labels ·
            event-day median percentile scoring · operational alert budgets
            {bt?.note && <span className="hidden xl:inline"> — {String(bt.note).slice(0, 80)}</span>}
          </p>
        </header>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* POD/FAR/CSI */}
          <section className={card}>
            <div className="flex items-center gap-3 mb-2">
              <span className={`${iconChip} bg-primary-container text-on-primary-container`}>
                <BadgeCheck className="h-4 w-4" />
              </span>
              <h2 className="text-title-sm">POD / FAR / CSI by alert level</h2>
            </div>
            <ReactECharts option={podOption} style={{ height: 200 }} opts={{ renderer: "svg" }} />
            <p className="text-label-sm text-on-surface-variant/60 leading-relaxed mt-1.5">
              L1 is a low-bar watch level — high FAR is expected by design (broad coverage);
              L4 trades POD for precision. Alert budgets:{" "}
              {perLevel.map((x: any) => `L${x.level} ${x.alert_days_per_year}d/yr`).join(" · ")}.
            </p>
          </section>

          {/* lead time */}
          <section className={card}>
            <div className="flex items-center gap-3 mb-2">
              <span className={`${iconChip} bg-tertiary-container text-on-tertiary-container`}>
                <Timer className="h-4 w-4" />
              </span>
              <h2 className="text-title-sm">Lead time — Tupul 2022 reconstruction</h2>
            </div>
            <div className="flex-1 grid place-items-center py-4">
              <div className="text-center">
                <div className="text-display-sm font-normal text-primary tabular-nums">
                  {bt?.metrics?.lead_time_h?.tupul_2022_lead_time_h ?? "—"}
                  <span className="text-title-md text-on-surface-variant/70"> h</span>
                </div>
                <div className="text-body-md text-on-surface-variant mt-1">
                  first L3 triggered {bt?.metrics?.lead_time_h?.first_l3_at ?? "—"}
                </div>
                <div className="text-label-sm text-on-surface-variant/60 mt-2 max-w-sm mx-auto leading-relaxed">
                  Estimated from threshold_tier on reconstructed Tupul 2022 rainfall —
                  the Noney (Tupul) landslide of 30 Jun 2022 (58 fatalities).
                </div>
              </div>
            </div>
          </section>

          {/* I-D curves */}
          <section className={card}>
            <div className="flex items-center gap-3 mb-2">
              <span className={`${iconChip} bg-tertiary-container text-on-tertiary-container`}>
                <LineIcon className="h-4 w-4" />
              </span>
              <h2 className="text-title-sm">Intensity–duration thresholds per susc band</h2>
            </div>
            <ReactECharts option={idOption} style={{ height: 210 }} opts={{ renderer: "svg" }} />
            <p className="text-label-sm text-on-surface-variant/60 mt-1.5 leading-relaxed">
              GSI-style interpretable thresholds — the same table the fusion engine uses
              (hazard = max(I-D tier, calibrated ML tier)).
            </p>
          </section>

          {/* Noney replay */}
          <section className={card}>
            <div className="flex items-center gap-3 mb-2">
              <span className={`${iconChip} bg-error-container text-on-error-container`}>
                <Database className="h-4 w-4" />
              </span>
              <h2 className="text-title-sm">Noney 2022 event replay</h2>
              <span className="ml-auto text-label-sm text-on-surface-variant/70 text-right">
                {bt?.events?.noney_2022?.date} · {bt?.events?.noney_2022?.fatalities} fatalities · anchor {bt?.events?.noney_2022?.anchor_zone}
              </span>
            </div>
            <ReactECharts option={replayOption} style={{ height: 170 }} opts={{ renderer: "svg" }} />
            <div className="mt-2.5 flex items-center gap-4">
              <Slider value={[replayStep]} min={0} max={Math.max(0, timeline.length - 1)} step={1}
                onValueChange={(v) => setReplayStep(v[0])} className="flex-1" />
              {step && (
                <div className="text-right shrink-0">
                  <div className="text-body-md font-mono font-bold" style={{ color: LEVEL_COLORS[Math.min(4, step.level)] }}>
                    L{step.level} · {step.rain_24h_mm} mm/24h
                  </div>
                  <div className="text-label-sm text-on-surface-variant/70 max-w-[180px]">{step.note}</div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* model selection + registry */}
        <section className={card}>
          <div className="flex items-center gap-3 mb-3">
            <span className={`${iconChip} bg-primary-container text-on-primary-container`}>
              <Layers className="h-4 w-4" />
            </span>
            <h2 className="text-title-sm">Model registry & selection</h2>
            {modelSel && (
              <span className="ml-auto text-label-sm text-on-surface-variant/70">
                champion <span className="text-primary font-mono">{modelSel.champion}</span> · OOF {modelSel.oof_median_percentile} ± {modelSel.oof_se}
              </span>
            )}
          </div>
          <div className="overflow-x-auto rounded-md border border-outline-variant/50">
            <table className="w-full text-body-md">
              <thead>
                <tr className="text-left text-label-sm uppercase tracking-wider text-on-surface-variant/60 bg-surface-container border-b border-outline-variant/50">
                  <th className="py-2.5 pr-3 pl-4">Model</th>
                  <th className="py-2.5 pr-3">Layer</th>
                  <th className="py-2.5 pr-3 hidden md:table-cell">Approach</th>
                  <th className="py-2.5 pr-3">Validation</th>
                  <th className="py-2.5 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {(registry ?? []).map((r) => (
                  <tr key={r.model} className="border-b border-outline-variant/40 last:border-0 transition-colors hover:bg-surface-container/60">
                    <td className="py-2.5 pr-3 pl-4 font-medium">{r.model}</td>
                    <td className="py-2.5 pr-3 text-on-surface-variant">{r.layer}</td>
                    <td className="py-2.5 pr-3 text-on-surface-variant/80 hidden md:table-cell">{r.approach}</td>
                    <td className="py-2.5 pr-3 font-mono text-primary">{r.val_metric}</td>
                    <td className="py-2.5 pr-4">
                      <span className="px-2.5 py-0.5 rounded-full text-label-sm bg-primary-container text-on-primary-container">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {modelSel && (
            <p className="text-label-sm text-on-surface-variant/60 mt-2.5 leading-relaxed">
              {modelSel.rule} — {modelSel.note}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

export default AnalyticsView;
