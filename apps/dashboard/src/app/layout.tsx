import type { Metadata, Viewport } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const roboto = Roboto({
  weight: ["300", "400", "500", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-roboto",
});

export const metadata: Metadata = {
  title: "BhuRakshak | Command Center — SIH26001",
  description:
    "AI Landslide Early Warning & Risk Intelligence Platform for the North Eastern Region (MDoNER · SIH26001). 4-layer warning: WHERE · WHEN · IS IT MOVING · WHO'S IN THE WAY.",
  keywords: ["BhuRakshak", "SIH26001", "landslide", "NER", "MDoNER", "early warning", "disaster management", "Material Design 3"],
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0F1512" },
    { media: "(prefers-color-scheme: light)", color: "#F7FAF3" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bhu dark" suppressHydrationWarning>
      <body className={`${roboto.variable} font-sans antialiased bg-surface text-on-surface`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
