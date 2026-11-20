'use client';

/**
 * apps/web/src/components/today-view.tsx
 * Execution-Focused Today View + Unified Quick Capture + 3-Zone Context Menus on Task & Event rows:
 *  - Syncs local tasks & events state whenever server props refresh
 *  - Preserves user memo/tags if onQuickCapture fails; rolls back optimistic mutations on failure
 *  - Native right-click stays untouched inside Quick Capture input
 */
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TagChip, VisibilityBadge, type WorkspaceTag } from '@/components/workspace-primitives';
import { ContextMenuWrapper, type ContextMenuItem } from '@/components/context-menu';
import { relativeDueLabel } from '@/lib/deadline-detect';
import { useDialog } from '@/components/dialog-provider';

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

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Days since epoch on the KST calendar (so "today" flips at midnight in Korea). */
function kstDayNumber(date: Date): number {
  return Math.floor((date.getTime() + KST_OFFSET_MS) / DAY_MS);
}

type TaskGroupId = 'overdue' | 'today' | 'week' | 'later';

const TASK_GROUPS: Array<{ id: TaskGroupId; title: string; tone: string }> = [
  { id: 'overdue', title: '지난 마감', tone: 'text-red-700' },
  { id: 'today', title: '오늘', tone: 'text-blue-700' },
  { id: 'week', title: '이번 주 (7일 안)', tone: 'text-slate-700' },
  { id: 'later', title: '나중에 · 날짜 없음', tone: 'text-slate-500' },
];

function taskDue(task: TodayTask, todayNumber: number): { group: TaskGroupId; days: number | null } {
  if (!task.dueAt) return { group: 'later', days: null };
  const days = kstDayNumber(new Date(task.dueAt)) - todayNumber;
  if (days < 0) return { group: 'overdue', days };
  if (days === 0) return { group: 'today', days };
  if (days <= 7) return { group: 'week', days };
  return { group: 'later', days };
}

function dueChipLabel(task: TodayTask, days: number | null): string | null {
  if (days === null || !task.dueAt) return null;
  if (days > 7) {
    const d = new Date(new Date(task.dueAt).getTime() + KST_OFFSET_MS);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }
  return relativeDueLabel(days);
}

export interface VoiceCapturePayload {
  blob: Blob;
  durationSec: number;
  title?: string;
  tagIds: string[];
  visibility: 'private' | 'team';
}

/** Picks a recording format the browser supports and the upload API accepts. */
function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
}

export function TodayView({
  unprocessedCount = 0,
  events: initialEvents = [],
  initialTasks = [],
  tags = DEFAULT_TAGS,
  onQuickCapture,
  onVoiceCapture,
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
  /** Uploads a recorded voice memo (speech-to-text runs afterwards). */
  onVoiceCapture?: (payload: VoiceCapturePayload) => Promise<void>;
  onToggleTask?: (taskId: string) => Promise<void>;
  onUpdateTask?: (
    taskId: string,
    patch: { title?: string; visibility?: 'private' | 'team' }
  ) => Promise<void>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  onUpdateEventVisibility?: (eventId: string, visibility: 'private' | 'team') => Promise<void>;
  onDeleteEvent?: (eventId: string) => Promise<void>;
}) {
  const dialog = useDialog();
  const router = useRouter();
  const [tasks, setTasks] = useState<TodayTask[]>(initialTasks);
  const [events, setEvents] = useState<TodayEvent[]>(initialEvents);
  const [rawText, setRawText] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'private' | 'team'>('private');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recording, setRecording] = useState<{ blob: Blob; durationSec: number } | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const discardRef = useRef(false);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      const sec = Math.min(MAX_VOICE_SECONDS, Math.floor((Date.now() - startedAtRef.current) / 1000));
      setElapsedSec(sec);
      if (sec >= MAX_VOICE_SECONDS && recorderRef.current?.state === 'recording') recorderRef.current.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [isRecording]);

  // Release the microphone if the page is left mid-recording
  useEffect(() => {
    return () => {
      discardRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const startRecording = async () => {
    setMicError(null);
    if (!onVoiceCapture) return;
    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicError('이 브라우저에서는 녹음을 쓸 수 없습니다. 최신 Chrome·Edge·Safari를 사용해 주세요.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      discardRef.current = false;
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setIsRecording(false);
        const durationSec = Math.max(1, Math.min(MAX_VOICE_SECONDS, Math.round((Date.now() - startedAtRef.current) / 1000)));
        if (discardRef.current) return;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        if (blob.size > 0) setRecording({ blob, durationSec });
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      setRecording(null);
      recorder.start();
      setIsRecording(true);
    } catch {
      setMicError('마이크를 쓸 수 없습니다. 브라우저 주소창의 마이크 권한을 허용해 주세요.');
    }
  };

  const handleToggleVoice = () => {
    if (isRecording) {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    } else {
      void startRecording();
    }
  };

  const handleCancelVoice = () => {
    discardRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    setIsRecording(false);
    setElapsedSec(0);
    setRecording(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isRecording) return;
    if (!recording && !rawText.trim() && selectedTagIds.length === 0) return;

    setIsSubmitting(true);
    try {
      if (recording && onVoiceCapture) {
        await onVoiceCapture({
          blob: recording.blob,
          durationSec: recording.durationSec,
          title: rawText.trim() || undefined,
          tagIds: selectedTagIds,
          visibility,
        });
        setRecording(null);
      } else if (onQuickCapture) {
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
    const edited = await dialog.form({
      title: '할 일 제목 수정',
      confirmLabel: '저장',
      fields: [{ name: 'title', label: '제목', defaultValue: task.title, required: true, maxLength: 200 }],
    });
    if (!edited) return;
    const nextTitle = edited.title;
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
    if (!(await dialog.confirm({ title: '이 할 일을 삭제할까요?', description: '삭제한 할 일은 되돌릴 수 없습니다.', confirmLabel: '삭제', tone: 'danger' }))) return;
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
    if (!(await dialog.confirm({ title: '이 일정을 삭제할까요?', description: '삭제한 일정은 되돌릴 수 없습니다.', confirmLabel: '삭제', tone: 'danger' }))) return;
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

  const todayNumber = kstDayNumber(new Date());
  const groupedTasks: Record<TaskGroupId, Array<{ task: TodayTask; days: number | null }>> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
  };
  for (const task of tasks) {
    const { group, days } = taskDue(task, todayNumber);
    groupedTasks[group].push({ task, days });
  }
  const groupCounts = {
    overdue: groupedTasks.overdue.filter((t) => t.task.status !== 'done').length,
    today: groupedTasks.today.filter((t) => t.task.status !== 'done').length,
    week: groupedTasks.week.filter((t) => t.task.status !== 'done').length,
  };

  const renderTask = (task: TodayTask, days: number | null) => {
    const done = task.status === 'done';
    const dueLabel = dueChipLabel(task, days);
    const overdue = !done && days !== null && days < 0;
    return (
      <li key={task.id}>
        <ContextMenuWrapper items={buildTaskMenu(task)} ariaLabel={`${task.title} 할 일 메뉴`}>
          {({ triggerButton }) => (
            <div
              className={`flex items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 ${
                overdue ? 'border-red-200' : 'border-slate-200'
              }`}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={done}
                  onChange={() => void handleCheck(task.id)}
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span className={`truncate text-sm ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                  {task.title}
                </span>
              </label>
              <div className="flex shrink-0 items-center gap-1.5">
                {dueLabel && !done && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      overdue
                        ? 'bg-red-50 text-red-700'
                        : days === 0
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-slate-100 text-slate-600'
                    }`}
                    title={task.dueAt ? new Date(task.dueAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : undefined}
                  >
                    {dueLabel}
                  </span>
                )}
                <VisibilityBadge visibility={task.visibility} />
                {triggerButton}
              </div>
            </div>
          )}
        </ContextMenuWrapper>
      </li>
    );
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

        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <input
            type="text"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            disabled={isSubmitting}
            placeholder={
              recording
                ? '음성 메모 제목 (선택) — 저장하면 AI가 받아씁니다'
                : '한 줄 메모 또는 상태만 빠르게 남기기 (AI 없이 즉시 저장)'
            }
            className="w-full min-w-0 basis-full rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60 sm:basis-auto"
          />

          {isRecording ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={handleToggleVoice}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 font-mono text-xs font-semibold text-red-700"
                aria-label="녹음 멈추기"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
                {formatTimer(elapsedSec)} / 00:30 · 멈춤
              </button>
              <button
                type="button"
                onClick={handleCancelVoice}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
              >
                취소
              </button>
            </div>
          ) : recording ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-2 text-xs font-semibold text-blue-800">
                🎙️ {formatTimer(recording.durationSec)} 녹음됨
              </span>
              <button
                type="button"
                onClick={handleCancelVoice}
                className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-500 hover:bg-slate-50"
                aria-label="녹음 삭제"
              >
                삭제
              </button>
            </div>
          ) : onVoiceCapture ? (
            <button
              type="button"
              onClick={handleToggleVoice}
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              🎙️ 30초 음성
            </button>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || isRecording}
            className="ml-auto shrink-0 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60 sm:ml-0"
          >
            {isSubmitting ? '저장 중...' : '저장'}
          </button>
        </div>
        {micError && <p className="mt-2 text-xs text-red-700">{micError}</p>}
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

      {/* Tasks grouped by due date (KST) */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-700">할 일</h2>
          {tasks.length > 0 && (
            <p className="text-xs text-slate-500">
              {groupCounts.overdue > 0 && (
                <span className="font-semibold text-red-700">지난 마감 {groupCounts.overdue} · </span>
              )}
              오늘 {groupCounts.today} · 이번 주 {groupCounts.week}
            </p>
          )}
        </div>

        {tasks.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-xs text-slate-500">
            남은 할 일이 없습니다. 입력함에서 문서를 할 일로 바꾸면 찾아낸 마감일과 함께 이곳에 나타납니다.
          </p>
        ) : (
          TASK_GROUPS.map((group) => {
            const list = groupedTasks[group.id];
            if (list.length === 0) return null;
            const collapsible = group.id === 'later';
            const collapsed = collapsible && !showLater;
            return (
              <div key={group.id} className="space-y-2">
                {collapsible ? (
                  <button
                    type="button"
                    onClick={() => setShowLater((v) => !v)}
                    aria-expanded={!collapsed}
                    className={`flex w-full items-center justify-between text-xs font-semibold ${group.tone}`}
                  >
                    <span>
                      {group.title} ({list.length})
                    </span>
                    <span className="text-blue-700">{collapsed ? '펼치기 ▼' : '접기 ▲'}</span>
                  </button>
                ) : (
                  <h3 className={`text-xs font-semibold ${group.tone}`}>
                    {group.title} ({list.length})
                  </h3>
                )}
                {!collapsed && <ul className="space-y-2">{list.map(({ task, days }) => renderTask(task, days))}</ul>}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
