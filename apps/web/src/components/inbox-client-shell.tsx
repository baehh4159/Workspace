'use client';

/**
 * apps/web/src/components/inbox-client-shell.tsx
 * Client Shell wiring InboxView to triage, signed-url, visibility PATCH, and DELETE /api/inbox/[id].
 */
import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  InboxView,
  type InboxCardItem,
  type ProjectOption,
} from '@/components/inbox-view';

type TriagePayload =
  | { action: 'convert_to_task'; taskTitle: string }
  | { action: 'link_to_project'; projectId: string }
  | { action: 'archive' };

export function InboxClientShell({
  workspaceId,
  initialItems,
  projects,
}: {
  workspaceId: string;
  initialItems: InboxCardItem[];
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [actionError, setActionError] = useState<string | null>(null);

  const handleTriage = useCallback(
    async (itemId: string, payload: TriagePayload) => {
      const res = await fetch(`/api/inbox/${itemId}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          ...payload,
        }),
      });

      if (!res.ok) {
        throw new Error(`TRIAGE_FAILED_${res.status}`);
      }
    },
    [workspaceId]
  );

  const handleDownloadOriginal = useCallback(async (itemId: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/files/${itemId}/signed-url`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setActionError(
          res.status === 410
            ? '원본 파일이 이미 만료되었거나 삭제되었습니다.'
            : '원본 파일을 열 수 없습니다. 잠시 후 다시 시도해 주세요.'
        );
        return;
      }
      const data = (await res.json()) as { signedUrl?: string };
      if (!data.signedUrl) {
        setActionError('원본 파일 링크를 생성하지 못했습니다.');
        return;
      }
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setActionError('네트워크 오류로 원본 파일을 열 수 없습니다.');
    }
  }, []);

  const handleToggleVisibility = useCallback(
    async (itemId: string, visibility: 'private' | 'team') => {
      setActionError(null);
      const res = await fetch(`/api/inbox/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility }),
      });
      if (!res.ok) {
        setActionError('공개 범위 변경에 실패해 원래 상태로 복구했습니다.');
        throw new Error(`INBOX_PATCH_FAILED_${res.status}`);
      }
      router.refresh();
    },
    [router]
  );

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      setActionError(null);
      const res = await fetch(`/api/inbox/${itemId}`, { method: 'DELETE' });
      if (!res.ok) {
        setActionError('항목 삭제에 실패해 원래 상태로 복구했습니다.');
        throw new Error(`INBOX_DELETE_FAILED_${res.status}`);
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
      <InboxView
        initialItems={initialItems}
        projects={projects}
        onTriage={handleTriage}
        onDownloadOriginal={(itemId) => {
          void handleDownloadOriginal(itemId);
        }}
        onToggleVisibility={handleToggleVisibility}
        onDeleteItem={handleDeleteItem}
      />
    </div>
  );
}
