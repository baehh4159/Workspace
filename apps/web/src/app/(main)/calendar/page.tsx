/**
 * apps/web/src/app/(main)/calendar/page.tsx
 * Server Component loading RLS-filtered native events (past 7d ~ next 30d KST) and active projects.
 */
import React from 'react';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import {
  CalendarView,
  type CalendarEventItem,
  type CalendarProjectOption,
} from '@/components/calendar-view';

export const dynamic = 'force-dynamic';

function getKstWindow(now = new Date()): {
  todayYmd: string;
  rangeStartIso: string;
  rangeEndIso: string;
} {
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const todayStart = new Date(`${todayYmd}T00:00:00+09:00`);
  const rangeStart = new Date(todayStart.getTime() - 7 * 86_400_000);
  const rangeEnd = new Date(todayStart.getTime() + 31 * 86_400_000);

  return {
    todayYmd,
    rangeStartIso: rangeStart.toISOString(),
    rangeEndIso: rangeEnd.toISOString(),
  };
}

export default async function CalendarPage() {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  const wsId = session.activeWorkspace.id;
  const { todayYmd, rangeStartIso, rangeEndIso } = getKstWindow();

  const [eventsRes, projectsRes] = await Promise.all([
    session.userClient
      .from('events')
      .select(
        'id, title, is_all_day, timezone, starts_at, ends_at, location, visibility, project_id, owner_user_id'
      )
      .eq('workspace_id', wsId)
      .lt('starts_at', rangeEndIso)
      .gt('ends_at', rangeStartIso)
      .order('starts_at', { ascending: true })
      .limit(100),
    session.userClient
      .from('projects')
      .select('id, title')
      .eq('workspace_id', wsId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(50),
  ]);

  const projects: CalendarProjectOption[] = (projectsRes.data ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
  }));
  const projectTitleMap = new Map(projects.map((p) => [p.id, p.title]));

  const initialEvents: CalendarEventItem[] = (eventsRes.data ?? []).map((e) => ({
    id: e.id as string,
    title: e.title as string,
    isAllDay: Boolean(e.is_all_day),
    timezone: (e.timezone as string | null) ?? 'Asia/Seoul',
    startsAt: e.starts_at as string,
    endsAt: e.ends_at as string,
    location: (e.location as string | null) ?? null,
    visibility: e.visibility as 'private' | 'team',
    projectId: (e.project_id as string | null) ?? null,
    projectTitle: e.project_id ? projectTitleMap.get(e.project_id as string) ?? null : null,
    isOwner: e.owner_user_id === session.user.id,
  }));

  return (
    <CalendarView
      key={wsId}
      workspaceId={wsId}
      defaultDate={todayYmd}
      initialEvents={initialEvents}
      projects={projects}
    />
  );
}
