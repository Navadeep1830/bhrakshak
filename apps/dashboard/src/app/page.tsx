"use client";
// BhuRakshak root — login gate + view router (single-page app).
import { useState } from "react";
import { ShieldCheck, Loader2, LogIn, Mountain, Radar, Activity, Smartphone } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import TopNav from "@/components/nav/TopNav";
import CommandCenter from "@/components/views/CommandCenter";
import OperationsView from "@/components/views/OperationsView";
import AnalyticsView from "@/components/views/AnalyticsView";
import FieldPwaView from "@/components/views/FieldPwaView";
import ChatWidget from "@/components/chat/ChatWidget";

const QUICK_USERS = [
  { email: "admin@bhrakshak.in", password: "Admin@123", label: "Platform Admin", hint: "everything" },
  { email: "dc.ekh@bhrakshak.in", password: "District@123", label: "DC East Khasi Hills", hint: "district view" },
  { email: "dc.aizawl@bhrakshak.in", password: "District@123", label: "DC Aizawl", hint: "district view" },
  { email: "field.noney@bhrakshak.in", password: "Field@123", label: "Field Official · Noney", hint: "ops + PWA" },
  { email: "citizen@bhrakshak.in", password: "Citizen@123", label: "Citizen · Noney", hint: "PWA view" },
];

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("admin@bhrakshak.in");
  const [password, setPassword] = useState("Admin@123");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const setAuth = useAppStore((s) => s.setAuth);

  const signIn = async (e?: string, p?: string) => {
    setBusy(true);
    try {
      const out = await api.login(e ?? email, p ?? password);
      setAuth({
        token: out.access_token,
        role: out.role,
        email: out.user.email,
        fullName: out.user.full_name,
        district: out.user.district,
      });
      onDone();
    } catch (err) {
      toast({ title: "Login failed", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "radial-gradient(1200px 600px at 70% -10%, color-mix(in srgb, var(--surface-container-high) 70%, var(--surface)) 0%, var(--surface) 60%)" }}>
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-6 items-stretch">
        {/* brand panel */}
        <div className="hidden md:flex flex-col justify-between rounded-xl border border-outline-variant/60 bg-surface-low/80 p-8 elevation-1">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-lg bg-primary-container grid place-items-center elevation-1">
                <ShieldCheck className="h-6 w-6 text-on-primary-container" />
              </div>
              <div>
                <div className="text-headline-sm font-medium tracking-tight">भूरक्षक</div>
                <div className="text-label-md tracking-[0.25em] text-primary">BHURAKSHAK</div>
              </div>
            </div>
            <p className="mt-6 text-body-md leading-6 text-on-surface-variant">
              AI-Based Early Warning &amp; Landslide Risk Monitoring System for the
              North Eastern Region. Four fused layers — susceptibility, hazard
              nowcast, PSInSAR deformation, exposure — one ranked response queue.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-8">
            {[
              { icon: Mountain, t: "43 zones · 6 districts", s: "Model A hexes" },
              { icon: Radar, t: "I-D + ML fusion", s: "hysteresis ladder" },
              { icon: Activity, t: "8 languages", s: "SMS / IVR / siren" },
              { icon: Smartphone, t: "Offline-first PWA", s: "sync + dedupe" },
            ].map(({ icon: Icon, t, s }) => (
              <div key={t} className="rounded-md border border-outline-variant/50 bg-surface-container p-3.5">
                <Icon className="h-4 w-4 text-primary mb-2" />
                <div className="text-label-lg">{t}</div>
                <div className="text-label-sm text-on-surface-variant/70">{s}</div>
              </div>
            ))}
          </div>
          <div className="text-label-sm text-on-surface-variant/60 mt-6">SIH 26001 · MDoNER · Disaster Management</div>
        </div>

        {/* login card */}
        <div className="rounded-xl border border-outline-variant/60 bg-surface-low p-8 flex flex-col elevation-2">
          <h1 className="text-title-lg font-medium">Sign in to Command Center</h1>
          <p className="text-body-sm text-on-surface-variant mt-1">Demo instance — pick a role or type credentials.</p>

          <div className="mt-6 space-y-2">
            {QUICK_USERS.map((u) => (
              <button
                key={u.email}
                onClick={() => { setEmail(u.email); setPassword(u.password); signIn(u.email, u.password); }}
                disabled={busy}
                className="w-full flex items-center justify-between rounded-md border border-outline-variant/60 bg-surface-container px-4 py-3 text-left state-layer hover:border-primary/60 transition-colors disabled:opacity-40"
              >
                <div>
                  <div className="text-body-md font-medium">{u.label}</div>
                  <div className="text-label-md text-on-surface-variant/70">{u.email}</div>
                </div>
                <span className="text-label-sm uppercase tracking-wider text-primary/80">{u.hint}</span>
              </button>
            ))}
          </div>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-label-lg">Email</Label>
              <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-label-lg">Password</Label>
              <Input id="password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && signIn()} />
            </div>
            <Button onClick={() => signIn()} disabled={busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Sign in
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const { token, role, view } = useAppStore();
  const [ready, setReady] = useState(false);
  if (!token) return <Login onDone={() => setReady(true)} />;

  const isCitizen = role === "citizen";
  const active = isCitizen ? "pwa" : view;

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <main className="flex-1 flex flex-col">
        {active === "command" && <CommandCenter />}
        {active === "operations" && <OperationsView />}
        {active === "analytics" && <AnalyticsView />}
        {active === "pwa" && <FieldPwaView />}
      </main>
      <ChatWidget />
    </div>
  );
}
