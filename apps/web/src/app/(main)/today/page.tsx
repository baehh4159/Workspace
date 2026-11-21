/**
 * apps/web/src/app/(main)/today/page.tsx
 * Server Component loading real KST-aligned today events & active tasks (with projectId + isOwner).
 */
import React from 'react';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { TodayClientShell } from '@/components/today-client-shell';
import type { TodayEvent, TodayTask } from '@/components/today-view';
import type { WorkspaceTag } from '@/components/workspace-primitives';
import type { OnboardingState } from '@/components/onboarding-checklist';

export const dynamic = 'force-dynamic';

function getKstDayBounds(now = new Date()): { startIso: string; endIso: string } {
  const kstDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const start = new Date(`${kstDate}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86_400_000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

const JOIN_NOTICES: Record<string, string> = {
  joined: '팀 워크스페이스에 합류했습니다. 팀과 공유된 할 일과 일정이 여기에 함께 표시됩니다.',
  team_seat_limit_reached:
    '팀 좌석이 가득 차 합류하지 못했습니다. 팀 소유자에게 팀 플랜으로 좌석을 늘려 달라고 요청해 주세요.',
};

export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; joinError?: string }>;
}) {
  const { joined, joinError } = await searchParams;
  const initialNotice =
    joinError && Object.prototype.hasOwnProperty.call(JOIN_NOTICES, joinError)
      ? JOIN_NOTICES[joinError]
      : joined === '1'
        ? JOIN_NOTICES.joined
        : null;

  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  const wsId = session.activeWorkspace.id;
  const { startIso, endIso } = getKstDayBounds();

  const uid = session.user.id;
  const [countRes, eventsRes, tasksRes, tagsRes, memoRes, uploadRes, docTaskRes, shareRes] = await Promise.all([
    session.userClient
      .from('inbox_items')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wsId)
      .eq('triage_status', 'unprocessed'),
    session.userClient
      .from('events')
      .select(
        'id, title, is_all_day, timezone, starts_at, ends_at, location, visibility, project_id, owner_user_id'
      )
      .eq('workspace_id', wsId)
      .lt('starts_at', endIso)
      .gt('ends_at', startIso)
      .order('starts_at', { ascending: true })
      .limit(20),
    session.userClient
      .from('tasks')
      .select('id, title, status, due_at, visibility, project_id, owner_user_id')
      .eq('workspace_id', wsId)
      .in('status', ['todo', 'in_progress', 'waiting'])
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(30),
    session.userClient
      .from('tags')
      .select('id, label, kind, default_due_offset_days')
      .eq('workspace_id', wsId)
      .order('kind', { ascending: true })
      .order('label', { ascending: true }),
    // Onboarding checklist (head-only counts across the user's own items)
    session.userClient
      .from('inbox_items')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', uid)
      .in('source_type', ['quick_text', 'quick_tag', 'quick_voice']),
    session.userClient
      .from('inbox_items')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', uid)
      .eq('source_type', 'scanner_doc'),
    session.userClient
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', uid)
      .not('source_inbox_item_id', 'is', null),
    session.userClient
      .from('share_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', uid),
  ]);

  const onboarding: OnboardingState = {
    memo: (memoRes.count ?? 0) > 0,
    upload: (uploadRes.count ?? 0) > 0,
    docToTask: (docTaskRes.count ?? 0) > 0,
    invite: session.workspaces.some((w) => w.type === 'team') || (shareRes.count ?? 0) > 0,
  };

  const events: TodayEvent[] = (eventsRes.data ?? []).map((e) => ({
    id: e.id as string,
    title: e.title as string,
    isAllDay: Boolean(e.is_all_day),
    timezone: (e.timezone as string | null) ?? 'Asia/Seoul',
    startsAt: e.starts_at as string,
    endsAt: e.ends_at as string,
    location: (e.location as string | null) ?? null,
    visibility: e.visibility as 'private' | 'team',
    projectId: (e.project_id as string | null) ?? null,
    isOwner: e.owner_user_id === session.user.id,
  }));

  const initialTasks: TodayTask[] = (tasksRes.data ?? []).map((t) => ({
    id: t.id as string,
    title: t.title as string,
    status: t.status as TodayTask['status'],
    dueAt: (t.due_at as string | null) ?? null,
    visibility: t.visibility as 'private' | 'team',
    projectId: (t.project_id as string | null) ?? null,
    isOwner: t.owner_user_id === session.user.id,
  }));

  const tags: WorkspaceTag[] = (tagsRes.data ?? []).map((tag) => ({
    id: tag.id as string,
    label: tag.label as string,
    kind: tag.kind as WorkspaceTag['kind'],
    defaultDueOffsetDays: (tag.default_due_offset_days as number | null) ?? null,
  }));

  return (
    <TodayClientShell
      key={wsId}
      workspaceId={wsId}
      initialNotice={initialNotice}
      onboarding={onboarding}
      unprocessedCount={countRes.count ?? 0}
      events={events}
      initialTasks={initialTasks}
      tags={tags}
    />
  );
}
