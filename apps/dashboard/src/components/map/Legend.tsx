"use client";

import { LEVEL_COLORS, LEVEL_NAMES } from "@/lib/utils";

export function Legend() {
  return (
    <div
      className="anim anim-fade absolute bottom-4 right-3 z-10 rounded-xl border border-white/5 bg-panel/90 p-3 shadow-xl shadow-black/40 backdrop-blur-md"
      style={{ animationDelay: "0.5s" }}
    >
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
        Hazard level (fused)
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {[0, 1, 2, 3, 4].map((l) => (
          <div key={l} className="flex flex-col items-center gap-1">
            <span
              className="h-3.5 w-7 rounded"
              style={{ background: LEVEL_COLORS[l], boxShadow: `0 0 10px ${LEVEL_COLORS[l]}55` }}
            />
            <span className="text-[9px] font-semibold text-muted">L{l}</span>
            <span className="text-[8px] text-muted/70">{LEVEL_NAMES[l]}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 border-t border-edge/70 pt-1.5">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-bg" style={{ background: "#38BDF8" }} />
        <span className="text-[10px] text-slate-300">Citizen report</span>
        <span className="h-2.5 w-2.5 rounded-full border-2 border-bg" style={{ background: "#10B981" }} />
        <span className="text-[10px] text-slate-300">Shelter</span>
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-muted/80">
        I-D thresholds × ML nowcast · hysteresis 2↑/3↓
      </div>
    </div>
  );
}
