"use client";

import { create } from "zustand";

export type Horizon = "now" | "f24" | "f48" | "f72";

interface AppState {
  selectedZoneId: string | null;
  horizon: Horizon;
  layers: Record<string, boolean>;
  demoMode: boolean;
  selectZone: (id: string | null) => void;
  setHorizon: (h: Horizon) => void;
  toggleLayer: (name: string) => void;
  setDemoMode: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedZoneId: null,
  horizon: "now",
  layers: {
    risk: true,
    susceptibility: false,
    roads: true,
    reports: true,
    deformation: false,
    rainfall: false,
  },
  demoMode: false,
  selectZone: (id) => set({ selectedZoneId: id }),
  setHorizon: (horizon) => set({ horizon }),
  toggleLayer: (name) =>
    set((s) => ({ layers: { ...s.layers, [name]: !s.layers[name] } })),
  setDemoMode: (demoMode) => set({ demoMode }),
}));
