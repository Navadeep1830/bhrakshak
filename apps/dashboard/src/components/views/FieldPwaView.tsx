"use client";
// Field PWA view — the offline-first citizen / field-official experience,
// rendered in a phone frame on desktop. Material 3 mobile patterns:
// top app bar, tonal cards, filter chips, FAB-style submit, bottom
// navigation bar with pill indicator. Multilingual (8 SIH languages),
// offline report queue with dedupe-safe sync, Edge Vision photo triage.
import { useEffect, useMemo, useState } from "react";
import {
  Home, FileText, BellRing, Wifi, WifiOff, Send, MapPin, Siren, Languages,
  Mountain, Users, Droplets,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore, LEVEL_COLORS } from "@/store/useAppStore";
import { api } from "@/lib/client/api";
import { usePoll } from "@/hooks/use-poll";
import { useToast } from "@/hooks/use-toast";
import EdgeVision, { type EdgeVerdict } from "@/components/pwa/EdgeVision";
import { PWA_LANGS, pwaT, type PwaLang } from "@/components/pwa/i18n";
import { cn } from "@/lib/utils";
import type { AlertRow, KpisOut } from "@/lib/types";

type Tab = "home" | "report" | "alerts";
const QUEUE_KEY = "bhu-pwa-queue";

interface QueuedReport {
  id: string;
  type: string;
  note: string;
  zone_code: string;
  lat: number;
  lon: number;
  verdict?: EdgeVerdict;
  created_at: number;
}

const TYPES = [
  { k: "crack", icon: Mountain },
  { k: "flow", icon: Siren },
  { k: "roadblock", icon: Users },
  { k: "seepage", icon: Droplets },
];

export default function FieldPwaView() {
  const { token, role, district } = useAppStore();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("home");
  const [lang, setLang] = useState<PwaLang>("en");
  const [online, setOnline] = useState(true);
  const [rType, setRType] = useState("crack");
  const [note, setNote] = useState("");
  const [verdict, setVerdict] = useState<EdgeVerdict | null>(null);
  const [queue, setQueue] = useState<QueuedReport[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [sample, setSample] = useState<string | null>(null);
  const { data: kpis } = usePoll<KpisOut>(api.kpis, 8000);
  const { data: alerts, refresh: refreshAlerts } = usePoll<AlertRow[]>(
    () => (online ? api.alerts(token) : Promise.resolve([])), 9000,
  );

  // load the offline queue from localStorage
  useEffect(() => {
    try {
      setQueue(JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"));
    } catch { /* corrupt queue — start fresh */ }
  }, []);
  const persist = (q: QueuedReport[]) => {
    setQueue(q);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  };

  // sample alert in the selected language (also works as the offline card)
  useEffect(() => {
    api.previewFire("MN-NON-002", lang)
      .then((r) => setSample(r.message))
      .catch(() => setSample(null));
  }, [lang]);

  const t = (k: string) => pwaT(lang, k);

  const submit = async () => {
    const item: QueuedReport = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: rType,
      note: note || "(no description)",
      zone_code: district ? `${district.slice(0, 3).toUpperCase()}-001` : "MN-NON-002",
      lat: 24.72, lon: 93.58,
      verdict: verdict ?? undefined,
      created_at: Date.now(),
    };
    if (online) {
      try {
        await api.createReport({
          zone_code: item.zone_code, type: item.type, note: item.note,
          lat: item.lat, lon: item.lon,
          photo_verdict: verdict ? { label: verdict.label, confidence: verdict.confidence } : undefined,
        });
        persist([{ ...item, ...{ status: undefined } }, ...queue].slice(0, 20));
        toast({ title: "Report sent", description: "Verified by Model V and delivered to the DC queue." });
      } catch (e) {
        toast({ title: "Send failed — queued offline", description: String(e) });
        persist([item, ...queue].slice(0, 20));
      }
    } else {
      persist([item, ...queue].slice(0, 20));
      toast({ title: "Saved offline", description: "Will sync automatically when connectivity returns." });
    }
    setNote("");
    setVerdict(null);
  };

  const goOnline = async () => {
    setOnline(true);
    const pending = queue.filter((q) => (q as any).status !== "synced");
    if (pending.length === 0) return;
    setSyncing(true);
    try {
      await api.syncReports(pending.map((p) => ({
        client_id: p.id, zone_code: p.zone_code, type: p.type, note: p.note,
        lat: p.lat, lon: p.lon,
        photo_verdict: p.verdict ? { label: p.verdict.label, confidence: p.verdict.confidence } : undefined,
        created_at: p.created_at,
      })));
      persist(queue.map((q) => ({ ...q, status: "synced" as any })));
      toast({ title: "Synced", description: `${pending.length} offline report(s) delivered — dedupe keys preserved.` });
      refreshAlerts();
    } catch (e) {
      toast({ title: "Sync failed", description: String(e), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const tabs = useMemo(() => ([
    { k: "home" as Tab, icon: Home, label: t("home") },
    { k: "report" as Tab, icon: FileText, label: t("report") },
    { k: "alerts" as Tab, icon: BellRing, label: t("alerts") },
  ]), [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 grid place-items-center p-4 overflow-y-auto bhu-scroll bg-surface">
      <div className="w-full max-w-[420px] rounded-xl border border-outline-variant bg-surface-low elevation-3 overflow-hidden flex flex-col"
        style={{ minHeight: 640, maxHeight: "min(860px, calc(100vh - 120px))" }}>
        {/* M3 top app bar */}
        <div className="flex items-center gap-2 px-4 h-16 bg-surface-container border-b border-outline-variant/60">
          <span className="h-9 w-9 rounded-full bg-primary-container grid place-items-center shrink-0">
            <MapPin className="h-4.5 w-4.5 h-[18px] w-[18px] text-on-primary-container" />
          </span>
          <div className="leading-tight min-w-0">
            <div className="text-title-sm truncate">{t("app")}</div>
            <div className="text-label-sm text-on-surface-variant truncate">
              {role === "citizen" ? "Citizen view" : "Field official"}{district ? ` · ${district}` : ""}
            </div>
          </div>
          <button
            onClick={() => setOnline(!online)}
            className={cn(
              "ml-auto flex items-center gap-1.5 h-8 px-3 rounded-full text-label-md border state-layer m3-press",
              online
                ? "bg-primary-container border-transparent text-on-primary-container"
                : "bg-error-container border-outline-variant/60 text-on-error-container",
            )}
            title={online ? t("online") : t("offline")}
          >
            {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {online ? t("online") : t("offline").split("—")[0]}
          </button>
        </div>

        {/* offline banner */}
        {!online && (
          <div className="px-4 py-2 bg-error-container text-on-error-container text-label-md flex items-center justify-between">
            <span className="truncate">{t("offline")}</span>
            <button onClick={goOnline} disabled={syncing}
              className="font-semibold underline underline-offset-2 disabled:opacity-50 shrink-0 ml-2">
              {t("goOnline")}
            </button>
          </div>
        )}

        {/* language row */}
        <div className="flex items-center gap-2 px-4 py-2.5 overflow-x-auto bhu-scroll bg-surface-low border-b border-outline-variant/40">
          <Languages className="h-3.5 w-3.5 text-on-surface-variant shrink-0" />
          {PWA_LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={cn(
                "px-3 h-7 rounded-full text-label-md whitespace-nowrap state-layer transition-colors",
                lang === l.code
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface-variant border border-outline-variant/60",
              )}
            >
              {l.native}
            </button>
          ))}
        </div>

        {/* content */}
        <div className="flex-1 overflow-y-auto bhu-scroll p-4 space-y-4">
          {tab === "home" && (
            <>
              <div className="rounded-lg border border-outline-variant/60 bg-surface-container p-4">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-10 rounded-full bg-tertiary-container text-on-tertiary-container grid place-items-center">
                    <Mountain className="h-5 w-5" />
                  </span>
                  <div>
                    <div className="text-title-sm">{t("zone")} MN-NON-002 · Noney</div>
                    <div className="text-label-md text-on-surface-variant">
                      L{Math.min(4, Math.ceil((kpis?.zones_l3_l4 ?? 1) / 8))} · {kpis?.total_zones ?? 43} zones monitored
                    </div>
                  </div>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-surface-highest overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-risk-0 to-risk-3" style={{ width: "45%" }} />
                </div>
              </div>

              <div className="rounded-lg border border-outline-variant/60 bg-surface-container p-4">
                <div className="text-label-md text-primary uppercase tracking-wider mb-2">{t("alertSample")}</div>
                {sample ? (
                  <p className="text-body-md leading-relaxed">{sample}</p>
                ) : (
                  <p className="text-body-sm text-on-surface-variant">…</p>
                )}
              </div>

              <Button variant="destructive" className="w-full" size="lg">
                <Siren className="h-4 w-4" /> {t("sos")}
              </Button>
            </>
          )}

          {tab === "report" && (
            <>
              <div className="rounded-lg border border-outline-variant/60 bg-surface-container p-4 space-y-4">
                <div>
                  <Label className="text-label-lg mb-2">{t("reportType")}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {TYPES.map(({ k, icon: Icon }) => (
                      <button
                        key={k}
                        onClick={() => setRType(k)}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-3 h-11 text-label-lg state-layer transition-colors border",
                          rType === k
                            ? "bg-secondary-container text-on-secondary-container border-transparent"
                            : "border-outline-variant/60 text-on-surface-variant",
                        )}
                      >
                        <Icon className="h-4 w-4" /> {t(`type_${k}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note" className="text-label-lg">{t("note")}</Label>
                  <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePh")} />
                </div>
                <EdgeVision onVerdict={setVerdict} />
                <Button onClick={submit} className="w-full" size="lg">
                  <Send className="h-4 w-4" /> {t("submit")}
                </Button>
              </div>

              <div className="rounded-lg border border-outline-variant/60 bg-surface-container p-4">
                <div className="text-label-md text-primary uppercase tracking-wider mb-2">
                  {queue.length} report(s) on device
                </div>
                {queue.length === 0 ? (
                  <p className="text-body-sm text-on-surface-variant/70">{t("empty")}</p>
                ) : (
                  <div className="space-y-2">
                    {queue.slice(0, 6).map((q) => (
                      <div key={q.id} className="rounded-md bg-surface p-3 border border-outline-variant/40">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-label-sm font-semibold",
                            (q as any).status === "synced"
                              ? "bg-primary-container text-on-primary-container"
                              : "bg-tertiary-container text-on-tertiary-container",
                          )}>
                            {(q as any).status === "synced" ? t("synced") : t("queued")}
                          </span>
                          <span className="text-label-md text-on-surface-variant">{t(`type_${q.type}`)}</span>
                          <span className="ml-auto text-label-sm text-on-surface-variant/60">
                            {new Date(q.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-label-lg mt-1 text-on-surface/90 line-clamp-2">{q.note}</p>
                        {q.verdict && (
                          <p className="text-label-sm text-tertiary mt-0.5">
                            Edge Vision: {q.verdict.label} ({(q.verdict.confidence * 100).toFixed(0)}%)
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "alerts" && (
            <div className="space-y-2">
              {(alerts ?? []).length === 0 && (
                <div className="rounded-lg border border-dashed border-outline-variant p-6 text-center text-body-sm text-on-surface-variant/60">
                  {online ? "No alerts in your area right now." : t("offline")}
                </div>
              )}
              {(alerts ?? []).slice(0, 15).map((a) => (
                <div key={a.id} className="rounded-lg border border-outline-variant/60 bg-surface-container p-3.5 flex items-start gap-2.5">
                  <span className="mt-1 h-2 w-2 rounded-full shrink-0" style={{ background: LEVEL_COLORS[Math.min(4, a.level)] }} />
                  <div className="min-w-0">
                    <p className="text-body-md leading-relaxed text-on-surface/90">{a.message}</p>
                    <p className="text-label-sm text-on-surface-variant/60 mt-0.5">
                      {a.zone_code} · {a.channels.join(" / ")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* M3 bottom navigation bar */}
        <nav className="flex h-20 bg-surface-container border-t border-outline-variant/60">
          {tabs.map(({ k, icon: Icon, label }) => {
            const active = tab === k;
            return (
              <button
                key={k}
                onClick={() => setTab(k)}
                className="flex-1 flex flex-col items-center justify-center gap-1 state-layer"
              >
                <span className={cn(
                  "h-8 w-16 rounded-full grid place-items-center transition-colors",
                  active ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant",
                )}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className={cn("text-label-md", active ? "text-on-surface" : "text-on-surface-variant")}>
                  {label}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
