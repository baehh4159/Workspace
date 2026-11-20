'use client';

/**
 * apps/web/src/components/today-view.tsx
 * Execution-Focused Today View + Unified Quick Capture + 3-Zone Context Menus on Task & Event rows:
 *  - Syncs local tasks & events state whenever server props refresh
 *  - Preserves user memo/tags if onQuickCapture fails; rolls back optimistic mutations on failure
 *  - Native right-click stays untouched inside Quick Capture input
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TagChip, VisibilityBadge, type WorkspaceTag } from '@/components/workspace-primitives';
import { ContextMenuWrapper, type ContextMenuItem } from '@/components/context-menu';

export interface TodayEvent {
  id: string;
  title: string;
  isAllDay: boolean;
  timezone: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  visibility: 'private' | 'team';
  projectId?: string | null;
  isOwner?: boolean;
}

export interface TodayTask {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'waiting' | 'done';
  dueAt: string | null;
  visibility: 'private' | 'team';
  projectId?: string | null;
  isOwner?: boolean;
}

const DEFAULT_TAGS: WorkspaceTag[] = [
  { id: 'status-waiting', label: '회신 대기', kind: 'status' },
  { id: 'status-done', label: '완료', kind: 'status' },
  { id: 'action-tomorrow', label: '내일 확인', kind: 'action_trigger', defaultDueOffsetDays: 1 },
  { id: 'action-followup', label: '2주 뒤 재연락', kind: 'action_trigger', defaultDueOffsetDays: 14 },
];

const MAX_VOICE_SECONDS = 30;

function formatTimer(sec: number): string {
  return `00:${String(sec).padStart(2, '0')}`;
}

export function TodayView({
  unprocessedCount = 0,
  events: initialEvents = [],
  initialTasks = [],
  tags = DEFAULT_TAGS,
  onQuickCapture,
  onToggleTask,
  onUpdateTask,
  onDeleteTask,
  onUpdateEventVisibility,
  onDeleteEvent,
}: {
  unprocessedCount?: number;
  events?: TodayEvent[];
  initialTasks?: TodayTask[];
  tags?: WorkspaceTag[];
  onQuickCapture?: (payload: {
    rawText: string;
    tagIds: string[];
    visibility: 'private' | 'team';
  }) => Promise<void>;
  onToggleTask?: (taskId: string) => Promise<void>;
  onUpdateTask?: (
    taskId: string,
    patch: { title?: string; visibility?: 'private' | 'team' }
  ) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateEventVisibility?: (eventId: string, visibility: 'private' | 'team') => Promise<void>;
  onDeleteEvent?: (eventId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<TodayTask[]>(initialTasks);
  const [events, setEvents] = useState<TodayEvent[]>(initialEvents);
  const [rawText, setRawText] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'private' | 'team'>('private');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      setElapsedSec((prev) => {
        if (prev + 1 >= MAX_VOICE_SECONDS) {
          setIsRecording(false);
          return MAX_VOICE_SECONDS;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleVoice = () => {
    if (isRecording) {
      setIsRecording(false);
    } else {
      setElapsedSec(0);
      setIsRecording(true);
    }
  };

  const handleCancelVoice = () => {
    setIsRecording(false);
    setElapsedSec(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!rawText.trim() && selectedTagIds.length === 0) return;

    setIsSubmitting(true);
    try {
      if (onQuickCapture) {
        await onQuickCapture({ rawText: rawText.trim(), tagIds: selectedTagIds, visibility });
      }
      setRawText('');
      setSelectedTagIds([]);
    } catch {
      // Preserve unsaved input on failure
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheck = async (taskId: string) => {
    const prevTask = tasks.find((t) => t.id === taskId);
    const prevStatus = prevTask?.status;

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: t.status === 'done' ? 'todo' : 'done' } : t))
    );

    if (onToggleTask) {
      try {
        await onToggleTask(taskId);
      } catch {
        if (prevStatus) {
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: prevStatus } : t))
          );
        }
      }
    }
  };

  const handleEditTaskTitle = async (task: TodayTask) => {
    if (!onUpdateTask) return;
    const nextTitle = window.prompt('할 일 제목을 수정하세요:', task.title);
    if (nextTitle === null || !nextTitle.trim()) return;
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, title: nextTitle.trim() } : t)));
    try {
      await onUpdateTask(task.id, { title: nextTitle.trim() });
    } catch {
      setTasks(prev);
    }
  };

  const handleToggleTaskVisibility = async (task: TodayTask) => {
    if (!onUpdateTask) return;
    const nextVis: 'private' | 'team' = task.visibility === 'private' ? 'team' : 'private';
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, visibility: nextVis } : t)));
    try {
      await onUpdateTask(task.id, { visibility: nextVis });
    } catch {
      setTasks(prev);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!onDeleteTask) return;
    if (!window.confirm('이 할 일을 영구 삭제할까요?')) return;
    const prev = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== taskId));
    try {
      await onDeleteTask(taskId);
    } catch {
      setTasks(prev);
    }
  };

  const handleToggleEventVisibility = async (evt: TodayEvent) => {
    if (!onUpdateEventVisibility) return;
    const nextVis: 'private' | 'team' = evt.visibility === 'private' ? 'team' : 'private';
    const prev = events;
    setEvents((cur) => cur.map((e) => (e.id === evt.id ? { ...e, visibility: nextVis } : e)));
    try {
      await onUpdateEventVisibility(evt.id, nextVis);
    } catch {
      setEvents(prev);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!onDeleteEvent) return;
    if (!window.confirm('이 일정을 영구 삭제할까요?')) return;
    const prev = events;
    setEvents((cur) => cur.filter((e) => e.id !== eventId));
    try {
      await onDeleteEvent(eventId);
    } catch {
      setEvents(prev);
    }
  };

  const buildEventMenu = (evt: TodayEvent): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [
      {
        id: 'view-calendar',
        label: '일정 화면에서 보기',
        group: 1,
        onSelect: () => router.push('/calendar'),
      },
    ];
    if (evt.projectId) {
      menu.push({
        id: 'open-project',
        label: '연결 프로젝트 열기',
        group: 1,
        onSelect: () => router.push(`/projects/${evt.projectId}`),
      });
    }
    if (evt.isOwner && onUpdateEventVisibility) {
      menu.push({
        id: 'toggle-vis',
        label: evt.visibility === 'private' ? '팀 공유로 전환' : '나만 보기로 전환',
        group: 2,
        tone: 'owner',
        onSelect: () => void handleToggleEventVisibility(evt),
      });
    }
    if (evt.isOwner && onDeleteEvent) {
      menu.push({
        id: 'delete',
        label: '일정 삭제',
        group: 3,
        tone: 'danger',
        onSelect: () => void handleDeleteEvent(evt.id),
      });
    }
    return menu;
  };

  const buildTaskMenu = (task: TodayTask): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [
      {
        id: 'toggle-done',
        label: task.status === 'done' ? '미완료로 전환' : '완료로 표시',
        group: 1,
        onSelect: () => void handleCheck(task.id),
      },
    ];
    if (task.projectId) {
      menu.push({
        id: 'open-project',
        label: '연결 프로젝트로 이동',
        group: 1,
        onSelect: () => router.push(`/projects/${task.projectId}`),
      });
    }
    if (task.isOwner && onUpdateTask) {
      menu.push({
        id: 'toggle-vis',
        label: task.visibility === 'private' ? '팀 공유로 전환' : '나만 보기로 전환',
        group: 2,
        tone: 'owner',
        onSelect: () => void handleToggleTaskVisibility(task),
      });
      menu.push({
        id: 'edit-title',
        label: '제목 수정',
        group: 2,
        onSelect: () => void handleEditTaskTitle(task),
      });
    }
    if (task.isOwner && onDeleteTask) {
      menu.push({
        id: 'delete',
        label: '할 일 삭제',
        group: 3,
        tone: 'danger',
        onSelect: () => void handleDeleteTask(task.id),
      });
    }
    return menu;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      {unprocessedCount > 0 && (
        <Link
          href="/inbox"
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition-colors hover:border-blue-300"
        >
          <span className="text-slate-700">
            새 스캔·메모 <strong className="font-semibold text-blue-700">{unprocessedCount}건</strong> 정리하기
          </span>
          <span className="text-xs font-medium text-blue-700">입력함 →</span>
        </Link>
      )}

      {/* Unified Quick Capture (native right-click preserved inside input) */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-xl border border-slate-200 bg-white p-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                tag={tag}
                selected={selectedTagIds.includes(tag.id)}
                onClick={() => toggleTag(tag.id)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setVisibility((v) => (v === 'private' ? 'team' : 'private'))}
            className="shrink-0"
            aria-label="공개 범위 전환"
          >
            <VisibilityBadge visibility={visibility} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            disabled={isSubmitting}
            placeholder="한 줄 메모 또는 상태만 빠르게 남기기 (AI 없이 즉시 저장)"
            className="w-full rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60"
          />

          {isRecording ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleToggleVoice}
                className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 font-mono text-xs font-semibold text-red-700"
              >
                {formatTimer(elapsedSec)} / 00:30
              </button>
              <button
                type="button"
                onClick={handleCancelVoice}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
              >
                취소
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleToggleVoice}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              30초 음성
            </button>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="shrink-0 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {isSubmitting ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>

      {/* Native Events */}
      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-slate-700">오늘 일정</h2>
        {events.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-xs text-slate-500">
            등록된 오늘 일정이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {events.map((evt) => {
              const tz = evt.timezone || 'Asia/Seoul';
              return (
                <li key={evt.id}>
                  <ContextMenuWrapper
                    items={buildEventMenu(evt)}
                    ariaLabel={`${evt.title} 일정 메뉴`}
                  >
                    {({ triggerButton }) => (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{evt.title}</p>
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
        )}
      </section>

      {/* Due Tasks */}
      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-slate-700">오늘 할 일</h2>
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-xs text-slate-500">
            오늘 마감할 일이 없습니다. 입력함에서 문서를 할 일로 전환하거나 위에서 바로 추가해 보세요.
          </p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => {
              const done = task.status === 'done';
              return (
                <li key={task.id}>
                  <ContextMenuWrapper
                    items={buildTaskMenu(task)}
                    ariaLabel={`${task.title} 할 일 메뉴`}
                  >
                    {({ triggerButton }) => (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                          <input
                            type="checkbox"
                            checked={done}
                            onChange={() => void handleCheck(task.id)}
                            className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                          />
                          <span
                            className={`truncate text-sm ${
                              done ? 'text-slate-400 line-through' : 'text-slate-900'
                            }`}
                          >
                            {task.title}
                          </span>
                        </label>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <VisibilityBadge visibility={task.visibility} />
                          {triggerButton}
                        </div>
                      </div>
                    )}
                  </ContextMenuWrapper>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
