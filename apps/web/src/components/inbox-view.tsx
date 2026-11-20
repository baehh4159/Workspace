'use client';

/**
 * apps/web/src/components/inbox-view.tsx
 * 2-Second Triage Inbox & Guilt-Free Auto-Fold with 3-Zone Context Menu & ⋯ trigger:
 *  - Guards T/P/E keyboard shortcuts whenever a context menu ([role="menu"]) is open or modifier keys are held
 *  - Flushes pending Undo commit before starting next triage, delete, or unmount
 *  - Optimistic rollback on API failure + activeIndex clamping + 40x40 source icon
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ExpiryBadge, TagChip, VisibilityBadge, type WorkspaceTag } from '@/components/workspace-primitives';
import { relativeDueLabel } from '@/lib/deadline-detect';
import { pricingHref } from '@/lib/plans';
import { ContextMenuWrapper, type ContextMenuItem } from '@/components/context-menu';
import { useDialog } from '@/components/dialog-provider';

export interface InboxCardItem {
  id: string;
  sourceType: 'scanner_doc' | 'quick_tag' | 'quick_text' | 'quick_voice';
  title: string | null;
  summaryText: string | null;
  rawText: string | null;
  visibility: 'private' | 'team';
  triageStatus: 'unprocessed' | 'triaged' | 'auto_folded' | 'archived';
  createdAt: string;
  originalExpiresAt: string | null;
  hasOriginal?: boolean;
  isOwner?: boolean;
  tags: WorkspaceTag[];
  processingStatus?: 'ready' | 'processing' | 'succeeded' | 'failed';
  /** Deadline found in the document/memo text (see lib/deadline-detect.ts). */
  deadline?: { dueAt: string; label: string; shortLabel: string; daysFromToday: number } | null;
  /** Money amount found in the text, e.g. "48,320원". */
  amountLabel?: string | null;
}

export interface ProjectOption {
  id: string;
  title: string;
  visibility: 'private' | 'team';
}

type TriagePayload =
  | { action: 'convert_to_task'; taskTitle: string; taskDueAt?: string }
  | { action: 'link_to_project'; projectId: string }
  | { action: 'archive' };

interface PendingCommit {
  item: InboxCardItem;
  payload: TriagePayload;
  prevStatus: InboxCardItem['triageStatus'];
  label: string;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

function buildTaskPayload(item: InboxCardItem): TriagePayload {
  const base = item.title || item.rawText?.slice(0, 60) || '새 할 일';
  const title =
    item.amountLabel && !base.includes(item.amountLabel) ? `${base} · ${item.amountLabel}` : base;
  return {
    action: 'convert_to_task',
    taskTitle: title.slice(0, 200),
    ...(item.deadline ? { taskDueAt: item.deadline.dueAt } : {}),
  };
}

function canRunAi(item: InboxCardItem): boolean {
  return (
    (item.sourceType === 'scanner_doc' || item.sourceType === 'quick_voice') &&
    Boolean(item.hasOriginal) &&
    !item.summaryText &&
    (item.processingStatus === 'ready' || item.processingStatus === 'failed')
  );
}

const SOURCE_META: Record<
  InboxCardItem['sourceType'],
  { label: string; emoji: string; bgClass: string }
> = {
  scanner_doc: { label: '스캔 문서', emoji: '📄', bgClass: 'bg-blue-50' },
  quick_voice: { label: '음성 메모', emoji: '🎙️', bgClass: 'bg-red-50' },
  quick_tag: { label: '빠른 태그', emoji: '🏷️', bgClass: 'bg-slate-100' },
  quick_text: { label: '빠른 메모', emoji: '📝', bgClass: 'bg-slate-100' },
};

export function InboxView({
  initialItems = [],
  projects = [],
  onTriage,
  onDownloadOriginal,
  onToggleVisibility,
  onDeleteItem,
  onRunAi,
}: {
  initialItems?: InboxCardItem[];
  projects?: ProjectOption[];
  onTriage?: (itemId: string, payload: TriagePayload) => Promise<void>;
  onDownloadOriginal?: (itemId: string) => void;
  onToggleVisibility?: (itemId: string, visibility: 'private' | 'team') => Promise<void>;
  onDeleteItem?: (itemId: string) => Promise<void>;
  /** Runs AI reading (OCR / speech-to-text + summary) for one item. */
  onRunAi?: (itemId: string) => Promise<void>;
}) {
  const dialog = useDialog();
  const [items, setItems] = useState<InboxCardItem[]>(initialItems);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showAutoFolded, setShowAutoFolded] = useState(false);
  const [projectPickerItemId, setProjectPickerItemId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ itemId: string; label: string } | null>(null);
  const [aiRunningIds, setAiRunningIds] = useState<string[]>([]);

  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommitRef = useRef<PendingCommit | null>(null);
  const onTriageRef = useRef(onTriage);
  onTriageRef.current = onTriage;

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const unprocessed = useMemo(
    () => items.filter((i) => i.triageStatus === 'unprocessed'),
    [items]
  );
  const autoFolded = useMemo(
    () => items.filter((i) => i.triageStatus === 'auto_folded'),
    [items]
  );

  const clampedIndex = unprocessed.length === 0 ? 0 : Math.min(activeIndex, unprocessed.length - 1);

  const flushPendingCommit = useCallback((isUnmounting = false) => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    const pending = pendingCommitRef.current;
    if (!pending) return;
    pendingCommitRef.current = null;

    if (!isUnmounting) {
      setUndoToast(null);
    }

    const handler = onTriageRef.current;
    if (!handler) return;

    void handler(pending.item.id, pending.payload).catch(() => {
      if (!isUnmounting) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === pending.item.id ? { ...it, triageStatus: pending.prevStatus } : it
          )
        );
        setErrorMsg('처리에 실패해 항목을 원래 상태로 복구했습니다. 다시 시도해 주세요.');
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      flushPendingCommit(true);
    };
  }, [flushPendingCommit]);

  const scheduleTriage = useCallback(
    (item: InboxCardItem, payload: TriagePayload) => {
      flushPendingCommit(false);

      const prevStatus = item.triageStatus;
      const nextStatus: InboxCardItem['triageStatus'] =
        payload.action === 'archive' ? 'archived' : 'triaged';

      setErrorMsg(null);
      setProjectPickerItemId(null);
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, triageStatus: nextStatus } : it))
      );

      const label =
        payload.action === 'archive'
          ? '보관함으로 이동했습니다.'
          : payload.action === 'link_to_project'
            ? '프로젝트에 연결했습니다.'
            : '할 일로 전환했습니다.';

      pendingCommitRef.current = { item, payload, prevStatus, label };
      setUndoToast({ itemId: item.id, label });

      undoTimerRef.current = setTimeout(() => {
        flushPendingCommit(false);
      }, 5000);
    },
    [flushPendingCommit]
  );

  const handleUndo = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    const pending = pendingCommitRef.current;
    pendingCommitRef.current = null;
    setUndoToast(null);

    if (pending) {
      setItems((prev) =>
        prev.map((it) =>
          it.id === pending.item.id ? { ...it, triageStatus: pending.prevStatus } : it
        )
      );
    }
  };

  const handleToggleVisibility = async (item: InboxCardItem) => {
    if (!onToggleVisibility) return;
    const nextVis: 'private' | 'team' = item.visibility === 'private' ? 'team' : 'private';
    const prev = items;
    setErrorMsg(null);
    setItems((cur) => cur.map((it) => (it.id === item.id ? { ...it, visibility: nextVis } : it)));
    try {
      await onToggleVisibility(item.id, nextVis);
    } catch {
      setItems(prev);
    }
  };

  const handleDelete = async (item: InboxCardItem) => {
    if (!onDeleteItem) return;
    if (!(await dialog.confirm({ title: '이 항목을 삭제할까요?', description: '원본 파일도 함께 지워지며 되돌릴 수 없습니다.', confirmLabel: '삭제', tone: 'danger' }))) return;
    // Flush any pending Undo triage before removing another item
    flushPendingCommit(false);
    const prev = items;
    setErrorMsg(null);
    setProjectPickerItemId(null);
    setItems((cur) => cur.filter((it) => it.id !== item.id));
    try {
      await onDeleteItem(item.id);
    } catch {
      setItems(prev);
    }
  };

  const handleRunAi = async (item: InboxCardItem) => {
    if (!onRunAi || aiRunningIds.includes(item.id)) return;
    setErrorMsg(null);
    setAiRunningIds((cur) => [...cur, item.id]);
    try {
      await onRunAi(item.id);
    } finally {
      setAiRunningIds((cur) => cur.filter((x) => x !== item.id));
    }
  };

  const buildItemMenu = (item: InboxCardItem): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [];
    if (item.hasOriginal && onDownloadOriginal) {
      menu.push({
        id: 'open-original',
        label: '원본 파일 열기 (새 탭)',
        group: 1,
        onSelect: () => onDownloadOriginal(item.id),
      });
    }
    if (onRunAi && canRunAi(item)) {
      menu.push({
        id: 'run-ai',
        label: item.sourceType === 'quick_voice' ? 'AI로 받아쓰기' : 'AI로 읽기 (요약·마감일 찾기)',
        group: 1,
        onSelect: () => void handleRunAi(item),
      });
    }
    menu.push({
      id: 'to-task',
      label: item.deadline ? `할 일로 전환 (${item.deadline.shortLabel} 마감)` : '할 일로 전환',
      group: 1,
      onSelect: () => scheduleTriage(item, buildTaskPayload(item)),
    });
    if (projects.length > 0) {
      menu.push({
        id: 'link-project',
        label: '프로젝트에 연결',
        group: 1,
        onSelect: () => setProjectPickerItemId(item.id),
      });
    }
    if (item.isOwner && onToggleVisibility) {
      menu.push({
        id: 'toggle-vis',
        label: item.visibility === 'private' ? '팀 공유로 전환' : '나만 보기로 전환',
        group: 2,
        tone: 'owner',
        onSelect: () => void handleToggleVisibility(item),
      });
    }
    menu.push({
      id: 'archive',
      label: '보관함으로 이동 (5초 Undo)',
      group: 3,
      onSelect: () => scheduleTriage(item, { action: 'archive' }),
    });
    if (item.isOwner && onDeleteItem) {
      menu.push({
        id: 'delete',
        label: '항목 삭제',
        group: 3,
        tone: 'danger',
        onSelect: () => void handleDelete(item),
      });
    }
    return menu;
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      // Never hijack single-key shortcuts while a context menu or dialog is open
      if (document.querySelector('[role="menu"], [aria-modal="true"]')) return;

      if (e.key === 'Escape') {
        setProjectPickerItemId(null);
        return;
      }

      const target = unprocessed[clampedIndex];
      if (!target) return;

      const key = e.key.toLowerCase();
      if (key === 't') {
        e.preventDefault();
        scheduleTriage(target, buildTaskPayload(target));
      } else if (key === 'p') {
        e.preventDefault();
        setProjectPickerItemId((curr) => (curr === target.id ? null : target.id));
      } else if (key === 'e') {
        e.preventDefault();
        scheduleTriage(target, { action: 'archive' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [unprocessed, clampedIndex, scheduleTriage]);

  const renderCard = (item: InboxCardItem, idx: number, isFocused: boolean) => {
    const expiryDays = daysUntil(item.originalExpiresAt);
    const isPickerOpen = projectPickerItemId === item.id;
    const sourceMeta = SOURCE_META[item.sourceType] ?? SOURCE_META.quick_text;

    return (
      <li
        key={item.id}
        onMouseEnter={() => {
          if (item.triageStatus === 'unprocessed') setActiveIndex(idx);
        }}
      >
        <ContextMenuWrapper
          items={buildItemMenu(item)}
          ariaLabel={`${item.title || '입력함 항목'} 작업 메뉴`}
        >
          {({ triggerButton }) => (
            <div
              className={`relative rounded-xl border bg-white p-4 transition-colors ${
                isFocused ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  aria-hidden="true"
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base ${sourceMeta.bgClass}`}
                >
                  {sourceMeta.emoji}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-700">{sourceMeta.label}</span>
                      <span>·</span>
                      <time dateTime={item.createdAt}>
                        {new Date(item.createdAt).toLocaleString('ko-KR', {
                          timeZone: 'Asia/Seoul',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                      {expiryDays !== null && (
                        <ExpiryBadge
                          daysLeft={expiryDays}
                          onDownload={
                            onDownloadOriginal ? () => onDownloadOriginal(item.id) : undefined
                          }
                        />
                      )}
                      {expiryDays !== null && expiryDays >= 0 && expiryDays <= 7 && (
                        <Link
                          href={pricingHref('expiry')}
                          className="text-xs font-medium text-blue-700 hover:underline"
                        >
                          계속 보관하기
                        </Link>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <VisibilityBadge visibility={item.visibility} />
                      {triggerButton}
                    </div>
                  </div>

                  <h2 className="text-[15px] font-semibold text-slate-900">
                    {item.title || '제목 없는 항목'}
                  </h2>
                  {(item.summaryText || item.rawText) && (
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                      {item.summaryText || item.rawText}
                    </p>
                  )}

                  {(aiRunningIds.includes(item.id) || item.processingStatus === 'processing') && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700" role="status">
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" aria-hidden="true" />
                      {item.sourceType === 'quick_voice' ? 'AI가 받아쓰는 중…' : 'AI가 읽는 중…'}
                    </p>
                  )}

                  {onRunAi && canRunAi(item) && !aiRunningIds.includes(item.id) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-blue-50/60 px-3 py-2 text-xs text-slate-700">
                      <span>
                        {item.processingStatus === 'failed'
                          ? '지난번 AI 읽기에 실패했습니다.'
                          : item.sourceType === 'quick_voice'
                            ? '아직 글자로 바꾸지 않은 음성입니다.'
                            : '아직 AI가 읽지 않은 문서입니다.'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRunAi(item)}
                        className="rounded-md bg-white px-2.5 py-1 font-semibold text-blue-700 ring-1 ring-inset ring-blue-200 hover:bg-blue-50"
                      >
                        {item.processingStatus === 'failed'
                          ? '다시 시도'
                          : item.sourceType === 'quick_voice'
                            ? 'AI로 받아쓰기'
                            : 'AI로 읽기'}
                      </button>
                    </div>
                  )}

                  {(item.deadline || item.amountLabel) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.deadline && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                            item.deadline.daysFromToday < 0
                              ? 'bg-red-50 text-red-700 ring-red-200'
                              : item.deadline.daysFromToday <= 3
                                ? 'bg-amber-50 text-amber-800 ring-amber-200'
                                : 'bg-blue-50 text-blue-800 ring-blue-200'
                          }`}
                          title="문서 내용에서 찾은 마감일입니다. '할 일로'를 누르면 마감일이 함께 저장됩니다."
                        >
                          📅 {item.deadline.label} 마감 · {relativeDueLabel(item.deadline.daysFromToday)}
                        </span>
                      )}
                      {item.amountLabel && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          💳 {item.amountLabel}
                        </span>
                      )}
                    </div>
                  )}

                  {item.tags.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <TagChip key={tag.id} tag={tag} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3.5 flex items-center gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => scheduleTriage(item, buildTaskPayload(item))}
                  className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  {item.deadline ? `할 일로 · ${item.deadline.shortLabel} 마감` : '할 일로'}
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProjectPickerItemId(isPickerOpen ? null : item.id)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    프로젝트
                  </button>

                  {isPickerOpen && (
                    <div className="absolute left-0 top-10 z-20 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                      {projects.length === 0 ? (
                        <p className="px-2.5 py-2 text-xs text-slate-500">
                          연결할 프로젝트가 없습니다.
                        </p>
                      ) : (
                        projects.map((proj) => (
                          <button
                            key={proj.id}
                            type="button"
                            onClick={() =>
                              scheduleTriage(item, {
                                action: 'link_to_project',
                                projectId: proj.id,
                              })
                            }
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100"
                          >
                            <span className="truncate font-medium">{proj.title}</span>
                            <span className="ml-2 shrink-0 text-[10px] text-slate-400">
                              {proj.visibility === 'team' ? '팀' : '나만'}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => scheduleTriage(item, { action: 'archive' })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  보관
                </button>
              </div>
            </div>
          )}
        </ContextMenuWrapper>
      </li>
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-baseline justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">입력함</h1>
          <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
            {unprocessed.length}건
          </span>
        </div>
        <p className="hidden text-xs text-slate-500 sm:block">
          단축키 <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono">T</kbd> 할 일 ·{' '}
          <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono">P</kbd> 프로젝트 ·{' '}
          <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono">E</kbd> 보관
        </p>
      </header>

      {errorMsg && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {errorMsg}
        </div>
      )}

      {unprocessed.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">지금 정리할 항목이 없습니다.</p>
          <p className="mt-1 text-xs text-slate-500">
            위에 PDF·사진을 끌어다 놓거나, 스캐너 앱으로 찍거나, 오늘 화면에서 메모를 남기면 이곳에 도착합니다.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {unprocessed.map((item, idx) => renderCard(item, idx, idx === clampedIndex))}
        </ul>
      )}

      {autoFolded.length > 0 && (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowAutoFolded((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <span>7일 이상 지난 자동 접힘 항목 ({autoFolded.length}건)</span>
            <span className="text-blue-700">{showAutoFolded ? '접기 ▲' : '펼치기 ▼'}</span>
          </button>

          {showAutoFolded && (
            <ul className="mt-3 space-y-3">
              {autoFolded.map((item, idx) => renderCard(item, idx, false))}
            </ul>
          )}
        </section>
      )}

      {undoToast && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-slate-900 px-4 py-3 text-xs text-white shadow-lg">
          <span>{undoToast.label}</span>
          <button
            type="button"
            onClick={handleUndo}
            className="font-semibold text-blue-300 hover:text-blue-200"
          >
            실행 취소
          </button>
        </div>
      )}
    </div>
  );
}
