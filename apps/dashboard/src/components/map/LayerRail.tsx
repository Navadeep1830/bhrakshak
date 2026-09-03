"use client";
// Layer rail — map layer toggles (M3 card + filter-chip rows).
import { Layers, Mountain, Flame, CloudRain, Activity, Users, Check } from "lucide-react";
import { useAppStore, type Layers as LayerState } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const LAYERS: { k: keyof LayerState; label: string; icon: any }[] = [
  { k: "hazard", label: "Hazard (fused)", icon: Flame },
  { k: "susceptibility", label: "Susceptibility (Model A)", icon: Mountain },
  { k: "radar", label: "Rainfall radar", icon: CloudRain },
  { k: "creep", label: "Creep (Model C)", icon: Activity },
  { k: "population", label: "Population heat", icon: Users },
];

export default function LayerRail() {
  const { layers, toggleLayer } = useAppStore();

  return (
    <div className="rounded-lg border border-outline-variant/60 bg-surface-low/95 backdrop-blur p-3 w-48 elevation-2">
      <div className="flex items-center gap-1.5 text-label-lg text-on-surface mb-2">
        <Layers className="h-4 w-4 text-primary" /> Layers
      </div>
      <div className="space-y-1">
        {LAYERS.map(({ k, label, icon: Icon }) => {
          const on = layers[k];
          return (
            <button
              key={k}
              onClick={() => toggleLayer(k)}
              aria-pressed={on}
              className={cn(
                "w-full flex items-center gap-2 rounded-full px-3 py-1.5 text-left text-label-md transition-colors duration-200 state-layer",
                on
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface-variant",
              )}
            >
              {on ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Icon className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
