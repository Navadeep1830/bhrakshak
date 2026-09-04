import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AppProviders } from '@/components/providers';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  variable: '--font-mono-num',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BhuRakshak — Landslide Early Warning Command Center',
  description:
    'AI-based early warning and landslide risk monitoring for North East India (SIH26001). Live hazard nowcast, evacuation routing, and district response intelligence.',
  icons: {
    icon:
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><polygon points="16,2 29,9 29,23 16,30 3,23 3,9" fill="#10b981"/><polygon points="16,7 25,12 25,20 16,25 7,20 7,12" fill="#070c14"/></svg>`
      ),
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#070c14',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrains.variable} antialiased`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
