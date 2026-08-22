import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";

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
  const [saved, setSaved] = useState(false);

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
    await queueReport({ category, lat, lon, description: description || undefined });
    navigator.vibrate?.(120);
    setDescription("");
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
      {saved && <p className="mt-2 text-center text-sm text-emerald-400">✓ Saved — will sync</p>}
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
