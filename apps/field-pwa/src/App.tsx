import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";

import { EdgeVisionInspector, type FissureAnalysisResult } from "./components/EdgeVisionInspector";
import { VoiceRecorder } from "./components/VoiceRecorder";
import { db, queueReport, syncQueue } from "./db";
import { LANGS, makeT, type LangCode } from "./i18n";

const API = (import.meta as any).env?.VITE_API_URL ?? "http://localhost:8000";
const CATEGORIES = ["crack", "slope_movement", "blocked_road", "past_slide", "water_seepage"] as const;

export default function App() {
  const [lang, setLang] = useState<LangCode>(
    () => (localStorage.getItem("bh_lang") as LangCode) || "en"
  );
  const t = makeT(lang);
  const [online, setOnline] = useState(navigator.onLine);
  const pending = useLiveQuery(() => db.reports.where("status").equals("pending").count(), [], 0);

  useEffect(() => localStorage.setItem("bh_lang", lang), [lang]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (navigator.onLine) syncQueue(API); // flush queue at boot
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className="mx-auto max-w-md px-4 pb-24 pt-6">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Bhu<span className="text-orange-500">Rakshak</span> Field
        </h1>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as LangCode)}
          className="rounded bg-[#111A2C] p-1.5 text-sm"
        >
          {LANGS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </header>

      {!online && (
        <div className="mb-3 rounded-lg bg-yellow-900/60 p-2.5 text-sm text-yellow-200">
          📴 {t("offline_banner")}
        </div>
      )}

      {/* Emergency Multi-Lingual Broadcast Banner */}
      <EmergencyBroadcastBanner t={t} lang={lang} />

      <CitizenBanner t={t} online={online} />

      <ReportSection t={t} />
      <QueueSection
        pending={pending ?? 0}
        t={t}
        onSync={async () => {
          const r = await syncQueue(API);
          alert(`${r.sent} synced`);
        }}
      />
    </div>
  );
}

function EmergencyBroadcastBanner({ t, lang }: { t: ReturnType<typeof makeT>; lang: LangCode }) {
  const alertText = t("emergency_alert");

  function speakAlert() {
    if (!window.speechSynthesis) {
      alert("Text-to-speech not supported on this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(alertText);
    if (lang === "hi") utterance.lang = "hi-IN";
    else if (lang === "bn") utterance.lang = "bn-IN";
    else if (lang === "ne") utterance.lang = "ne-NP";
    else utterance.lang = "en-IN";
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className="mb-4 rounded-xl border border-red-600/80 bg-red-950/70 p-3.5 shadow-lg shadow-red-950/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 animate-ping rounded-full bg-red-400" />
          <span className="text-xs font-black uppercase tracking-wider text-red-300">
            EMERGENCY BROADCAST (DDMA)
          </span>
        </div>
        <button
          onClick={speakAlert}
          className="flex items-center gap-1 rounded bg-red-900/80 px-2 py-1 text-[11px] font-bold text-red-200 ring-1 ring-red-500/50 hover:bg-red-800"
        >
          🔊 Read Aloud
        </button>
      </div>
      <p className="mt-2 text-xs font-semibold leading-relaxed text-red-100">
        {alertText}
      </p>
    </section>
  );
}

function CitizenBanner({ t, online }: { t: ReturnType<typeof makeT>; online: boolean }) {
  const [risk, setRisk] = useState<number | null>(null);
  useEffect(() => {
    // cached last-known risk; refresh when online (graceful offline)
    const cached = Number(localStorage.getItem("bh_risk") ?? "-1");
    setRisk(cached >= 0 ? cached : null);
    if (!online) return;
    navigator.geolocation?.getCurrentPosition(
      async ({ coords }) => {
        try {
          const zones = await fetch(
            `${API}/api/v1/zones?bbox=${coords.longitude - 0.05},${coords.latitude - 0.05},${coords.longitude + 0.05},${coords.latitude + 0.05}`
          ).then((r) => r.json());
          const maxLevel = Math.max(0, ...(zones?.map((z: any) => z.hazard_level) ?? [0]));
          setRisk(maxLevel);
          localStorage.setItem("bh_risk", String(maxLevel));
        } catch {
          /* keep cached */
        }
      },
      () => {},
      { timeout: 5000 }
    );
  }, [online]);

  const colors = ["#22C55E", "#EAB308", "#F97316"];
  return (
    <section className="mb-5 rounded-xl border border-[#1E293B] bg-[#111A2C] p-4">
      <div className="text-sm text-slate-400">{t("risk_now")}</div>
      <div className="mt-2 flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-6 flex-1 rounded ${risk !== null && i <= risk ? "" : "opacity-20"}`}
            style={{ background: colors[i] }}
          />
        ))}
      </div>
      <button
        onClick={() => {
          db.checkins.add({ ts: new Date().toISOString(), synced: 0 });
          navigator.vibrate?.([80, 40, 80]);
          alert(t("safe_checkin") + " ✓");
        }}
        className="mt-4 w-full rounded-lg bg-emerald-600 py-3 text-lg font-bold active:bg-emerald-700"
      >
        ✅ {t("safe_checkin")}
      </button>
    </section>
  );
}

function ReportSection({ t }: { t: ReturnType<typeof makeT> }) {
  const [category, setCategory] = useState<string>("crack");
  const [description, setDescription] = useState("");
  const [photoB64, setPhotoB64] = useState<string | null>(null);
  const [audioB64, setAudioB64] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [saved, setSaved] = useState(false);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoB64(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function save() {
    let lat: number | null = null;
    let lon: number | null = null;
    await new Promise<void>((resolve) => {
      navigator.geolocation?.getCurrentPosition(
        ({ coords }) => {
          lat = coords.latitude;
          lon = coords.longitude;
          resolve();
        },
        () => resolve(),
        { timeout: 6000 }
      );
    });
    await queueReport({
      category,
      lat,
      lon,
      description: description || undefined,
      photo_b64: photoB64 || undefined,
      audio_b64: audioB64 || undefined,
      audio_duration_sec: audioDuration || undefined,
    });
    navigator.vibrate?.(120);
    setDescription("");
    setPhotoB64(null);
    setAudioB64(null);
    setAudioDuration(0);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <section className="rounded-xl border border-[#1E293B] bg-[#111A2C] p-4">
      <h2 className="mb-3 text-lg font-bold">📷 {t("report")}</h2>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              category === c ? "bg-orange-600 text-white" : "bg-[#0B1220] text-slate-300"
            }`}
          >
            {t(c)}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-[#0B1220] p-2.5 text-xs text-slate-300 hover:border-orange-500">
          <span>📸 {photoB64 ? "Photo Attached ✓" : t("photo")}</span>
          <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
        </label>
      </div>

      {photoB64 && (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center justify-between text-xs text-emerald-400">
            <span>Photo attached (Base64 JPEG)</span>
            <button onClick={() => setPhotoB64(null)} className="text-rose-400 hover:underline">
              Remove
            </button>
          </div>
          <EdgeVisionInspector
            imageSrc={photoB64}
            onAnalysisComplete={(res) => {
              if (res.structuralRisk !== "SAFE" && !description.includes("Fissure density")) {
                setDescription(
                  (prev) =>
                    `${prev ? prev + " | " : ""}[Edge CV Analysis: ${res.structuralRisk.replace(/_/g, " ")} | Fissure density: ${res.fissureDensityPct}% | Max crack: ${res.maxCrackWidthPx}px]`
                );
              }
            }}
          />
        </div>
      )}

      {/* Dedicated Offline Voice Note Recorder */}
      <div className="mt-3">
        <VoiceRecorder
          onAudioRecorded={(b64, dur) => {
            setAudioB64(b64);
            setAudioDuration(dur);
          }}
          onAudioCleared={() => {
            setAudioB64(null);
            setAudioDuration(0);
          }}
          initialAudioB64={audioB64 || undefined}
          initialDurationSec={audioDuration}
        />
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("note_ph")}
        rows={2}
        className="mt-3 w-full rounded-lg bg-[#0B1220] p-3 text-sm outline-none"
      />
      <button onClick={save} className="mt-3 w-full rounded-lg bg-orange-600 py-4 text-lg font-bold active:bg-orange-700">
        {t("save")}
      </button>
      {saved && <p className="mt-2 text-center text-sm text-emerald-400">✓ Saved to offline queue — will sync</p>}
    </section>
  );
}

function QueueSection({
  pending,
  t,
  onSync,
}: {
  pending: number;
  t: ReturnType<typeof makeT>;
  onSync: () => void;
}) {
  return (
    <section className="mt-4 flex items-center justify-between rounded-xl border border-[#1E293B] bg-[#111A2C] px-4 py-3">
      <div className="text-sm">
        <b>{pending}</b> {t("pending")}
      </div>
      <button onClick={onSync} className="rounded-lg border border-[#334155] px-4 py-2 text-sm">
        ⟳ {t("send_queue")}
      </button>
    </section>
  );
}
