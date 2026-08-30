"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";

export const RADAR_TIMESTEPS = [
  { label: "-6h", desc: "6 Hours Ago", intensity_mult: 0.3 },
  { label: "-5h", desc: "5 Hours Ago", intensity_mult: 0.4 },
  { label: "-4h", desc: "4 Hours Ago", intensity_mult: 0.55 },
  { label: "-3h", desc: "3 Hours Ago", intensity_mult: 0.7 },
  { label: "-2h", desc: "2 Hours Ago", intensity_mult: 0.85 },
  { label: "-1h", desc: "1 Hour Ago", intensity_mult: 0.95 },
  { label: "NOW", desc: "Live IMD Doppler", intensity_mult: 1.0 },
  { label: "+1h", desc: "Nowcast +1h", intensity_mult: 1.15 },
  { label: "+2h", desc: "Nowcast +2h", intensity_mult: 1.3 },
  { label: "+3h", desc: "Nowcast +3h", intensity_mult: 1.45 },
  { label: "+4h", desc: "Nowcast +4h", intensity_mult: 1.2 },
  { label: "+6h", desc: "Nowcast +6h", intensity_mult: 0.8 },
];

export function RadarScrubber() {
  const radarStep = useAppStore((s) => s.radarStep);
  const setRadarStep = useAppStore((s) => s.setRadarStep);
  const radarPlaying = useAppStore((s) => s.radarPlaying);
  const toggleRadarPlaying = useAppStore((s) => s.toggleRadarPlaying);
  const isRainfallOn = useAppStore((s) => s.layers.rainfall ?? true);
  const [speed, setSpeed] = useState<1 | 2>(1);

  // Auto-advancing playback timer when playing
  useEffect(() => {
    if (!radarPlaying) return;
    const intervalMs = speed === 2 ? 425 : 850;
    const timer = setInterval(() => {
      setRadarStep((radarStep + 1) % RADAR_TIMESTEPS.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [radarPlaying, radarStep, speed, setRadarStep]);

  if (!isRainfallOn) return null;

  const currentStep = RADAR_TIMESTEPS[radarStep] ?? RADAR_TIMESTEPS[6];

  return (
    <div
      className="anim anim-fade absolute bottom-20 left-1/2 z-10 -translate-x-1/2 flex flex-col items-center rounded-2xl border border-sky-500/30 bg-panel/90 px-4 py-2.5 shadow-2xl shadow-black/60 backdrop-blur-md"
      style={{ width: "min(92vw, 580px)", animationDelay: "0.8s" }}
    >
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRadarStep((radarStep - 1 + RADAR_TIMESTEPS.length) % RADAR_TIMESTEPS.length)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 text-[10px]"
            title="Previous Step"
          >
            ⏮
          </button>
          <button
            onClick={toggleRadarPlaying}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 text-white shadow transition-transform hover:scale-105 active:scale-95 text-xs font-bold"
          >
            {radarPlaying ? "⏸" : "▶"}
          </button>
          <button
            onClick={() => setRadarStep((radarStep + 1) % RADAR_TIMESTEPS.length)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 text-[10px]"
            title="Next Step"
          >
            ⏭
          </button>
          <button
            onClick={() => setSpeed(speed === 1 ? 2 : 1)}
            className="rounded bg-sky-950/80 px-1.5 py-0.5 text-[9px] font-bold text-sky-300 ring-1 ring-sky-700/50 hover:bg-sky-900"
          >
            {speed}x
          </button>
          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-sky-400">
              <span>🌧️ PRECIPITATION RADAR TIME-LAPSE</span>
              <span className="rounded bg-sky-950/80 px-1.5 py-0.2 text-[9px] text-sky-300 ring-1 ring-sky-700/50">
                IMD &amp; ERA5
              </span>
            </div>
            <div className="text-[10px] text-muted">
              {currentStep.desc} ({currentStep.label})
            </div>
          </div>
        </div>

        {/* Rain Intensity Color Scale Ramp */}
        <div className="hidden sm:flex items-center gap-1 text-[9px] text-slate-300 font-mono">
          <span>0</span>
          <div className="h-2 w-20 rounded-full bg-gradient-to-r from-emerald-500 via-yellow-400 via-orange-500 to-rose-600 shadow-inner" />
          <span>75+ mm/h</span>
        </div>
      </div>

      {/* Step slider */}
      <div className="mt-2.5 flex w-full items-center gap-1">
        {RADAR_TIMESTEPS.map((step, idx) => {
          const isSelected = idx === radarStep;
          const isNow = step.label === "NOW";
          return (
            <button
              key={step.label}
              onClick={() => setRadarStep(idx)}
              className={`flex-1 py-1 text-center rounded-md text-[10px] font-semibold transition-all ${
                isSelected
                  ? isNow
                    ? "bg-rose-600 text-white font-bold shadow-md shadow-rose-950 scale-105"
                    : "bg-sky-500 text-white font-bold shadow-md shadow-sky-950 scale-105"
                  : isNow
                  ? "bg-rose-950/50 text-rose-300 hover:bg-rose-900/60"
                  : "bg-bg/60 text-muted hover:bg-edge hover:text-ink"
              }`}
            >
              {step.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
