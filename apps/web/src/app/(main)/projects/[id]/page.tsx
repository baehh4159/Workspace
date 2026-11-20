/**
 * apps/web/src/app/(main)/projects/[id]/page.tsx
 * Server Component loading RLS-filtered project, tasks (with isOwner), linked docs, and independent records.
 */
import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { UuidSchema } from '@workspace/core/schemas';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import {
  ProjectDetailView,
  type LinkedDocItem,
  type ProjectRecordItem,
  type ProjectTaskItem,
} from '@/components/project-detail-view';

export const dynamic = 'force-dynamic';

interface LinkedEntityRow {
  linked_type: string;
  linked_id: string;
  linked_title: string;
  linked_visibility: 'private' | 'team';
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) {
    notFound();
  }

  const wsId = session.activeWorkspace.id;

  const { data: project } = await session.userClient
    .from('projects')
    .select('id, title, visibility')
    .eq('id', id)
    .eq('workspace_id', wsId)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [tasksRes, linksRes] = await Promise.all([
    session.userClient
      .from('tasks')
      .select('id, title, status, due_at, visibility, owner_user_id')
      .eq('workspace_id', wsId)
      .eq('project_id', id)
      .order('created_at', { ascending: true })
      .limit(50),
    session.userClient.rpc('get_linked_entities', {
      p_workspace_id: wsId,
      p_entity_type: 'project',
      p_entity_id: id,
    }),
  ]);

  const linkedRows = (Array.isArray(linksRes.data) ? linksRes.data : []) as LinkedEntityRow[];
  const linkedDocs: LinkedDocItem[] = linkedRows
    .filter((r) => r.linked_type === 'inbox_item')
    .map((r) => ({
      id: r.linked_id,
      title: r.linked_title,
      visibility: r.linked_visibility,
    }));

  const linkedRecordIds = linkedRows
    .filter((r) => r.linked_type === 'record')
    .map((r) => r.linked_id);

  let initialRecords: ProjectRecordItem[] = [];
  if (linkedRecordIds.length > 0) {
    const { data: recRows } = await session.userClient
      .from('records')
      .select('id, author_user_id, visibility, content_markdown, updated_at')
      .eq('workspace_id', wsId)
      .in('id', linkedRecordIds)
      .order('updated_at', { ascending: false });

    initialRecords = (recRows ?? []).map((r) => ({
      id: r.id as string,
      contentMarkdown: r.content_markdown as string,
      visibility: r.visibility as 'private' | 'team',
      isAuthor: r.author_user_id === session.user.id,
      updatedAt: r.updated_at as string,
    }));
  }

  const initialTasks: ProjectTaskItem[] = (tasksRes.data ?? []).map((t) => ({
    id: t.id as string,
    title: t.title as string,
    status: t.status as ProjectTaskItem['status'],
    dueAt: (t.due_at as string | null) ?? null,
    visibility: t.visibility as 'private' | 'team',
    isOwner: t.owner_user_id === session.user.id,
  }));

  return (
    <ProjectDetailView
      key={project.id as string}
      workspaceId={wsId}
      project={{
        id: project.id as string,
        title: project.title as string,
        visibility: project.visibility as 'private' | 'team',
      }}
      initialTasks={initialTasks}
      initialRecords={initialRecords}
      linkedDocs={linkedDocs}
    />
  );
}
