"use client";
// Latest-alert bar (replaces the old scrolling marquee): one static line,
// severity chip, timestamp, unacknowledged count. No animation, no emoji.
import { usePoll } from "@/hooks/use-poll";
import { api } from "@/lib/client/api";
import { LEVEL_COLORS } from "@/store/useAppStore";
import { BellRing } from "lucide-react";

export default function Ticker() {
  const { data } = usePoll(() => api.events(0), 5000);
  const events = data?.events ?? [];
  const latest = events.find((e) => e.kind === "alert") ?? events[0] ?? null;
  const unack = events.filter((e) => e.kind === "alert").length;

  const time = latest
    ? new Date(latest.ts ?? Date.now()).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="h-10 flex items-center gap-3 px-4 border-t border-outline-variant/60 bg-surface-container-lowest">
      <span className="inline-flex items-center gap-1.5 text-label-sm font-semibold tracking-[0.14em] text-on-surface-variant shrink-0">
        <BellRing className="h-3.5 w-3.5 text-primary" />
        LATEST
      </span>
      {latest ? (
        <div className="min-w-0 flex-1 flex items-center gap-2.5">
          <span
            className="shrink-0 h-5 px-2 inline-flex items-center rounded-full text-label-sm font-medium"
            style={{
              background: `color-mix(in srgb, ${LEVEL_COLORS[Math.max(0, Math.min(4, latest.level ?? 0))]} 22%, transparent)`,
              color: LEVEL_COLORS[Math.max(0, Math.min(4, latest.level ?? 0))],
            }}
          >
            L{latest.level ?? 0}
          </span>
          <p className="truncate text-body-sm text-on-surface/90">{latest.text}</p>
          <span className="ml-auto shrink-0 text-label-sm text-on-surface-variant/70">{time}</span>
          {unack > 1 && (
            <span className="shrink-0 text-label-sm text-on-surface-variant/70">+{unack - 1} more</span>
          )}
        </div>
      ) : (
        <p className="text-body-sm text-on-surface-variant/60">No alerts — monitoring nominal.</p>
      )}
    </div>
  );
}
