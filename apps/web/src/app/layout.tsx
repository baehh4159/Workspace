import type { Metadata } from 'next';
import React from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Workspace — 스캔부터 실행까지',
  description: '개인 및 소규모 팀을 위한 스캔 문서·빠른 기록·할 일·일정 통합 워크스페이스',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#F7F8FA] text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
