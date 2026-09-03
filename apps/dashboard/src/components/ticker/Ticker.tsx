"use client";
// Bottom ticker — scrolling live event feed (alerts, risk diffs, ops).
// M3 treatment: inverse-surface strip + primary-container LIVE chip.
import { usePoll } from "@/hooks/use-poll";
import { api } from "@/lib/client/api";
import { LEVEL_COLORS } from "@/store/useAppStore";

export default function Ticker() {
  const { data } = usePoll(() => api.events(0), 4000);
  const events = data?.events?.slice(0, 12) ?? [];

  const item = (e: { id: number; text: string; level?: number; kind: string }, key: string) => {
    const color = e.level != null ? LEVEL_COLORS[Math.max(0, Math.min(4, e.level))] : "var(--on-surface-variant)";
    return (
      <span key={key} className="inline-flex items-center gap-2 px-5 text-body-sm whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
        <span className="text-inverse-on-surface/90">
          {e.kind === "alert" ? "🚨 " : e.kind === "allclear" ? "✅ " : e.kind === "demo" ? "🧪 " : ""}
          {e.text}
        </span>
      </span>
    );
  };

  return (
    <div className="bg-inverse-surface h-9 flex items-center overflow-hidden relative elevation-2">
      <span className="absolute left-0 z-10 h-full px-4 flex items-center gap-2 text-label-sm font-semibold tracking-[0.18em] text-on-secondary-container bg-secondary-container rounded-r-full border-l-4 border-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary m3-soft-pulse" />
        LIVE
      </span>
      <div className="ticker-track pl-24">
        {events.map((e) => item(e, `a-${e.id}`))}
        {events.map((e) => item(e, `b-${e.id}`))}
      </div>
    </div>
  );
}
