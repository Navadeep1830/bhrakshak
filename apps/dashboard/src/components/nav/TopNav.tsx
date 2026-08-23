"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BarChart3, ClipboardList } from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/operations", label: "Operations", icon: ClipboardList },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="z-20 flex h-10 shrink-0 items-center gap-1 border-b border-edge bg-bg/60 px-4">
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
              active ? "bg-orange-600 text-white" : "text-muted hover:bg-panel hover:text-ink"
            )}
          >
            <Icon size={14} />
            {label}
          </Link>
        );
      })}
      <a
        href={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/briefing/pdf?district=East%20Khasi%20Hills`}
        target="_blank"
        rel="noreferrer"
        className="ml-auto flex items-center gap-2 rounded-lg border border-edge px-3 py-1.5 text-[12px] font-medium text-slate-300 transition-colors hover:border-orange-700 hover:text-white"
      >
        📄 DC Briefing PDF
      </a>
    </nav>
  );
}
