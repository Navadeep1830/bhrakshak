"use client";
// Command Center — KPI bar + MapLibre risk map + layer rail + legend +
// radar scrubber + dossier drawer + ticker.
import MapView from "@/components/map/MapView";
import RadarSlider from "@/components/map/RadarSlider";
import LayerRail from "@/components/map/LayerRail";
import Legend from "@/components/map/Legend";
import KpiBar from "@/components/kpi/KpiBar";
import Ticker from "@/components/ticker/Ticker";
import DossierDrawer from "@/components/dossier/DossierDrawer";
import { useAppStore } from "@/store/useAppStore";

export default function CommandCenter() {
  const districtFilter = useAppStore((s) => s.districtFilter);
  const horizon = useAppStore((s) => s.horizon);

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-72px)] overflow-hidden">
      <div className="p-3 pb-2">
        <KpiBar />
      </div>

      <div className="relative flex-1 px-3 min-h-0">
        <div className="absolute left-6 top-3 z-10 hidden lg:block space-y-3">
          <LayerRail />
          <Legend />
        </div>
        <MapView />
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
          <RadarSlider />
        </div>
        {horizon > 0 && (
          <div className="absolute top-3 right-16 z-10 rounded-full bg-tertiary-container border border-outline-variant/50 text-on-tertiary-container text-label-md px-3.5 py-1.5 elevation-1">
            PROJECTED · +{horizon}h
          </div>
        )}
      </div>

      <DossierDrawer />
      <Ticker />
      <div className="sr-only">district: {districtFilter}</div>
    </div>
  );
}
