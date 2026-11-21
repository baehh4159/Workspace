/**
 * apps/web/src/components/marketing-shell.tsx
 * Public header/footer shared by the landing page (/) and the pricing page (/pricing).
 */
import React from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { COMPANY } from '@/lib/company';

export function MarketingHeader({
  signedIn,
  demoMode,
}: {
  signedIn: boolean;
  demoMode: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-sm font-bold tracking-tight text-slate-900">
            {BRAND.name}
          </Link>
          <nav className="hidden items-center gap-4 text-sm text-slate-600 sm:flex" aria-label="소개 메뉴">
            <Link href="/#how" className="hover:text-slate-900">
              사용 방법
            </Link>
            <Link href="/#use-cases" className="hover:text-slate-900">
              활용 사례
            </Link>
            <Link href="/pricing" className="hover:text-slate-900">
              요금제
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link
              href="/today"
              className="rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 sm:text-sm"
            >
              {demoMode ? '데모 열기' : '내 워크스페이스'}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:text-sm"
              >
                로그인
              </Link>
              <Link
                href="/login?next=/today"
                className="rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 sm:text-sm"
              >
                무료로 시작
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  // Korean e-commerce footer: show every business detail that has been filled in lib/company.ts
  const businessInfo = [
    COMPANY.legalName && `상호 ${COMPANY.legalName}`,
    COMPANY.representative && `대표 ${COMPANY.representative}`,
    COMPANY.businessNumber && `사업자등록번호 ${COMPANY.businessNumber}`,
    COMPANY.mailOrderNumber && `통신판매업 신고 ${COMPANY.mailOrderNumber}`,
    COMPANY.address && `주소 ${COMPANY.address}`,
    COMPANY.email && `이메일 ${COMPANY.email}`,
    COMPANY.phone && `전화 ${COMPANY.phone}`,
    COMPANY.legalName && COMPANY.hostingProvider && `호스팅 ${COMPANY.hostingProvider}`,
  ].filter(Boolean) as string[];

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 text-xs text-slate-500 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <span className="font-semibold text-slate-700">{BRAND.name}</span> · {BRAND.tagline}
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-1" aria-label="하단 메뉴">
            <Link href="/pricing" className="hover:text-slate-800">
              요금제
            </Link>
            <Link href="/legal/terms" className="hover:text-slate-800">
              이용약관
            </Link>
            <Link href="/legal/privacy" className="font-semibold text-slate-700 hover:text-slate-900">
              개인정보처리방침
            </Link>
            <Link href="/legal/refund" className="hover:text-slate-800">
              환불정책
            </Link>
            <Link href="/login" className="hover:text-slate-800">
              로그인
            </Link>
          </nav>
        </div>
        {businessInfo.length > 0 && <p className="leading-relaxed text-slate-400">{businessInfo.join(' · ')}</p>}
      </div>
    </footer>
  );
}
