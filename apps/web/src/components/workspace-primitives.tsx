'use client';

/**
 * apps/web/src/components/workspace-primitives.tsx
 * Shared visual & trust primitives:
 *  - Calm off-white canvas (#F7F8FA), pure white cards (#FFFFFF), subtle slate borders
 *  - 0.3s visual distinction between status tags (neutral pill) and action_trigger tags (cobalt border + icon)
 *  - Consistent VisibilityBadge (private lock vs team shared) in the fixed meta-row slot
 *  - Subtle amber ExpiryBadge for free-plan D-7 / D-1 originals
 */
import React from 'react';

export interface WorkspaceTag {
  id: string;
  label: string;
  kind: 'status' | 'action_trigger';
  defaultDueOffsetDays?: number | null;
}

export function VisibilityBadge({ visibility }: { visibility: 'private' | 'team' }) {
  if (visibility === 'team') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 ring-1 ring-inset ring-teal-200"
        title="팀 워크스페이스 구성원에게 공유됨"
      >
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M5.5 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm5 0a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5ZM2.5 12.5c0-1.66 1.34-3 3-3s3 1.34 3 3M9.5 9.75c1.38 0 2.5 1.12 2.5 2.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        팀 공유
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
      title="나만 볼 수 있는 비공개 항목"
    >
      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      나만 보기
    </span>
  );
}

export function TagChip({
  tag,
  selected = false,
  onClick,
}: {
  tag: WorkspaceTag;
  selected?: boolean;
  onClick?: () => void;
}) {
  const isAction = tag.kind === 'action_trigger';

  const baseClass = isAction
    ? selected
      ? 'bg-blue-700 text-white border-blue-700'
      : 'bg-blue-50/70 text-blue-800 border-blue-200 hover:bg-blue-50'
    : selected
      ? 'bg-slate-800 text-white border-slate-800'
      : 'bg-slate-100 text-slate-700 border-transparent hover:bg-slate-200/80';

  const Element = onClick ? 'button' : 'span';

  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${baseClass}`}
      title={isAction ? '선택 시 할 일이 자동 생성되는 액션 태그' : '상태만 기록하는 태그'}
    >
      {isAction && (
        <svg className="h-3 w-3 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8.8 2 3.8 8.8h4L7.2 14l5-6.8h-4L8.8 2Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span>{tag.label}</span>
    </Element>
  );
}

export function ExpiryBadge({
  daysLeft,
  onDownload,
}: {
  daysLeft: number;
  onDownload?: () => void;
}) {
  if (daysLeft > 7 || daysLeft < 0) return null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
      <span>D-{daysLeft} 원본 만료</span>
      {onDownload && (
        <button
          type="button"
          onClick={onDownload}
          className="underline decoration-amber-400 underline-offset-2 hover:text-amber-950"
        >
          다운로드
        </button>
      )}
    </span>
  );
}
