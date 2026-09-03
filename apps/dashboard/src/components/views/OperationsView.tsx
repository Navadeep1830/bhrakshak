"use client";
// Operations — response priority queue (DC SOPs + team assignment),
// alerts console (ack), multilingual preview-fire, live ops log.
// Material 3: elevated cards, tonal chips, state layers, snackbar feedback.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Radio, CheckCheck, Users, Flame, Zap } from "lucide-react";
import { useAppStore, LEVEL_COLORS } from "@/store/useAppStore";
import { api } from "@/lib/client/api";
import { usePoll } from "@/hooks/use-poll";
import { useToast } from "@/hooks/use-toast";
import type { PriorityRow, AlertRow, TickerEvent } from "@/lib/types";

const LANGS = [
  { code: "en", label: "English" }, { code: "hi", label: "हिन्दी" },
  { code: "bn", label: "बাংলা" }, { code: "as", label: "অসমীয়া" },
  { code: "ne", label: "नेपाली" }, { code: "kha", label: "Khasi" },
  { code: "lus", label: "Mizo" }, { code: "mni", label: "Manipuri" },
];

const LVL_LABELS = ["L0", "L1", "L2", "L3", "L4"];
const TEAMS = ["NDRF Alpha (Guwahati)", "NDRF Bravo (Guwahati)", "SDRF-14 Kohima", "SDRF-MZ Aizawl", "DDMA Noney", "DDMA EKH"];

export default function OperationsView() {
  const { token, district } = useAppStore();
  const { toast } = useToast();
  const { data: queue, refresh: refreshQueue } = usePoll<PriorityRow[]>(
    () => api.priority(token), 7000,
  );
  const { data: alerts, refresh: refreshAlerts } = usePoll<AlertRow[]>(
    () => api.alerts(token), 7000,
  );
  const { data: ev } = usePoll<{ events: TickerEvent[]; latest_id: number }>(
    () => api.events(0), 5000,
  );

  const [fireZone, setFireZone] = useState("");
  const [fireLang, setFireLang] = useState("hi");
  const [preview, setPreview] = useState<string | null>(null);

  const ack = async (id: number | string) => {
    try {
      await api.ackAlert(id, token);
      refreshAlerts();
      toast({ title: `Alert #${id} acknowledged` });
    } catch (e) {
      toast({ title: "Ack failed", description: String(e), variant: "destructive" });
    }
  };

  const applySop = async (row: PriorityRow, sopId: string) => {
    try {
      const r = await api.applySop(row.zone_id, sopId, token);
      refreshQueue();
      toast({ title: "Directive applied", description: `${sopId} → ${row.zone_code} (${r.status ?? "directed"})` });
    } catch (e) {
      toast({ title: "Directive failed", description: String(e), variant: "destructive" });
    }
  };

  const assign = async (row: PriorityRow, team: string) => {
    try {
      await api.assignTeam(row.zone_id, team, token);
      refreshQueue();
      toast({ title: "Team assigned", description: `${team} → ${row.zone_code}` });
    } catch (e) {
      toast({ title: "Assign failed", description: String(e), variant: "destructive" });
    }
  };

  const doPreview = async () => {
    try {
      const r = await api.previewFire(fireZone, fireLang);
      setPreview(r.message);
    } catch (e) {
      setPreview(null);
      toast({ title: "Preview failed", description: String(e), variant: "destructive" });
    }
  };

  const zoneOpts = queue?.map((q) => q.zone_code) ?? [];

  return (
    <div className="flex-1 p-4 grid lg:grid-cols-2 gap-4 overflow-y-auto bhu-scroll items-start">
      {/* LEFT — priority queue */}
      <section className="rounded-lg border border-outline-variant/60 bg-surface-low flex flex-col min-h-[420px] elevation-1">
        <header className="p-3.5 flex items-center gap-3 border-b border-outline-variant/60">
          <span className="h-8 w-8 rounded-full grid place-items-center bg-tertiary-container text-on-tertiary-container shrink-0">
            <Flame className="h-4 w-4" />
          </span>
          <h2 className="text-title-sm">Response Priority Queue</h2>
          <span className="ml-auto text-label-sm text-on-surface-variant/70">
            Model D exposure ranking {district ? `· ${district}` : "· all districts"}
          </span>
        </header>
        <div className="flex-1 overflow-y-auto bhu-scroll p-2.5 space-y-2.5">
          {(queue ?? []).length === 0 && (
            <div className="p-6 text-center text-body-sm text-on-surface-variant/60">
              No zones at L2+ — queue is clear.
            </div>
          )}
          {(queue ?? []).map((row) => (
            <div key={row.zone_id} className="rounded-md border border-outline-variant/50 bg-surface-container p-3.5 transition-shadow duration-200 hover:elevation-1">
              <div className="flex items-center gap-2.5">
                <span className="h-7 px-2.5 rounded-full grid place-items-center text-label-sm font-bold"
                  style={{ background: `${LEVEL_COLORS[row.level]}22`, color: LEVEL_COLORS[row.level] }}>
                  {LVL_LABELS[row.level]}
                </span>
                <div className="min-w-0">
                  <div className="text-body-md font-medium truncate">
                    {row.zone_code} · {row.name}
                  </div>
                  <div className="text-label-sm text-on-surface-variant/80">
                    {row.district} · pop {row.population.toLocaleString("en-IN")} · isolation {(row.isolation * 100).toFixed(0)}% · {row.roads_blocked} road(s) blocked
                  </div>
                </div>
                <div className="ml-auto text-right shrink-0">
                  <div className="text-title-sm font-medium text-tertiary tabular-nums">{row.priority}</div>
                  <div className="text-label-sm text-on-surface-variant/60">priority</div>
                </div>
              </div>

              <div className="mt-2.5 h-1.5 rounded-full bg-surface-highest overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-red-500"
                  style={{ width: `${Math.min(100, row.priority / 2)}%` }} />
              </div>

              <div className="mt-2.5 flex flex-wrap gap-1.5 items-center">
                {row.sops.slice(0, 4).map((sop) => (
                  <button
                    key={sop.id}
                    onClick={() => applySop(row, sop.id)}
                    title={sop.detail}
                    className={`px-3 py-1 rounded-full text-label-sm font-medium border state-layer transition-colors ${
                      row.status !== "open"
                        ? "bg-primary-container text-on-primary-container border-transparent"
                        : "border-outline-variant text-on-surface-variant hover:border-primary/60 hover:text-primary"
                    }`}
                  >
                    {sop.label}
                  </button>
                ))}
                {row.team ? (
                  <span className="px-3 py-1 rounded-full text-label-sm bg-secondary-container text-on-secondary-container flex items-center gap-1.5">
                    <Users className="h-3 w-3" /> {row.team}
                  </span>
                ) : (
                  <Select onValueChange={(v) => assign(row, v)}>
                    <SelectTrigger size="sm" className="h-7 w-[150px] text-label-sm">
                      <SelectValue placeholder="assign team…" />
                    </SelectTrigger>
                    <SelectContent>
                      {TEAMS.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* RIGHT — alerts + preview-fire + ops log */}
      <div className="space-y-4">
        <section className="rounded-lg border border-outline-variant/60 bg-surface-low elevation-1">
          <header className="p-3.5 flex items-center gap-3 border-b border-outline-variant/60">
            <span className="h-8 w-8 rounded-full grid place-items-center bg-error-container text-on-error-container shrink-0">
              <Radio className="h-4 w-4" />
            </span>
            <h2 className="text-title-sm">Alerts</h2>
            <span className="ml-auto text-label-sm text-on-surface-variant/70">
              {(alerts ?? []).filter((a) => !a.ack).length} unacknowledged
            </span>
          </header>
          <div className="max-h-72 overflow-y-auto bhu-scroll p-2.5 space-y-2">
            {(alerts ?? []).length === 0 && (
              <div className="p-6 text-center text-body-sm text-on-surface-variant/60">No alerts (or role has no access).</div>
            )}
            {(alerts ?? []).slice(0, 30).map((a) => (
              <div key={a.id} className="rounded-md border border-outline-variant/50 bg-surface-container p-3 flex items-start gap-2.5">
                <span className="mt-1 h-2 w-2 rounded-full shrink-0"
                  style={{ background: LEVEL_COLORS[Math.min(4, a.level)] }} />
                <div className="min-w-0 flex-1">
                  <p className="text-label-lg leading-relaxed text-on-surface/90">{a.message}</p>
                  <p className="text-label-sm text-on-surface-variant/60 mt-0.5">
                    {a.zone_code} · {a.channels.join(" / ")} ·{" "}
                    {new Date(a.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    {a.ack ? ` · ack ${a.ack_by}` : ""}
                  </p>
                </div>
                {!a.ack && (
                  <Button size="sm" variant="tonal" onClick={() => ack(a.id)}
                    className="h-7 px-3 text-label-sm shrink-0">
                    <CheckCheck className="h-3.5 w-3.5" /> ack
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* preview fire */}
        <section className="rounded-lg border border-outline-variant/60 bg-surface-low p-3.5 elevation-1">
          <div className="flex items-center gap-3 mb-3">
            <span className="h-8 w-8 rounded-full grid place-items-center bg-tertiary-container text-on-tertiary-container">
              <Zap className="h-4 w-4" />
            </span>
            <h2 className="text-title-sm">Multilingual alert preview</h2>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={fireZone || zoneOpts[0] || ""} onValueChange={setFireZone}>
              <SelectTrigger size="sm" className="w-[140px]">
                <SelectValue placeholder="zone…" />
              </SelectTrigger>
              <SelectContent className="max-h-56">
                {zoneOpts.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                {zoneOpts.length === 0 && <SelectItem value="MN-NON-002">MN-NON-002</SelectItem>}
              </SelectContent>
            </Select>
            <Select value={fireLang} onValueChange={setFireLang}>
              <SelectTrigger size="sm" className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGS.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="tonal" onClick={doPreview} className="h-8">
              Preview message
            </Button>
          </div>
          {preview && (
            <div className="mt-3 rounded-md border border-outline-variant/60 bg-tertiary-container p-3.5 text-body-md leading-relaxed text-on-tertiary-container">
              {preview}
            </div>
          )}
        </section>

        {/* ops log */}
        <section className="rounded-lg border border-outline-variant/60 bg-surface-low elevation-1">
          <header className="p-3.5 border-b border-outline-variant/60 flex items-center gap-2">
            <h2 className="text-title-sm">Live ops feed</h2>
            <span className="ml-auto text-label-sm text-on-surface-variant/70">auto-updating</span>
          </header>
          <div className="max-h-56 overflow-y-auto bhu-scroll p-2.5 space-y-1">
            {(ev?.events ?? []).slice(0, 18).map((e) => (
              <div key={e.id} className="text-label-lg text-on-surface-variant flex gap-2 px-1 py-0.5">
                <span className="text-label-sm text-on-surface-variant/50 shrink-0 tabular-nums">
                  {new Date(e.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
                <span>{e.text}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
