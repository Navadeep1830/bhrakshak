import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const LEVEL_COLORS: Record<number, string> = {
  0: "#22C55E",
  1: "#EAB308",
  2: "#F97316",
  3: "#EF4444",
  4: "#A855F7",
};

export const LEVEL_NAMES: Record<number, string> = {
  0: "Normal",
  1: "Watch",
  2: "Alert",
  3: "Warning",
  4: "Emergency",
};
