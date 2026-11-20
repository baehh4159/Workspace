'use client';

/**
 * apps/web/src/components/calendar-view.tsx
 * Native Events Calendar View with 3-zone Context Menu & ⋯ trigger:
 *  - Right-click / ⋯ menu: 제목·장소 수정(소유자), 연결 프로젝트 이동, 나만/팀 전환(소유자), 일정 삭제(소유자)
 *  - Compact 1-row quick event creator (expands on focus or toggle)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VisibilityBadge } from '@/components/workspace-primitives';
import { ContextMenuWrapper, type ContextMenuItem } from '@/components/context-menu';

export interface CalendarEventItem {
  id: string;
  title: string;
  isAllDay: boolean;
  timezone: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  visibility: 'private' | 'team';
  projectId: string | null;
  projectTitle: string | null;
  isOwner: boolean;
}

export interface CalendarProjectOption {
  id: string;
  title: string;
}

function addOneDay(ymd: string): string {
  const base = new Date(`${ymd}T00:00:00+09:00`);
  const next = new Date(base.getTime() + 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(next);
}

function kstDateKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function formatDateHeading(ymd: string): string {
  return new Date(`${ymd}T00:00:00+09:00`).toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

export function CalendarView({
  workspaceId,
  defaultDate,
  initialEvents,
  projects,
}: {
  workspaceId: string;
  defaultDate: string;
  initialEvents: CalendarEventItem[];
  projects: CalendarProjectOption[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState<CalendarEventItem[]>(initialEvents);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [isAllDay, setIsAllDay] = useState(false);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [location, setLocation] = useState('');
  const [projectId, setProjectId] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'team'>('private');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const evt of events) {
      const key = kstDateKey(evt.startsAt);
      const list = map.get(key) ?? [];
      list.push(evt);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !title.trim() || !date) return;

    const startsAtIso = isAllDay
      ? new Date(`${date}T00:00:00+09:00`).toISOString()
      : new Date(`${date}T${startTime}:00+09:00`).toISOString();
    const endsAtIso = isAllDay
      ? new Date(`${addOneDay(date)}T00:00:00+09:00`).toISOString()
      : new Date(`${date}T${endTime}:00+09:00`).toISOString();

    if (new Date(endsAtIso) <= new Date(startsAtIso)) {
      setErrorMsg('종료 시각은 시작 시각보다 늦어야 합니다.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          projectId: projectId || null,
          visibility,
          title: title.trim(),
          isAllDay,
          timezone: 'Asia/Seoul',
          startsAt: startsAtIso,
          endsAt: endsAtIso,
          location: location.trim() || null,
        }),
      });
      if (!res.ok) {
        setErrorMsg('일정 등록에 실패했습니다. 입력 내용을 확인해 주세요.');
        return;
      }
      setTitle('');
      setLocation('');
      setProjectId('');
      setExpanded(false);
      router.refresh();
    } catch {
      setErrorMsg('네트워크 오류로 일정을 등록하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditEvent = async (evt: CalendarEventItem) => {
    const nextTitle = window.prompt('일정 제목을 수정하세요:', evt.title);
    if (nextTitle === null || !nextTitle.trim()) return;
    const nextLoc = window.prompt('장소를 수정하세요 (비워두면 삭제):', evt.location ?? '');
    if (nextLoc === null) return;

    setErrorMsg(null);
    const prev = events;
    setEvents((cur) =>
      cur.map((e) =>
        e.id === evt.id ? { ...e, title: nextTitle.trim(), location: nextLoc.trim() || null } : e
      )
    );
    try {
      const res = await fetch(`/api/events/${evt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nextTitle.trim(), location: nextLoc.trim() || null }),
      });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setEvents(prev);
      setErrorMsg('일정 수정에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const handleToggleVisibility = async (evt: CalendarEventItem) => {
    const nextVis: 'private' | 'team' = evt.visibility === 'private' ? 'team' : 'private';
    setErrorMsg(null);
    const prev = events;
    setEvents((cur) => cur.map((e) => (e.id === evt.id ? { ...e, visibility: nextVis } : e)));
    try {
      const res = await fetch(`/api/events/${evt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: nextVis }),
      });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setEvents(prev);
      setErrorMsg('일정 공개 범위 변경에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const handleDelete = async (eventId: string) => {
    if (!window.confirm('이 일정을 영구 삭제할까요?')) return;
    const prev = events;
    setErrorMsg(null);
    setEvents((cur) => cur.filter((e) => e.id !== eventId));
    try {
      const res = await fetch(`/api/events/${eventId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setEvents(prev);
      setErrorMsg('일정 삭제에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const buildEventMenuItems = (evt: CalendarEventItem): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (evt.isOwner) {
      items.push({
        id: 'edit',
        label: '제목·장소 수정',
        group: 1,
        onSelect: () => void handleEditEvent(evt),
      });
    }
    if (evt.projectId) {
      items.push({
        id: 'open-project',
        label: '연결 프로젝트로 이동',
        group: 1,
        onSelect: () => router.push(`/projects/${evt.projectId}`),
      });
    }
    if (evt.isOwner) {
      items.push({
        id: 'toggle-vis',
        label: evt.visibility === 'private' ? '팀 공유로 전환' : '나만 보기로 전환',
        group: 2,
        tone: 'owner',
        onSelect: () => void handleToggleVisibility(evt),
      });
      items.push({
        id: 'delete',
        label: '일정 삭제',
        group: 3,
        tone: 'danger',
        onSelect: () => void handleDelete(evt.id),
      });
    }
    return items;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-lg font-bold tracking-tight text-slate-900">일정</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          최근 7일 ~ 앞으로 30일 일정을 표시합니다 (기준 시간대: Asia/Seoul).
        </p>
      </header>

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            type="text"
            value={title}
            onFocus={() => setExpanded(true)}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            placeholder="새 일정 제목 (예: 거래처 계약서 최종 미팅)"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60"
          />
          <input
            type="date"
            value={date}
            onFocus={() => setExpanded(true)}
            onChange={(e) => setDate(e.target.value)}
            disabled={submitting}
            className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-2.5 py-2 text-xs text-slate-800"
          />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {expanded ? '접기' : '옵션'}
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="shrink-0 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {submitting ? '등록 중...' : '추가'}
          </button>
        </div>

        {expanded && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2.5 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 text-slate-700">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
              />
              종일
            </label>

            {!isAllDay && (
              <>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={submitting}
                  className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-2 py-1.5 text-slate-800"
                />
                <span className="text-slate-400">~</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  disabled={submitting}
                  className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-2 py-1.5 text-slate-800"
                />
              </>
            )}

            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={submitting}
              placeholder="장소 (선택)"
              className="w-36 rounded-lg border border-slate-200 bg-[#F7F8FA] px-2.5 py-1.5 text-slate-800 placeholder:text-slate-400"
            />

            {projects.length > 0 && (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={submitting}
                className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-2.5 py-1.5 text-slate-800"
              >
                <option value="">프로젝트 연결 안 함</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => setVisibility((v) => (v === 'private' ? 'team' : 'private'))}
              className="ml-auto"
              aria-label="일정 공개 범위 전환"
            >
              <VisibilityBadge visibility={visibility} />
            </button>
          </div>
        )}

        {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
      </form>

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">예정된 일정이 없습니다.</p>
          <p className="mt-1 text-xs text-slate-500">위에서 새 일정을 추가해 보세요.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([dayKey, dayEvents]) => (
            <section key={dayKey} className="space-y-2">
              <h2 className="text-xs font-semibold text-slate-500">
                {formatDateHeading(dayKey)}
              </h2>
              <ul className="space-y-2">
                {dayEvents.map((evt) => {
                  const tz = evt.timezone || 'Asia/Seoul';
                  return (
                    <li key={evt.id}>
                      <ContextMenuWrapper
                        items={buildEventMenuItems(evt)}
                        ariaLabel={`${evt.title} 일정 메뉴`}
                      >
                        {({ triggerButton }) => (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900">{evt.title}</p>
                                {evt.projectTitle && (
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                                    {evt.projectTitle}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-slate-500">
                                {evt.isAllDay
                                  ? '종일'
                                  : `${new Date(evt.startsAt).toLocaleTimeString('ko-KR', {
                                      timeZone: tz,
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })} – ${new Date(evt.endsAt).toLocaleTimeString('ko-KR', {
                                      timeZone: tz,
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}`}
                                {evt.location ? ` · ${evt.location}` : ''}
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5">
                              <VisibilityBadge visibility={evt.visibility} />
                              {triggerButton}
                            </div>
                          </div>
                        )}
                      </ContextMenuWrapper>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
