'use client';

/**
 * apps/web/src/components/today-client-shell.tsx
 * Client Shell wiring TodayView to real Quick Capture, Task PATCH/DELETE, and Event PATCH/DELETE APIs.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  TodayView,
  type TodayEvent,
  type TodayTask,
  type VoiceCapturePayload,
} from '@/components/today-view';
import {
  InboxUploadError,
  describeAiError,
  describeUploadError,
  resolveAudioMime,
  runAiProcessing,
  uploadAndIngest,
} from '@/lib/upload-client';
import { pricingHref } from '@/lib/plans';
import type { WorkspaceTag } from '@/components/workspace-primitives';

export function TodayClientShell({
  workspaceId,
  initialNotice = null,
  unprocessedCount,
  events,
  initialTasks,
  tags,
}: {
  workspaceId: string;
  /** Message shown once after joining a team via share link (or failing to). */
  initialNotice?: string | null;
  unprocessedCount: number;
  events: TodayEvent[];
  initialTasks: TodayTask[];
  tags: WorkspaceTag[];
}) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; link?: { href: string; label: string } } | null>(
    initialNotice ? { text: initialNotice } : null
  );
  const statusMapRef = useRef<Map<string, TodayTask['status']>>(new Map());

  useEffect(() => {
    const next = new Map<string, TodayTask['status']>();
    for (const task of initialTasks) {
      next.set(task.id, task.status);
    }
    statusMapRef.current = next;
  }, [initialTasks]);

  const handleQuickCapture = useCallback(
    async (payload: {
      rawText: string;
      tagIds: string[];
      visibility: 'private' | 'team';
    }) => {
      setActionError(null);
      const trimmed = payload.rawText.trim();
      const sourceType = trimmed.length > 0 ? 'quick_text' : 'quick_tag';
      const idempotencyKey =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      let res: Response;
      try {
        res = await fetch('/api/inbox/quick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            sourceType,
            visibility: payload.visibility,
            rawText: trimmed.length > 0 ? trimmed : undefined,
            tagIds: payload.tagIds,
            idempotencyKey,
          }),
        });
      } catch (err) {
        setActionError('네트워크 오류로 빠른 기록을 저장하지 못했습니다.');
        throw err;
      }

      if (!res.ok) {
        setActionError('빠른 기록 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        throw new Error(`QUICK_CAPTURE_FAILED_${res.status}`);
      }

      router.refresh();
    },
    [router, workspaceId]
  );

  const handleVoiceCapture = useCallback(
    async (payload: VoiceCapturePayload) => {
      setActionError(null);
      setNotice(null);
      const contentType = resolveAudioMime(payload.blob.type);
      if (!contentType) {
        setActionError('이 브라우저의 녹음 형식은 아직 지원하지 않습니다. Chrome·Edge·Safari에서 다시 시도해 주세요.');
        throw new Error('UNSUPPORTED_AUDIO_TYPE');
      }
      const stamp = new Date().toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
      });
      let itemId: string;
      try {
        ({ itemId } = await uploadAndIngest({
          workspaceId,
          blob: payload.blob,
          fileName: `voice-${Date.now()}.${contentType === 'audio/mp4' ? 'm4a' : 'webm'}`,
          contentType,
          sourceType: 'quick_voice',
          visibility: payload.visibility,
          title: payload.title ?? `음성 메모 ${stamp}`,
          audioSeconds: payload.durationSec,
          tagIds: payload.tagIds,
        }));
      } catch (err) {
        const storageFull = err instanceof InboxUploadError && err.code === 'FREE_STORAGE_LIMIT_EXCEEDED';
        if (storageFull) {
          setNotice({
            text: describeUploadError(err),
            link: { href: pricingHref('storage'), label: '용량 제한 없애기 →' },
          });
        } else {
          setActionError(describeUploadError(err));
        }
        throw err;
      }

      router.refresh();
      const ai = await runAiProcessing(itemId);
      const inboxLink = { href: '/inbox', label: '입력함 열기 →' };
      if (ai.ok) {
        setNotice({ text: '음성 메모를 저장하고 글자로 받아썼습니다.', link: inboxLink });
      } else if (ai.code === 'AI_QUOTA_EXCEEDED') {
        setNotice({
          text: '음성은 저장했지만 이번 달 받아쓰기 한도를 모두 썼습니다.',
          link: { href: pricingHref('ai_quota'), label: '한도 늘리기 →' },
        });
      } else {
        setNotice({ text: `음성은 저장했지만 ${describeAiError(ai.code)}`, link: inboxLink });
      }
      router.refresh();
    },
    [router, workspaceId]
  );

  const handleToggleTask = useCallback(
    async (taskId: string) => {
      setActionError(null);
      const prevStatus = statusMapRef.current.get(taskId) ?? 'todo';
      const nextStatus: TodayTask['status'] = prevStatus === 'done' ? 'todo' : 'done';
      statusMapRef.current.set(taskId, nextStatus);

      let res: Response;
      try {
        res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        });
      } catch (err) {
        statusMapRef.current.set(taskId, prevStatus);
        setActionError('네트워크 오류로 할 일 상태를 변경하지 못했습니다.');
        router.refresh();
        throw err;
      }

      if (!res.ok) {
        statusMapRef.current.set(taskId, prevStatus);
        setActionError('할 일 상태 변경에 실패해 원래 상태로 복구했습니다.');
        router.refresh();
        throw new Error(`TASK_TOGGLE_FAILED_${res.status}`);
      }
    },
    [router]
  );

  const handleUpdateTask = useCallback(
    async (taskId: string, patch: { title?: string; visibility?: 'private' | 'team' }) => {
      setActionError(null);
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setActionError('할 일 수정에 실패해 원래 상태로 복구했습니다.');
        throw new Error(`TASK_PATCH_FAILED_${res.status}`);
      }
      router.refresh();
    },
    [router]
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      setActionError(null);
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (!res.ok) {
        setActionError('할 일 삭제에 실패해 원래 상태로 복구했습니다.');
        throw new Error(`TASK_DELETE_FAILED_${res.status}`);
      }
      router.refresh();
    },
    [router]
  );

  const handleUpdateEventVisibility = useCallback(
    async (eventId: string, visibility: 'private' | 'team') => {
      setActionError(null);
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
      });
      if (!res.ok) {
        setActionError('일정 공개 범위 변경에 실패해 원래 상태로 복구했습니다.');
        throw new Error(`EVENT_PATCH_FAILED_${res.status}`);
      }
      router.refresh();
    },
    [router]
  );

  const handleDeleteEvent = useCallback(
    async (eventId: string) => {
      setActionError(null);
      const res = await fetch(`/api/events/${eventId}`, { method: 'DELETE' });
      if (!res.ok) {
        setActionError('일정 삭제에 실패해 원래 상태로 복구했습니다.');
        throw new Error(`EVENT_DELETE_FAILED_${res.status}`);
      }
      router.refresh();
    },
    [router]
  );

  return (
    <div>
      {notice && (
        <div className="mx-auto max-w-3xl px-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-900" role="status">
            <span>{notice.text}</span>
            <span className="flex items-center gap-3">
              {notice.link && (
                <Link href={notice.link.href} className="font-semibold underline underline-offset-2">
                  {notice.link.label}
                </Link>
              )}
              <button type="button" onClick={() => setNotice(null)} aria-label="안내 닫기" className="text-blue-700 hover:text-blue-950">
                ✕
              </button>
            </span>
          </div>
        </div>
      )}
      {actionError && (
        <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-6">
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
            {actionError}
          </div>
        </div>
      )}
      <TodayView
        unprocessedCount={unprocessedCount}
        events={events}
        initialTasks={initialTasks}
        tags={tags}
        onQuickCapture={handleQuickCapture}
        onVoiceCapture={handleVoiceCapture}
        onToggleTask={handleToggleTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTask={handleDeleteTask}
        onUpdateEventVisibility={handleUpdateEventVisibility}
        onDeleteEvent={handleDeleteEvent}
      />
    </div>
  );
}
