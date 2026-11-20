/**
 * apps/web/src/app/(main)/layout.tsx
 * Authenticated Server Component shell: loads real workspaces from Supabase and mounts WorkspaceSwitcher.
 * Shows the active plan next to the switcher; free workspaces get an always-visible upgrade entry point.
 */
import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { WorkspaceNav } from '@/components/workspace-nav';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { DEMO_MODE } from '@/lib/demo/mock-supabase';
import { BRAND } from '@/lib/brand';
import { planName, pricingHref } from '@/lib/plans';

export default async function MainWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  const activePlan = session.activeWorkspace.plan;

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-slate-900">
      {DEMO_MODE && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
          데모 모드 · 로그인 없이 샘플 데이터로 동작합니다 (변경 사항은 서버 재시작 시 초기화) ·{' '}
          <Link href="/" className="underline underline-offset-2">
            소개 페이지
          </Link>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-6">
              <Link href="/today" className="shrink-0 text-sm font-bold tracking-tight text-slate-900">
                {BRAND.name}
              </Link>
              <div className="hidden sm:block">
                <WorkspaceNav />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {activePlan === 'free' ? (
                <Link
                  href={pricingHref('header')}
                  className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  업그레이드
                </Link>
              ) : (
                <span className="rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                  {planName(activePlan)}
                </span>
              )}
              <WorkspaceSwitcher
                workspaces={session.workspaces.map((ws) => ({
                  id: ws.id,
                  name: ws.name,
                  type: ws.type,
                }))}
                activeWorkspaceId={session.activeWorkspace.id}
              />
            </div>
          </div>
          {/* Phones: full-width tab row so every section stays reachable */}
          <div className="-mx-1 pb-2 sm:hidden">
            <WorkspaceNav />
          </div>
        </div>
      </header>

      <main>{children}</main>
    </div>
  );
}
