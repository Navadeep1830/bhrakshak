"use client";

import { useAppStore } from "@/store/useAppStore";

const LAYERS: { key: string; label: string }[] = [
  { key: "risk", label: "Hazard now" },
  { key: "susceptibility", label: "Susceptibility (Model A)" },
  { key: "rainfall", label: "Rainfall intensity" },
  { key: "roads", label: "Road status / detours" },
  { key: "reports", label: "Citizen reports" },
  { key: "deformation", label: "Deformation (InSAR creep)" },
];

const HORIZONS = ["now", "f24", "f48", "f72"] as const;

export function LayerRail() {
  const layers = useAppStore((s) => s.layers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const horizon = useAppStore((s) => s.horizon);
  const setHorizon = useAppStore((s) => s.setHorizon);

  return (
    <div className="absolute left-3 top-16 z-10 w-60 space-y-3 rounded-lg border border-edge bg-panel/90 p-3 backdrop-blur">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          Forecast scrubber
        </div>
        <div className="flex gap-1">
          {HORIZONS.map((h) => (
            <button
              key={h}
              onClick={() => setHorizon(h)}
              className={`flex-1 rounded px-1.5 py-1 text-xs font-medium ${
                horizon === h ? "bg-orange-600 text-white" : "bg-edge text-muted hover:text-ink"
              }`}
            >
              {h === "now" ? "NOW" : `+${h.slice(1)}h`}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        {LAYERS.map((l) => (
          <label
            key={l.key}
            className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-edge"
          >
            <span>{l.label}</span>
            <input
              type="checkbox"
              checked={layers[l.key] ?? false}
              onChange={() => toggleLayer(l.key)}
              className="accent-orange-500"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
