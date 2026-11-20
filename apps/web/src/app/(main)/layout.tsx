/**
 * apps/web/src/app/(main)/layout.tsx
 * Authenticated Server Component shell: loads real workspaces from Supabase and mounts WorkspaceSwitcher.
 */
import React from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { WorkspaceNav } from '@/components/workspace-nav';
import { WorkspaceSwitcher } from '@/components/workspace-switcher';
import { DEMO_MODE } from '@/lib/demo/mock-supabase';

export default async function MainWorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-slate-900">
      {DEMO_MODE && (
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
          데모 모드 · 로그인 없이 샘플 데이터로 동작합니다 (변경 사항은 서버 재시작 시 초기화)
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/today" className="text-sm font-bold tracking-tight text-slate-900">
              Workspace
            </Link>
            <WorkspaceNav />
          </div>

          <div className="flex items-center gap-2">
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
      </header>

      <main>{children}</main>
    </div>
  );
}
