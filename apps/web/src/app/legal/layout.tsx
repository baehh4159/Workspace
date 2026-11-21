/**
 * apps/web/src/app/legal/layout.tsx
 * Shared shell for 이용약관 / 개인정보처리방침 / 환불정책.
 * Shows a "draft" banner until COMPANY.legalReviewed is set.
 */
import React from 'react';
import Link from 'next/link';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { DEMO_MODE } from '@/lib/demo/mock-supabase';
import { COMPANY } from '@/lib/company';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-shell';

const LEGAL_NAV = [
  { href: '/legal/terms', label: '이용약관' },
  { href: '/legal/privacy', label: '개인정보처리방침' },
  { href: '/legal/refund', label: '환불정책' },
];

export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerWorkspaceSession().catch(() => null);
  return (
    <div className="min-h-screen bg-[#F7F8FA] text-slate-900">
      <MarketingHeader signedIn={Boolean(session)} demoMode={DEMO_MODE} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-10 sm:px-6">
        {!COMPANY.legalReviewed && (
          <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
            <strong className="font-semibold">초안입니다.</strong> 서비스 공개와 결제 오픈 전에 회사 정보를 채우고 법률 전문가의
            검토를 받으세요. 노란색 표시는 결정하거나 확인해야 할 부분입니다. (apps/web/src/lib/company.ts)
          </div>
        )}
        <nav className="flex gap-1" aria-label="약관 목록">
          {LEGAL_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
