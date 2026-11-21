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

  // Task progress per project (RLS hides other people's private tasks)
  const projectIds = (data ?? []).map((p) => p.id as string);
  const progress = new Map<string, { total: number; done: number; overdue: number; nextDueAt: string | null }>();
  if (projectIds.length > 0) {
    const { data: taskRows } = await session.userClient
      .from('tasks')
      .select('project_id, status, due_at')
      .eq('workspace_id', wsId)
      .in('project_id', projectIds)
      .limit(2000);
    const nowIso = new Date().toISOString();
    for (const t of taskRows ?? []) {
      const pid = t.project_id as string;
      const entry = progress.get(pid) ?? { total: 0, done: 0, overdue: 0, nextDueAt: null };
      entry.total += 1;
      if (t.status === 'done') {
        entry.done += 1;
      } else if (t.due_at) {
        const due = t.due_at as string;
        if (due < nowIso) entry.overdue += 1;
        else if (!entry.nextDueAt || due < entry.nextDueAt) entry.nextDueAt = due;
      }
      progress.set(pid, entry);
    }
  }

  const projects: ProjectListItem[] = (data ?? []).map((p) => {
    const stats = progress.get(p.id as string);
    return {
      id: p.id as string,
      title: p.title as string,
      visibility: p.visibility as 'private' | 'team',
      status: p.status as 'active' | 'archived',
      isOwner: p.owner_user_id === session.user.id,
      updatedAt: p.updated_at as string,
      taskTotal: stats?.total ?? 0,
      taskDone: stats?.done ?? 0,
      overdueCount: stats?.overdue ?? 0,
      nextDueAt: stats?.nextDueAt ?? null,
    };
  });

  return (
    <ProjectsView
      key={wsId}
      workspaceId={wsId}
      projects={projects}
      teamWorkspaces={teamWorkspaces}
    />
  );
}
