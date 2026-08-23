"use client";

import { LEVEL_COLORS, LEVEL_NAMES } from "@/lib/utils";

export function Legend() {
  return (
    <div className="absolute bottom-16 right-3 z-10 rounded-xl border border-edge bg-panel/90 p-3 shadow-xl shadow-black/40 backdrop-blur-md">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted">
        Hazard levels
      </div>
      <div className="space-y-1">
        {[4, 3, 2, 1, 0].map((l) => (
          <div key={l} className="flex items-center gap-2">
            <span
              className="h-3 w-6 rounded-sm"
              style={{ background: LEVEL_COLORS[l] }}
            />
            <span className="text-[11px] text-slate-300">
              L{l} · {LEVEL_NAMES[l]}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-edge pt-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full border-2 border-bg" style={{ background: "#38BDF8" }} />
          <span className="text-[11px] text-slate-300">Citizen report</span>
        </div>
      </div>
    </div>
  );
}
