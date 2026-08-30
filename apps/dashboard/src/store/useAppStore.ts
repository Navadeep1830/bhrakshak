"use client";

import { create } from "zustand";

export type Horizon = "now" | "f24" | "f48" | "f72";

interface AppState {
  selectedZoneId: string | null;
  horizon: Horizon;
  layers: Record<string, boolean>;
  demoMode: boolean;
  radarStep: number;
  radarPlaying: boolean;
  selectZone: (id: string | null) => void;
  setHorizon: (h: Horizon) => void;
  toggleLayer: (name: string) => void;
  setDemoMode: (v: boolean) => void;
  setRadarStep: (s: number) => void;
  toggleRadarPlaying: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedZoneId: null,
  horizon: "now",
  layers: {
    risk: true,
    terrain: true,
    susceptibility: false,
    roads: true,
    detours: true,
    shelters: true,
    reports: true,
    deformation: false,
    rainfall: true,
  },
  demoMode: false,
  radarStep: 6, // 6 corresponds to NOW
  radarPlaying: false,
  selectZone: (id) => set({ selectedZoneId: id }),
  setHorizon: (horizon) => set({ horizon }),
  toggleLayer: (name) =>
    set((s) => ({ layers: { ...s.layers, [name]: !s.layers[name] } })),
  setDemoMode: (demoMode) => set({ demoMode }),
  setRadarStep: (radarStep) => set({ radarStep }),
  toggleRadarPlaying: () => set((s) => ({ radarPlaying: !s.radarPlaying })),
}));
