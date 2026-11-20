'use client';

/**
 * apps/web/src/components/today-client-shell.tsx
 * Client Shell wiring TodayView to real Quick Capture, Task PATCH/DELETE, and Event PATCH/DELETE APIs.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  TodayView,
  type TodayEvent,
  type TodayTask,
} from '@/components/today-view';
import type { WorkspaceTag } from '@/components/workspace-primitives';

export function TodayClientShell({
  workspaceId,
  unprocessedCount,
  events,
  initialTasks,
  tags,
}: {
  workspaceId: string;
  unprocessedCount: number;
  events: TodayEvent[];
  initialTasks: TodayTask[];
  tags: WorkspaceTag[];
}) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);
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
        onToggleTask={handleToggleTask}
        onUpdateTask={handleUpdateTask}
        onDeleteTask={handleDeleteTask}
        onUpdateEventVisibility={handleUpdateEventVisibility}
        onDeleteEvent={handleDeleteEvent}
      />
    </div>
  );
}
