import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B1220",
        panel: "#111A2C",
        edge: "#1E293B",
        ink: "#E2E8F0",
        muted: "#64748B",
        l0: "#22C55E",
        l1: "#EAB308",
        l2: "#F97316",
        l3: "#EF4444",
        l4: "#A855F7",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Noto Sans",
          "Noto Sans Bengali",
          "Noto Sans Devanagari",
          "system-ui",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
export default config;
