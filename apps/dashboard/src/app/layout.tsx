import type { Metadata } from "next";
import { Inter } from "next/font/google";

import { ChatWidget } from "@/components/chat/ChatWidget";
import { KpiBar } from "@/components/kpi/KpiBar";
import { TopNav } from "@/components/nav/TopNav";
import { Ticker } from "@/components/ticker/Ticker";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BhuRakshak | Command Center",
  description:
    "AI Landslide Early Warning & Risk Intelligence Platform for North Eastern Region (SIH26001)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={inter.className}>
        <main className="flex h-screen flex-col overflow-hidden">
          <KpiBar />
          <TopNav />
          <div className="relative flex-1 overflow-hidden">
            <div className="aurora" aria-hidden />
            {children}
          </div>
          <Ticker />
          <ChatWidget />
        </main>
      </body>
    </html>
  );
}
