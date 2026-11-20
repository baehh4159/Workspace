import type { Metadata } from 'next';
import React from 'react';
import './globals.css';
import { BRAND } from '@/lib/brand';
import { DialogProvider } from '@/components/dialog-provider';

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: BRAND.description,
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description: BRAND.description,
    locale: 'ko_KR',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#F7F8FA] text-slate-900 antialiased">
        <DialogProvider>{children}</DialogProvider>
      </body>
    </html>
  );
}
