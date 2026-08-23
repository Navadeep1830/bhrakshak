"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, FileText, LayoutDashboard } from "lucide-react";

import { endpoints } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/operations", label: "Operations", icon: ClipboardList },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="z-20 flex h-12 shrink-0 items-center justify-between border-b border-white/5 bg-bg/70 px-4">
      <div className="flex items-center gap-1 rounded-full glass p-1">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-300",
                active ? "bg-orange-600 text-white shadow-lg shadow-orange-900/40" : "text-muted hover:bg-white/5 hover:text-ink"
              )}
            >
              <Icon size={14} />
              {label}
            </Link>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden font-playfair text-[15px] italic text-slate-400 md:inline">
          “From reactive response to predictive protection.”
        </span>
        <a
          href={`${endpoints.API}/api/v1/briefing/pdf?district=East%20Khasi%20Hills`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-full border border-edge px-3.5 py-1.5 text-[12px] font-semibold text-slate-300 transition-all hover:border-orange-600 hover:bg-orange-950/40 hover:text-white"
        >
          <FileText size={13} /> DC Briefing
        </a>
      </div>
    </nav>
  );
}
