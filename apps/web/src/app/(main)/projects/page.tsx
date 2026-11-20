/**
 * apps/web/src/app/(main)/projects/page.tsx
 * Server Component listing RLS-filtered projects with isOwner + teamWorkspaces for context menu actions.
 */
import React from 'react';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { ProjectsView, type ProjectListItem } from '@/components/projects-view';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  const wsId = session.activeWorkspace.id;
  const teamWorkspaces =
    session.activeWorkspace.type === 'personal'
      ? session.workspaces
          .filter((w) => w.type === 'team')
          .map((w) => ({ id: w.id, name: w.name }))
      : [];

  const { data } = await session.userClient
    .from('projects')
    .select('id, title, visibility, status, owner_user_id, updated_at')
    .eq('workspace_id', wsId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(50);

  const projects: ProjectListItem[] = (data ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    visibility: p.visibility as 'private' | 'team',
    status: p.status as 'active' | 'archived',
    isOwner: p.owner_user_id === session.user.id,
    updatedAt: p.updated_at as string,
  }));

  return (
    <ProjectsView
      key={wsId}
      workspaceId={wsId}
      projects={projects}
      teamWorkspaces={teamWorkspaces}
    />
  );
}
