/**
 * apps/web/src/components/marketing-shell.tsx
 * Public header/footer shared by the landing page (/) and the pricing page (/pricing).
 */
import React from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

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
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-semibold text-slate-700">{BRAND.name}</span> · {BRAND.tagline}
        </p>
        <nav className="flex gap-4" aria-label="하단 메뉴">
          <Link href="/pricing" className="hover:text-slate-800">
            요금제
          </Link>
          <Link href="/login" className="hover:text-slate-800">
            로그인
          </Link>
        </nav>
      </div>
    </footer>
  );
}
