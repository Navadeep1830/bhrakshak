"use client";
// Material 3 Top App Bar — brand, segmented view switcher, live-risk chip,
// district filter, theme toggle, account chip.
import { useEffect } from "react";
import {
  ShieldCheck, LogOut, Mountain, Radar, BarChart3, Smartphone, TriangleAlert,
  Check, Sun, Moon, Satellite, FlaskConical,
} from "lucide-react";
import { useAppStore, type View } from "@/store/useAppStore";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client/api";
import { usePoll } from "@/hooks/use-poll";
import { useToast } from "@/hooks/use-toast";

const DISTRICTS = ["East Khasi Hills", "Noney", "Aizawl", "Imphal West", "Kohima", "Gangtok"];
const LIVE_MODE = process.env.NEXT_PUBLIC_API_URL ? true : false;

export default function TopNav() {
  const { view, setView, role, fullName, logout, districtFilter, setDistrictFilter, theme, setTheme } = useAppStore();
  const { toast } = useToast();
  const { data: kpis } = usePoll(api.kpis, 6000);
  const isCitizen = role === "citizen";

  // M3 light/dark scheme toggle (persisted).
  useEffect(() => {
    if (localStorage.getItem("bhu-theme") === "light") setTheme("light");
  }, [setTheme]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme !== "dark");
    localStorage.setItem("bhu-theme", theme);
  }, [theme]);

  const tabs: { v: View; label: string; short: string; icon: any }[] = [
    { v: "command", label: "Command Center", short: "Command", icon: Mountain },
    { v: "operations", label: "Operations", short: "Ops", icon: Radar },
    { v: "analytics", label: "Analytics", short: "Stats", icon: BarChart3 },
    { v: "pwa", label: "Field PWA", short: "Field", icon: Smartphone },
  ];
  const visible = tabs.filter((t) => !isCitizen || t.v === "pwa");
  const activeView = isCitizen ? "pwa" : view;
  const initials = (fullName ?? "B R")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-outline-variant">
      <div className="flex items-center gap-2 px-3 sm:gap-3 sm:px-4 h-16">
        {/* brand */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="h-10 w-10 rounded-lg bg-primary-container border border-outline-variant/50 grid place-items-center elevation-1">
            <ShieldCheck className="h-5 w-5 text-on-primary-container" />
          </div>
          <div className="leading-tight hidden sm:block">
            <div className="text-title-md text-on-surface">भूरक्षक</div>
            <div className="text-label-sm tracking-[0.2em] text-primary">BHURAKSHAK</div>
          </div>
        </div>

        {/* M3 segmented view switcher */}
        <nav
          aria-label="Views"
          className="flex items-center rounded-full border border-outline bg-surface h-10 ml-1 sm:ml-3 overflow-hidden"
        >
          {visible.map(({ v, label, short, icon: Icon }, i) => {
            const active = activeView === v;
            return (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-current={active}
                className={cn(
                  "flex items-center gap-1.5 h-full px-2.5 sm:px-4 text-label-md whitespace-nowrap state-layer transition-colors duration-200",
                  i > 0 && "border-l border-outline",
                  active
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface-variant",
                )}
              >
                {active ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-4 w-4" />}
                <span className="hidden lg:inline">{label}</span>
                <span className="lg:hidden">{short}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />

        {/* L3/L4 alert chip (error container, M3 tonal) */}
        {(kpis?.zones_l3_l4 ?? 0) > 0 && (
          <button
            onClick={() => setView("operations")}
            className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-error-container border border-outline-variant/50 text-on-error-container text-label-md state-layer m3-soft-pulse whitespace-nowrap"
          >
            <TriangleAlert className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{kpis!.zones_l3_l4} zones L3/L4</span>
            <span className="sm:hidden">L3/L4 · {kpis!.zones_l3_l4}</span>
          </button>
        )}

        {/* demo / live mode chip */}
        <span
          className="hidden md:inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-label-md border border-outline-variant/50 whitespace-nowrap"
          style={
            LIVE_MODE
              ? { background: "var(--tertiary-container)", color: "var(--on-tertiary-container)" }
              : { background: "var(--secondary-container)", color: "var(--on-secondary-container)" }
          }
          title={LIVE_MODE ? "Connected to the live FastAPI backend" : "Standalone demo instance (in-memory API)"}
        >
          {LIVE_MODE ? <Satellite className="h-3.5 w-3.5" /> : <FlaskConical className="h-3.5 w-3.5" />}
          {LIVE_MODE ? "LIVE API" : "DEMO"}
        </span>

        {/* district selector (non-citizen) */}
        {!isCitizen && (
          <Select value={districtFilter ?? "all"} onValueChange={(v) => setDistrictFilter(v === "all" ? null : v)}>
            <SelectTrigger size="sm" className="w-[150px]">
              <SelectValue placeholder="All districts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All districts</SelectItem>
              {DISTRICTS.map((d) => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* theme toggle */}
        <Button
          variant="ghost" size="iconSm"
          aria-label="Toggle color scheme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        {/* account chip */}
        <div className="hidden lg:flex items-center gap-2.5 pl-1 pr-3 h-10 rounded-full bg-surface-container border border-outline-variant/60">
          <span className="grid place-items-center h-7 w-7 rounded-full bg-tertiary-container text-on-tertiary-container text-label-sm">
            {initials}
          </span>
          <span className="text-right leading-tight">
            <span className="block text-label-md text-on-surface truncate max-w-[140px]">{fullName ?? "—"}</span>
            <span className="block text-label-sm text-primary/80 uppercase tracking-wider">{role}</span>
          </span>
        </div>

        <Button
          variant="ghost" size="iconSm"
          aria-label="Sign out"
          onClick={() => { logout(); toast({ title: "Signed out" }); }}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
