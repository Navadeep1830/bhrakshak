"use client";
// Map legend — hazard levels + aux layers (M3 elevated card).
import { LEVEL_COLORS, LEVEL_LABELS } from "@/store/useAppStore";

export default function Legend({ demoMode }: { demoMode?: boolean }) {
  return (
    <div className="rounded-lg border border-outline-variant/60 bg-surface-low/95 backdrop-blur p-3.5 text-xs elevation-2">
      <div className="text-label-lg text-on-surface mb-2.5 flex items-center gap-2">
        Hazard level
        {demoMode && (
          <span className="text-label-sm px-2 py-0.5 rounded-full bg-error-container text-on-error-container border border-outline-variant/50">
            DEMO STORM
          </span>
        )}
      </div>
      {LEVEL_COLORS.map((c, i) => (
        <div key={i} className="flex items-center gap-2.5 py-0.5">
          <span className="h-3 w-6 rounded-xs border border-black/30" style={{ background: c, opacity: 0.55 + i * 0.11 }} />
          <span className={i >= 3 ? "text-on-surface font-medium" : "text-on-surface-variant"}>{LEVEL_LABELS[i]}</span>
        </div>
      ))}
      <div className="mt-2.5 pt-2.5 border-t border-outline-variant/60 space-y-1.5">
        <div className="flex items-center gap-2.5 text-label-sm text-on-surface-variant">
          <span className="h-0.5 w-6" style={{ background: "repeating-linear-gradient(90deg,#06B6D4 0 4px,transparent 4px 7px)" }} />
          PSInSAR creep &gt;20 mm/yr
        </div>
        <div className="flex items-center gap-2.5 text-label-sm text-on-surface-variant">
          <span className="h-2 w-6 rounded-xs" style={{ background: "linear-gradient(90deg,#164E63,#0891B2,#F59E0B,#EF4444)", opacity: 0.6 }} />
          Rainfall radar mm/h
        </div>
        <div className="flex items-center gap-2.5 text-label-sm text-on-surface-variant">
          <span className="h-0.5 w-6 bg-risk-4" />
          blocked road
        </div>
        <div className="flex items-center gap-2.5 text-label-sm text-on-surface-variant">
          <span className="h-0.5 w-6" style={{ background: "repeating-linear-gradient(90deg,#38BDF8 0 5px,transparent 5px 8px)" }} />
          detour / alternative path
        </div>
        <div className="flex items-center gap-2.5 text-label-sm text-on-surface-variant">
          <span className="h-0.5 w-6" style={{ background: "repeating-linear-gradient(90deg,#FBBF24 0 3px,transparent 3px 5px)" }} />
          evacuation safe-route
        </div>
        <div className="flex items-center gap-2.5 text-label-sm text-on-surface-variant">
          <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]" />
          shelter
        </div>
        <div className="flex items-center gap-2.5 text-label-sm text-on-surface-variant">
          <span className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]" />
          machinery staging
        </div>
      </div>
    </div>
  );
}
