"use client";
// Zone dossier drawer — opens on hex click: drivers, charts, field reports,
// weather I-D check, markdown briefing (Copy MD / Download). M3 side sheet.
import { useEffect, useMemo, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Download, FileText, Loader2 } from "lucide-react";
import { useAppStore, LEVEL_COLORS, chartPalette } from "@/store/useAppStore";
import { api } from "@/lib/client/api";
import type { Dossier } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import ReactECharts from "echarts-for-react";

const LVL_LABELS = ["L0 Normal", "L1 Watch", "L2 Alert", "L3 Warning", "L4 Emergency"];

export default function DossierDrawer() {
  const { selectedZoneId, selectZone, token, role, theme } = useAppStore();
  const [d, setD] = useState<Dossier | null>(null);
  const [busy, setBusy] = useState(false);
  const [md, setMd] = useState<string | null>(null);
  const { toast } = useToast();
  const open = !!selectedZoneId;
  const pal = chartPalette(theme);

  useEffect(() => {
    if (!selectedZoneId) { setD(null); setMd(null); return; }
    setBusy(true);
    api.dossier(selectedZoneId, token)
      .then(setD)
      .catch((e) => toast({ title: "Dossier failed", description: String(e), variant: "destructive" }))
      .finally(() => setBusy(false));
  }, [selectedZoneId, token, toast]);

  // charts -------------------------------------------------------------
  const rainOption = useMemo(() => ({
    backgroundColor: "transparent",
    grid: { top: 24, left: 34, right: 8, bottom: 22 },
    xAxis: { type: "category", data: ["now", "+24h", "+48h", "+72h"], axisLabel: { color: pal.text, fontSize: 10 } },
    yAxis: { type: "value", name: "mm/h", nameTextStyle: { color: pal.dim }, axisLabel: { color: pal.text, fontSize: 10 }, splitLine: { lineStyle: { color: pal.line } } },
    tooltip: { backgroundColor: pal.tipBg, borderColor: pal.line, textStyle: { color: pal.tipText } },
    series: [{
      type: "bar", barWidth: 18, itemStyle: { borderRadius: [6, 6, 0, 0] },
      data: (d?.weather?.forecast_72h ?? []).map((f) => ({
        value: f.mm,
        itemStyle: { color: LEVEL_COLORS[Math.min(4, f.level)] ?? "#0891B2" },
      })),
    }],
  }), [d, pal]);

  const probOption = useMemo(() => {
    const h = d?.zone?.history ?? [];
    return {
      backgroundColor: "transparent",
      grid: { top: 24, left: 34, right: 8, bottom: 22 },
      xAxis: { type: "category", data: h.map((_, i) => `-${h.length - i}h`), axisLabel: { color: pal.dim, fontSize: 9 } },
      yAxis: { type: "value", max: 1, axisLabel: { color: pal.text, fontSize: 10 }, splitLine: { lineStyle: { color: pal.line } } },
      tooltip: { backgroundColor: pal.tipBg, borderColor: pal.line, textStyle: { color: pal.tipText } },
      series: [
        { type: "line", smooth: true, symbol: "none", data: h.map((x) => x.prob), lineStyle: { color: "#22C55E", width: 2 }, areaStyle: { color: "rgba(34,197,94,0.12)" } },
        { type: "line", step: "middle", symbol: "none", data: h.map((x) => x.level / 4), lineStyle: { color: "#F97316", width: 1.5, type: "dashed" } },
      ],
    };
  }, [d, pal]);

  const copyMd = async () => {
    if (!selectedZoneId) return;
    try {
      const out = await api.briefing(selectedZoneId, token);
      const text = out.briefing_md;
      setMd(text);
      await navigator.clipboard.writeText(text);
      toast({ title: "Briefing copied", description: "Markdown briefing is on your clipboard." });
    } catch (e) {
      toast({ title: "Briefing failed", description: String(e), variant: "destructive" });
    }
  };

  const downloadMd = () => {
    if (!md || !d) return;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `briefing-${d.zone.zone_code}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lvl = d?.zone?.hazard_level ?? 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && selectZone(null)}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[480px] bg-surface-low p-0 overflow-y-auto bhu-scroll"
      >
        <SheetHeader className="p-4 pb-2 space-y-2">
          {busy || !d ? (
            <div className="space-y-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="text-title-md">{d.zone.name}</SheetTitle>
                <span className="text-label-md text-on-surface-variant/70 font-mono">{d.zone.zone_code}</span>
                <span
                  className="ml-auto px-2.5 py-0.5 rounded-full text-label-md font-bold border"
                  style={{
                    color: LEVEL_COLORS[lvl], borderColor: `${LEVEL_COLORS[lvl]}66`,
                    background: `${LEVEL_COLORS[lvl]}1A`,
                  }}
                >
                  {LVL_LABELS[lvl]}
                </span>
              </div>
              <SheetDescription className="text-body-sm">
                {d.zone.district}, {d.zone.state} · pop {d.zone.population.toLocaleString("en-IN")} · {d.zone.road_class} corridor {d.zone.road_km} km · P(event≤24h) {(d.zone.prob_24h * 100).toFixed(1)}%
              </SheetDescription>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="tonal" onClick={copyMd} className="h-8 text-label-md">
                  <Copy className="h-3.5 w-3.5" /> Copy MD
                </Button>
                <Button size="sm" variant="outlined" onClick={downloadMd} disabled={!md} className="h-8 text-label-md">
                  <Download className="h-3.5 w-3.5" /> .md
                </Button>
                <span className="ml-auto flex items-center gap-1 text-label-sm text-on-surface-variant/70">
                  <FileText className="h-3 w-3" /> fusion max(I-D {d.zone.threshold_tier}, ML {d.zone.ml_tier})
                </span>
              </div>
            </>
          )}
        </SheetHeader>

        {d && (
          <div className="p-4 pt-1 space-y-4">
            {/* drivers */}
            <section>
              <h3 className="text-label-md font-semibold text-primary uppercase tracking-wider mb-2">Risk drivers</h3>
              <div className="space-y-2">
                {d.drivers.map((dr) => (
                  <div key={dr.name} className="rounded-md border border-outline-variant/60 bg-surface-container p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-body-md font-medium">{dr.name}</span>
                      <span className="text-label-md text-primary font-mono">{dr.value}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-surface-highest overflow-hidden">
                      <div className="h-full rounded-full bg-primary"
                        style={{ width: `${Math.round(dr.contribution * 100)}%` }} />
                    </div>
                    <div className="mt-1.5 text-label-sm text-on-surface-variant/80 leading-relaxed">{dr.description}</div>
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            {/* charts */}
            <section className="grid gap-3">
              <div className="rounded-md border border-outline-variant/60 bg-surface-container p-2">
                <div className="text-label-sm text-on-surface-variant px-1 pb-1">72h rainfall projection (mm/h)</div>
                <ReactECharts option={rainOption} style={{ height: 120 }} opts={{ renderer: "svg" }} />
              </div>
              <div className="rounded-md border border-outline-variant/60 bg-surface-container p-2">
                <div className="text-label-sm text-on-surface-variant px-1 pb-1">
                  24h history — probability (green) · level/4 (orange)
                </div>
                <ReactECharts option={probOption} style={{ height: 120 }} opts={{ renderer: "svg" }} />
              </div>
            </section>

            <Separator />

            {/* weather / I-D */}
            <section>
              <h3 className="text-label-md font-semibold text-primary uppercase tracking-wider mb-2">
                Intensity–duration check
              </h3>
              <div className="rounded-md border border-outline-variant/60 bg-surface-container p-3 text-body-sm space-y-1">
                <div className="flex justify-between"><span className="text-on-surface-variant">Intensity</span><span>{d.weather.intensity_mm_h} mm/h</span></div>
                <div className="flex justify-between"><span className="text-on-surface-variant">Duration</span><span>{d.weather.duration_min} min</span></div>
                <div className="flex justify-between"><span className="text-on-surface-variant">Susc. band</span><span className="capitalize">{d.weather.band}</span></div>
                <div className="pt-1 font-medium" style={{ color: LEVEL_COLORS[Math.min(4, d.zone.threshold_tier)] }}>
                  {d.weather.check}
                </div>
              </div>
            </section>

            {/* field reports */}
            <section>
              <h3 className="text-label-md font-semibold text-primary uppercase tracking-wider mb-2">
                Field reports near zone
              </h3>
              {d.reports.length === 0 ? (
                <div className="text-body-sm text-on-surface-variant/60 rounded-md border border-dashed border-outline-variant p-3">
                  No reports in this window.
                </div>
              ) : (
                <div className="space-y-2">
                  {d.reports.map((r) => (
                    <div key={r.id} className="rounded-md border border-outline-variant/60 bg-surface-container p-3 text-body-sm">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-label-sm font-semibold ${
                          r.status === "verified" ? "bg-primary-container text-on-primary-container" :
                          r.status === "pending" ? "bg-tertiary-container text-on-tertiary-container" :
                          "bg-surface-highest text-on-surface-variant"
                        }`}>{r.status}</span>
                        <span className="text-label-md text-on-surface-variant/70">{new Date(r.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <p className="mt-1 text-on-surface/90">{r.note}</p>
                      {r.verdict && (
                        <p className="mt-1 text-label-sm text-tertiary">
                          Model V: {r.verdict.label} ({(r.verdict.confidence * 100).toFixed(0)}%)
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
            {role === "citizen" && (
              <p className="text-label-sm text-on-surface-variant/60">Sign in as an ops role to ack alerts and run directives.</p>
            )}
          </div>
        )}
        {busy && d === null && (
          <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        )}
      </SheetContent>
    </Sheet>
  );
}
