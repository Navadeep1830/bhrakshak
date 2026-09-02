import { type CSSProperties } from "react";

/* Tiny stroke icon set — shared visual language with the field app. */
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  const paths: Record<string, JSX.Element> = {
    alert: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.2" r="0.4" /></>,
    check: <path d="m4.5 12.5 5 5 10-11" />,
    volume: <><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" /><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></>,
    wifi_off: <><path d="M2 4l20 16" /><path d="M5 12.5a12 12 0 0 1 4.2-2.7M12 8.2c2.9.5 5.5 2 7.4 4.3M8.6 16a7 7 0 0 1 2-1.3M15.2 15a7 7 0 0 0-1.7-1.2" /><circle cx="12" cy="18.6" r="0.5" /></>,
    wifi: <><path d="M2.5 9.5a15 15 0 0 1 19 0M5.5 13a10 10 0 0 1 13 0M8.7 16.4a5 5 0 0 1 6.6 0" /><circle cx="12" cy="19.4" r="0.6" /></>,
    shelter: <><path d="M3.5 10.5 12 4l8.5 6.5" /><path d="M5.5 9.5V20h13V9.5" /><path d="M9.5 20v-6h5v6" /></>,
    route: <><circle cx="6" cy="18.5" r="2.3" /><circle cx="18" cy="5.5" r="2.3" /><path d="M8.3 18.5H14a3.2 3.2 0 0 0 0-6.4H10a3.2 3.2 0 0 1 0-6.4h5.7" /></>,
    call: <path d="M5 4h3.5l1.5 4-2 1.5a12.5 12.5 0 0 0 6.5 6.5L16 14l4 1.5V19a1.5 1.5 0 0 1-1.7 1.5C10.8 19.7 4.3 13.2 3.5 5.7A1.5 1.5 0 0 1 5 4Z" />,
    download: <><path d="M12 4v11m0 0 -4-4m4 4 4-4" /><path d="M5 19h14" /></>,
  };
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }} aria-hidden
    >
      {paths[name] ?? paths.alert}
    </svg>
  );
}

export const LEVEL_COLORS = ["#34d399", "#a3e635", "#facc15", "#fb923c", "#f87171"];
export const LEVEL_NAMES = ["Safe", "Watch", "Advisory", "Warning", "Emergency"];
