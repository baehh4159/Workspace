/**
 * apps/web/src/app/(main)/search/page.tsx
 * Server Component resolving active workspace + plan and mounting SearchView.
 */
import React from 'react';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { SearchView } from '@/components/search-view';

export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <SearchView
      key={session.activeWorkspace.id}
      workspaceId={session.activeWorkspace.id}
      isFreePlan={session.activeWorkspace.plan === 'free'}
    />
  );
}
