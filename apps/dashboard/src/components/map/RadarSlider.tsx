"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/store/useAppStore";

export const GPM_RADAR_TIMESTEPS = [
  { label: "-6h", desc: "T - 6h IMERG Satellite", intensity_mult: 0.35, source: "GPM IMERG" },
  { label: "-5h", desc: "T - 5h IMERG Satellite", intensity_mult: 0.45, source: "GPM IMERG" },
  { label: "-4h", desc: "T - 4h IMD Doppler Sync", intensity_mult: 0.58, source: "IMD Doppler" },
  { label: "-3h", desc: "T - 3h Deep Convective Band", intensity_mult: 0.72, source: "IMD Doppler" },
  { label: "-2h", desc: "T - 2h Orographic Uplift", intensity_mult: 0.88, source: "IMD Doppler" },
  { label: "-1h", desc: "T - 1h Cloudburst Genesis", intensity_mult: 0.96, source: "IMD Doppler" },
  { label: "NOW", desc: "Live Real-Time Radar Nowcast", intensity_mult: 1.0, source: "IMD + GPM Fusion" },
  { label: "+1h", desc: "T + 1h Extrapolated Advection", intensity_mult: 1.18, source: "Model B Nowcast" },
  { label: "+2h", desc: "T + 2h Peak Hillside Saturation", intensity_mult: 1.35, source: "Model B Nowcast" },
  { label: "+3h", desc: "T + 3h Critical Seepage Surge", intensity_mult: 1.48, source: "Model B Nowcast" },
  { label: "+4h", desc: "T + 4h Runoff Peak Flow", intensity_mult: 1.22, source: "Model B Nowcast" },
  { label: "+6h", desc: "T + 6h Convective Dissipation", intensity_mult: 0.78, source: "Model B Nowcast" },
];

export function RadarSlider() {
  const radarStep = useAppStore((s) => s.radarStep);
  const setRadarStep = useAppStore((s) => s.setRadarStep);
  const radarPlaying = useAppStore((s) => s.radarPlaying);
  const toggleRadarPlaying = useAppStore((s) => s.toggleRadarPlaying);
  const isRainfallOn = useAppStore((s) => s.layers.rainfall ?? true);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [radarSource, setRadarSource] = useState<"IMD" | "GPM">("IMD");

  // Auto-advancing animation loop
  useEffect(() => {
    if (!radarPlaying) return;
    const intervalMs = speed === 2 ? 400 : 800;
    const timer = setInterval(() => {
      setRadarStep((radarStep + 1) % GPM_RADAR_TIMESTEPS.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [radarPlaying, radarStep, speed, setRadarStep]);

  if (!isRainfallOn) return null;

  const currentStep = GPM_RADAR_TIMESTEPS[radarStep] ?? GPM_RADAR_TIMESTEPS[6];
  const isExtreme = currentStep.intensity_mult >= 1.3;

  return (
    <div
      className="anim anim-fade absolute bottom-20 left-1/2 z-10 -translate-x-1/2 flex flex-col items-center rounded-2xl border border-sky-500/30 bg-panel/95 px-4 py-2.5 shadow-2xl shadow-black/70 backdrop-blur-md"
      style={{ width: "min(94vw, 600px)", animationDelay: "0.8s" }}
    >
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Step Backwards */}
          <button
            onClick={() => setRadarStep((radarStep - 1 + GPM_RADAR_TIMESTEPS.length) % GPM_RADAR_TIMESTEPS.length)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 text-[10px]"
            title="Previous Step"
          >
            ⏮
          </button>
          {/* Play/Pause */}
          <button
            onClick={toggleRadarPlaying}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500 text-white shadow transition-transform hover:scale-105 active:scale-95 text-xs font-bold"
          >
            {radarPlaying ? "⏸" : "▶"}
          </button>
          {/* Step Forwards */}
          <button
            onClick={() => setRadarStep((radarStep + 1) % GPM_RADAR_TIMESTEPS.length)}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-slate-300 hover:bg-slate-700 text-[10px]"
            title="Next Step"
          >
            ⏭
          </button>
          {/* Speed Toggle */}
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
                {currentStep.source}
              </span>
              {isExtreme && (
                <span className="animate-pulse rounded bg-red-950/90 px-1.5 py-0.2 text-[9px] font-extrabold text-red-300 ring-1 ring-red-600/60">
                  ⚠️ CONVECTIVE SURGE
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted">
              {currentStep.desc} ({currentStep.label})
            </div>
          </div>
        </div>

        {/* Source Toggle & Rain Intensity Ramp */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-md bg-bg/80 p-0.5 text-[9px] font-semibold text-slate-300">
            <button
              onClick={() => setRadarSource("IMD")}
              className={`rounded px-1.5 py-0.5 ${radarSource === "IMD" ? "bg-sky-600 text-white font-bold" : "text-muted"}`}
            >
              IMD
            </button>
            <button
              onClick={() => setRadarSource("GPM")}
              className={`rounded px-1.5 py-0.5 ${radarSource === "GPM" ? "bg-sky-600 text-white font-bold" : "text-muted"}`}
            >
              GPM
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-1 text-[9px] text-slate-300 font-mono">
            <span>0</span>
            <div className="h-2 w-16 rounded-full bg-gradient-to-r from-emerald-500 via-yellow-400 via-orange-500 to-rose-600 shadow-inner" />
            <span>75+ mm/h</span>
          </div>
        </div>
      </div>

      {/* Discrete 12-Step Horizontal Scrubber */}
      <div className="mt-2.5 flex w-full items-center gap-1">
        {GPM_RADAR_TIMESTEPS.map((step, idx) => {
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

export default RadarSlider;
