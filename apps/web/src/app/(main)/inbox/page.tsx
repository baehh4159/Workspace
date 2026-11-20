/**
 * apps/web/src/app/(main)/inbox/page.tsx
 * Server Component loading real RLS-filtered inbox_items (with isOwner + hasOriginal),
 * active projects, and single-query batch entity tags (get_entity_tags_batch).
 */
import React from 'react';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { InboxClientShell } from '@/components/inbox-client-shell';
import type { InboxCardItem, ProjectOption } from '@/components/inbox-view';
import type { WorkspaceTag } from '@/components/workspace-primitives';

export const dynamic = 'force-dynamic';

interface BatchEntityTagRow {
  entity_id: string;
  tag_id: string;
  label: string;
  kind: 'status' | 'action_trigger';
  default_due_offset_days: number | null;
}

export default async function InboxPage() {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  const wsId = session.activeWorkspace.id;

  const [inboxRes, projectsRes] = await Promise.all([
    session.userClient
      .from('inbox_items')
      .select(
        'id, owner_user_id, source_type, title, summary_text, raw_text, visibility, triage_status, created_at, original_expires_at, storage_path, original_purged_at'
      )
      .eq('workspace_id', wsId)
      .in('triage_status', ['unprocessed', 'auto_folded'])
      .order('created_at', { ascending: false })
      .limit(50),
    session.userClient
      .from('projects')
      .select('id, title, visibility')
      .eq('workspace_id', wsId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(50),
  ]);

  const rawItems = inboxRes.data ?? [];
  const itemIds = rawItems.map((row) => row.id as string);

  const tagsByItemId = new Map<string, WorkspaceTag[]>();
  if (itemIds.length > 0) {
    const { data: tagRows } = await session.userClient.rpc('get_entity_tags_batch', {
      p_workspace_id: wsId,
      p_entity_type: 'inbox_item',
      p_entity_ids: itemIds,
    });

    for (const r of (Array.isArray(tagRows) ? tagRows : []) as BatchEntityTagRow[]) {
      const list = tagsByItemId.get(r.entity_id) ?? [];
      list.push({
        id: r.tag_id,
        label: r.label,
        kind: r.kind,
        defaultDueOffsetDays: r.default_due_offset_days,
      });
      tagsByItemId.set(r.entity_id, list);
    }
  }

  const initialItems: InboxCardItem[] = rawItems.map((row) => ({
    id: row.id as string,
    sourceType: row.source_type as InboxCardItem['sourceType'],
    title: (row.title as string | null) ?? null,
    summaryText: (row.summary_text as string | null) ?? null,
    rawText: (row.raw_text as string | null) ?? null,
    visibility: row.visibility as 'private' | 'team',
    triageStatus: row.triage_status as InboxCardItem['triageStatus'],
    createdAt: row.created_at as string,
    originalExpiresAt: (row.original_expires_at as string | null) ?? null,
    hasOriginal: Boolean(row.storage_path && !row.original_purged_at),
    isOwner: row.owner_user_id === session.user.id,
    tags: tagsByItemId.get(row.id as string) ?? [],
  }));

  const projects: ProjectOption[] = (projectsRes.data ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    visibility: p.visibility as 'private' | 'team',
  }));

  return (
    <InboxClientShell
      key={wsId}
      workspaceId={wsId}
      initialItems={initialItems}
      projects={projects}
    />
  );
}
