import { type CSSProperties } from "react";

/* Minimal inline icon set (stroke = currentColor) — keeps the PWA
   dependency-free while looking consistent with Material symbols. */
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  const paths: Record<string, JSX.Element> = {
    home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" />,
    map: <><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" /><path d="M9 4v14M15 6v14" /></>,
    upload: <><path d="M12 16V5m0 0 -4 4m4-4 4 4" /><path d="M4 17v2.5h16V17" /></>,
    alert: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.2" r="0.4" /></>,
    rain: <><path d="M18 10a5.5 5.5 0 0 0-10.8-1.4A4.2 4.2 0 0 0 6.5 17H18a3.5 3.5 0 0 0 0-7Z" /><path d="m8 19-1 2.5M12.5 19l-1 2.5M17 19l-1 2.5" /></>,
    bluetooth: <path d="M6.5 7.5 17 16.5 12 20V4l5 3.5L6.5 16.5" />,
    share: <><circle cx="6" cy="12" r="2.4" /><circle cx="17.5" cy="5.5" r="2.4" /><circle cx="17.5" cy="18.5" r="2.4" /><path d="M8.2 10.9l7.1-4.2M8.2 13.1l7.1 4.2" /></>,
    wifi_off: <><path d="M2 4l20 16" /><path d="M5 12.5a12 12 0 0 1 4.2-2.7M12 8.2c2.9.5 5.5 2 7.4 4.3M8.6 16a7 7 0 0 1 2-1.3M15.2 15a7 7 0 0 0-1.7-1.2" /><circle cx="12" cy="18.6" r="0.5" /></>,
    wifi: <><path d="M2.5 9.5a15 15 0 0 1 19 0M5.5 13a10 10 0 0 1 13 0M8.7 16.4a5 5 0 0 1 6.6 0" /><circle cx="12" cy="19.4" r="0.6" /></>,
    camera: <><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v11H4v-11Z" /><circle cx="12" cy="13.5" r="3.4" /></>,
    sync: <><path d="M20 12a8 8 0 1 1-2.5-5.8" /><path d="M20 3.5V8h-4.5" /></>,
    logout: <><path d="M14 4H6v16h8" /><path d="M10 12h10.5m0 0-3-3m3 3-3 3" /></>,
    login: <><path d="M10 4h8v16h-8" /><path d="M3.5 12H14m0 0-3-3m3 3-3 3" /></>,
    volume: <><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z" /><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" /></>,
    gauge: <><path d="M4.5 17.5a8.5 8.5 0 1 1 15 0" /><path d="M12 13.5 15.5 9" /><circle cx="12" cy="14" r="1.2" /></>,
    soil: <><path d="M3 16h18" /><path d="M7 16c0-4 1.5-7 5-9 3.5 2 5 5 5 9" /><path d="M12 3.5V7" /></>,
    people: <><circle cx="8.5" cy="8" r="3" /><path d="M2.8 19c.7-3.2 3-5 5.7-5s5 1.8 5.7 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M15.8 14.6c2.6.2 4.6 1.8 5.3 4.4" /></>,
    chevron: <path d="m9 5.5 6.5 6.5L9 18.5" />,
    close: <path d="M5.5 5.5l13 13m0-13-13 13" />,
    check: <path d="m4.5 12.5 5 5 10-11" />,
    satellite: <><rect x="9" y="9" width="6" height="6" rx="1" transform="rotate(45 12 12)" /><path d="M5 8.5 8.5 5M15.5 19l3.5-3.5M7 12 3.5 8.5M17 12l3.5 3.5" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5.5l3.5 2" /></>,
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
