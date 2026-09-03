"use client";
// Edge Vision — simulated on-device photo triage (Model V style).
// Deterministic "inference" from the file bytes so the same photo always
// yields the same verdict — exactly like a quantized on-device model with
// no network round-trip. Works fully offline.
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface EdgeVerdict {
  label: string;
  confidence: number;
  recommendation: string;
}

const CLASSES: EdgeVerdict[] = [
  { label: "Stable slope (no signs)", confidence: 0.93, recommendation: "No action. Re-check after next heavy rain." },
  { label: "Minor seepage / erosion", confidence: 0.81, recommendation: "Monitor. Report again if cracks widen." },
  { label: "Active crack on slope", confidence: 0.78, recommendation: "Cordon area. Field inspection within 48 h." },
  { label: "Debris flow scar", confidence: 0.86, recommendation: "Escalate to DC. Road likely at risk." },
  { label: "Blocked road, fresh slide", confidence: 0.9, recommendation: "Immediate road closure + ops dispatch." },
];

const ICONS = [ShieldCheck, TriangleAlert, TriangleAlert, ShieldAlert, ShieldAlert];

function hashBytes(b: ArrayBuffer): number {
  const u = new Uint8Array(b);
  let h = 2166136261;
  for (let i = 0; i < u.length; i += 7919) {
    h ^= u[i];
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export default function EdgeVision({ onVerdict }: { onVerdict?: (v: EdgeVerdict) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<EdgeVerdict | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => () => { verdict && onVerdict?.(verdict); }, [verdict, onVerdict]);

  const analyze = async (f: File) => {
    setBusy(true);
    setVerdict(null);
    setFileName(f.name);
    try {
      const buf = await f.arrayBuffer();
      // simulated on-device latency (150-600 ms) — real model runs at the edge
      await new Promise((r) => setTimeout(r, 350 + (hashBytes(buf) % 250)));
      const v = CLASSES[hashBytes(buf) % CLASSES.length];
      setVerdict(v);
      onVerdict?.(v);
    } finally {
      setBusy(false);
    }
  };

  const idx = verdict ? CLASSES.findIndex((c) => c.label === verdict.label) : 0;
  const Icon = ICONS[Math.max(0, idx)];

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) analyze(f);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outlined"
        size="sm"
        className="w-full"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        {busy ? "Analyzing on device…" : "Add photo (Edge Vision)"}
      </Button>

      {verdict && (
        <div className={`rounded-md border p-3 flex items-start gap-3 ${
          idx >= 3
            ? "bg-error-container border-outline-variant/60 text-on-error-container"
            : "bg-secondary-container border-outline-variant/60 text-on-secondary-container"
        }`}>
          <span className="h-9 w-9 rounded-full grid place-items-center bg-surface/40 shrink-0">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="text-label-lg font-semibold">
              {verdict.label} · {(verdict.confidence * 100).toFixed(0)}%
            </div>
            <div className="text-label-md opacity-90 leading-relaxed">{verdict.recommendation}</div>
            {fileName && <div className="text-label-sm opacity-60 mt-0.5 truncate">{fileName}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
