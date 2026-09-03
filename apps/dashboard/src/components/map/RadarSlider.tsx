"use client";
// Radar scrubber + forecast horizon pills (M3 segmented buttons + slider).
import { Clock } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

const HORIZONS: { h: 0 | 24 | 48 | 72; label: string }[] = [
  { h: 0, label: "NOW" },
  { h: 24, label: "+24h" },
  { h: 48, label: "+48h" },
  { h: 72, label: "+72h" },
];

const STEPS = ["T-60m", "T-50m", "T-40m", "T-30m", "T-20m", "T-10m", "now", "+10m", "+20m", "+30m", "+40m", "+50m"];

export default function RadarSlider() {
  const { radarStep, setRadarStep, horizon, setHorizon } = useAppStore();

  return (
    <div className="rounded-lg border border-outline-variant/60 bg-surface-low/95 backdrop-blur px-4 py-3 w-[min(560px,calc(100vw-2rem))] elevation-2">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-1.5 text-label-lg text-on-surface">
          <Clock className="h-4 w-4 text-tertiary" />
          Forecast horizon
        </div>
        <div className="flex items-center rounded-full border border-outline overflow-hidden h-7 bg-surface">
          {HORIZONS.map(({ h, label }, i) => {
            const active = horizon === h;
            return (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={cn(
                  "flex items-center h-full px-2.5 text-label-md state-layer transition-colors duration-200",
                  i > 0 && "border-l border-outline",
                  active ? "bg-tertiary-container text-on-tertiary-container" : "text-on-surface-variant",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-label-sm text-on-surface-variant w-9 shrink-0">radar</span>
        <Slider
          value={[radarStep]}
          min={0}
          max={11}
          step={1}
          onValueChange={(v) => setRadarStep(v[0])}
          className="flex-1"
        />
        <span className="text-label-sm text-on-surface-variant w-12 text-right shrink-0 tabular-nums">
          {STEPS[radarStep]}
        </span>
      </div>
    </div>
  );
}
