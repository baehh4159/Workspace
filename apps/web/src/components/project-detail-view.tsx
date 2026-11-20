'use client';

/**
 * apps/web/src/components/project-detail-view.tsx
 * Project Detail View with 3-zone Context Menus on Record cards & Task rows:
 *  - Record cards: 마크다운 본문 복사, 나만/팀 전환(작성자), 기록 내용 수정(작성자), 기록 삭제(작성자)
 *  - Task rows: 완료/미완료 전환, 나만/팀 전환(소유자), 할 일 삭제(소유자)
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VisibilityBadge } from '@/components/workspace-primitives';
import { ContextMenuWrapper, type ContextMenuItem } from '@/components/context-menu';
import { useDialog } from '@/components/dialog-provider';

export interface ProjectTaskItem {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'waiting' | 'done';
  dueAt: string | null;
  visibility: 'private' | 'team';
  isOwner?: boolean;
}

export interface ProjectRecordItem {
  id: string;
  contentMarkdown: string;
  visibility: 'private' | 'team';
  isAuthor: boolean;
  updatedAt: string;
}

export interface LinkedDocItem {
  id: string;
  title: string;
  visibility: 'private' | 'team';
}

export function ProjectDetailView({
  workspaceId,
  project,
  initialTasks,
  initialRecords,
  linkedDocs,
}: {
  workspaceId: string;
  project: { id: string; title: string; visibility: 'private' | 'team' };
  initialTasks: ProjectTaskItem[];
  initialRecords: ProjectRecordItem[];
  linkedDocs: LinkedDocItem[];
}) {
  const dialog = useDialog();
  const router = useRouter();
  const [tasks, setTasks] = useState<ProjectTaskItem[]>(initialTasks);
  const [records, setRecords] = useState<ProjectRecordItem[]>(initialRecords);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  const [showSharePanel, setShowSharePanel] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<7 | 14 | 30>(14);
  const [shareScope, setShareScope] = useState<'view_and_join' | 'read_only'>('view_and_join');
  const [creatingShare, setCreatingShare] = useState(false);
  const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<'private' | 'team'>('private');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    setRecords(initialRecords);
  }, [initialRecords]);

  const handleToggleTask = async (taskId: string) => {
    setErrorMsg(null);
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;
    const prevStatus = target.status;
    const nextStatus: ProjectTaskItem['status'] = prevStatus === 'done' ? 'todo' : 'done';

    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t)));
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error('FAILED');
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: prevStatus } : t)));
      setErrorMsg('할 일 상태 변경에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const handleToggleTaskVisibility = async (task: ProjectTaskItem) => {
    const nextVis: 'private' | 'team' = task.visibility === 'private' ? 'team' : 'private';
    const prev = tasks;
    setErrorMsg(null);
    setTasks((cur) => cur.map((t) => (t.id === task.id ? { ...t, visibility: nextVis } : t)));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: nextVis }),
      });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setTasks(prev);
      setErrorMsg('할 일 공개 범위 변경에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!(await dialog.confirm({ title: '이 할 일을 삭제할까요?', description: '삭제한 할 일은 되돌릴 수 없습니다.', confirmLabel: '삭제', tone: 'danger' }))) return;
    const prev = tasks;
    setErrorMsg(null);
    setTasks((cur) => cur.filter((t) => t.id !== taskId));
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setTasks(prev);
      setErrorMsg('할 일 삭제에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const handleCreateShare = async () => {
    setCreatingShare(true);
    setErrorMsg(null);
    setCopied(false);
    try {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          entityType: 'project',
          entityId: project.id,
          scope: shareScope,
          expiresInDays,
        }),
      });
      if (!res.ok) {
        setErrorMsg('공유 링크 생성에 실패했습니다.');
        return;
      }
      const data = (await res.json()) as { shareUrl?: string };
      if (data.shareUrl) {
        setCreatedShareUrl(data.shareUrl);
      }
    } catch {
      setErrorMsg('네트워크 오류로 공유 링크를 생성하지 못했습니다.');
    } finally {
      setCreatingShare(false);
    }
  };

  const handleCopyShareUrl = async () => {
    if (!createdShareUrl) return;
    try {
      await navigator.clipboard.writeText(createdShareUrl);
      setCopied(true);
    } catch {
      setErrorMsg('클립보드 복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.');
    }
  };

  const handleCreateRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingNote || !noteText.trim()) return;
    setSavingNote(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          projectId: project.id,
          contentMarkdown: noteText.trim(),
          visibility: noteVisibility,
        }),
      });
      if (!res.ok) {
        setErrorMsg('기록 저장에 실패했습니다. 입력 내용은 그대로 유지됩니다.');
        return;
      }
      setNoteText('');
      router.refresh();
    } catch {
      setErrorMsg('네트워크 오류로 기록을 저장하지 못했습니다.');
    } finally {
      setSavingNote(false);
    }
  };

  const handleCopyRecord = async (rec: ProjectRecordItem) => {
    setErrorMsg(null);
    try {
      await navigator.clipboard.writeText(rec.contentMarkdown);
      setNoticeMsg('기록 마크다운 본문을 클립보드에 복사했습니다.');
    } catch {
      setErrorMsg('클립보드 복사에 실패했습니다.');
    }
  };

  const handleEditRecord = async (rec: ProjectRecordItem) => {
    const edited = await dialog.form({
      title: '기록 수정',
      confirmLabel: '저장',
      fields: [{ name: 'content', label: '내용', defaultValue: rec.contentMarkdown, required: true, multiline: true }],
    });
    if (!edited) return;
    const nextContent = edited.content;
    const prev = records;
    setErrorMsg(null);
    setRecords((cur) =>
      cur.map((r) => (r.id === rec.id ? { ...r, contentMarkdown: nextContent.trim() } : r))
    );
    try {
      const res = await fetch(`/api/records/${rec.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentMarkdown: nextContent.trim() }),
      });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setRecords(prev);
      setErrorMsg('기록 수정에 실패해 원래 내용으로 복구했습니다.');
    }
  };

  const handleToggleRecordVisibility = async (recordId: string) => {
    const target = records.find((r) => r.id === recordId);
    if (!target || !target.isAuthor) return;

    const prevVis = target.visibility;
    const nextVis: 'private' | 'team' = prevVis === 'private' ? 'team' : 'private';
    setErrorMsg(null);
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, visibility: nextVis } : r)));

    try {
      const res = await fetch(`/api/records/${recordId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: nextVis }),
      });
      if (!res.ok) throw new Error('FAILED');
    } catch {
      setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, visibility: prevVis } : r)));
      setErrorMsg('기록 공개 범위 변경에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (!(await dialog.confirm({ title: '이 기록을 삭제할까요?', description: '삭제한 기록은 되돌릴 수 없습니다.', confirmLabel: '삭제', tone: 'danger' }))) return;
    const prev = records;
    setErrorMsg(null);
    setRecords((cur) => cur.filter((r) => r.id !== recordId));
    try {
      const res = await fetch(`/api/records/${recordId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setRecords(prev);
      setErrorMsg('기록 삭제에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const buildRecordMenu = (rec: ProjectRecordItem): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [
      {
        id: 'copy-md',
        label: '마크다운 본문 복사',
        group: 1,
        onSelect: () => void handleCopyRecord(rec),
      },
    ];
    if (rec.isAuthor) {
      menu.push({
        id: 'toggle-vis',
        label: rec.visibility === 'private' ? '팀 공유로 전환' : '나만 보기로 전환',
        group: 2,
        tone: 'owner',
        onSelect: () => void handleToggleRecordVisibility(rec.id),
      });
      menu.push({
        id: 'edit',
        label: '기록 내용 수정',
        group: 2,
        onSelect: () => void handleEditRecord(rec),
      });
      menu.push({
        id: 'delete',
        label: '기록 삭제',
        group: 3,
        tone: 'danger',
        onSelect: () => void handleDeleteRecord(rec.id),
      });
    }
    return menu;
  };

  const buildTaskMenu = (task: ProjectTaskItem): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [
      {
        id: 'toggle-done',
        label: task.status === 'done' ? '미완료로 전환' : '완료로 표시',
        group: 1,
        onSelect: () => void handleToggleTask(task.id),
      },
    ];
    if (task.isOwner) {
      menu.push({
        id: 'toggle-vis',
        label: task.visibility === 'private' ? '팀 공유로 전환' : '나만 보기로 전환',
        group: 2,
        tone: 'owner',
        onSelect: () => void handleToggleTaskVisibility(task),
      });
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/projects" className="text-xs font-medium text-slate-500 hover:text-slate-700">
            ← 프로젝트 목록
          </Link>
          <div className="mt-1.5 flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{project.title}</h1>
            <VisibilityBadge visibility={project.visibility} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowSharePanel((v) => !v)}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
        >
          공유 링크 만들기
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {noticeMsg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-700">
          {noticeMsg}
        </div>
      )}

      {showSharePanel && (
        <section className="rounded-xl border border-blue-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-900">비로그인 게스트 공유 링크 발급</p>
              <p className="text-[11px] text-slate-500">
                팀 공개 체크리스트만 표시되며, 작성자의 개인 기록(나만 보기)은 절대 노출되지 않습니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value) as 7 | 14 | 30)}
                className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-2.5 py-1.5 text-xs text-slate-800"
              >
                <option value={7}>7일 뒤 만료</option>
                <option value={14}>14일 뒤 만료 (기본)</option>
                <option value={30}>30일 뒤 만료</option>
              </select>
              <select
                value={shareScope}
                onChange={(e) => setShareScope(e.target.value as 'view_and_join' | 'read_only')}
                className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-2.5 py-1.5 text-xs text-slate-800"
              >
                <option value="view_and_join">열람 + 1클릭 팀 합류</option>
                <option value="read_only">열람 전용</option>
              </select>
              <button
                type="button"
                disabled={creatingShare}
                onClick={() => void handleCreateShare()}
                className="rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {creatingShare ? '발급 중...' : '링크 발급'}
              </button>
            </div>
          </div>

          {createdShareUrl && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-2">
              <input
                type="text"
                readOnly
                value={createdShareUrl}
                className="w-full bg-transparent text-xs text-slate-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleCopyShareUrl()}
                className="shrink-0 rounded-md bg-white px-2.5 py-1 text-xs font-semibold text-blue-700 shadow-xs ring-1 ring-slate-200 hover:bg-blue-50"
              >
                {copied ? '복사됨' : '복사'}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold text-slate-700">연결된 할 일 ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-xs text-slate-500">
            연결된 할 일이 없습니다.
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
                            onChange={() => void handleToggleTask(task.id)}
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

      {linkedDocs.length > 0 && (
        <section className="space-y-2.5">
          <h2 className="text-sm font-semibold text-slate-700">연결된 스캔·메모 ({linkedDocs.length})</h2>
          <ul className="space-y-2">
            {linkedDocs.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3"
              >
                <span className="text-sm font-medium text-slate-800">{doc.title}</span>
                <VisibilityBadge visibility={doc.visibility} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">기록 (메모 · 회의록)</h2>
          <p className="text-xs text-slate-500">
            프로젝트 공개 여부와 무관하게 기록마다 나만 보기 / 팀 공유를 독립 설정합니다.
          </p>
        </div>

        <form
          onSubmit={(e) => void handleCreateRecord(e)}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <textarea
            rows={3}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            disabled={savingNote}
            placeholder="프로젝트에 남길 개인 메모 또는 팀 공유 기록을 입력하세요..."
            className="w-full resize-none rounded-lg border border-slate-200 bg-[#F7F8FA] p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60"
          />
          <div className="mt-2.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setNoteVisibility((v) => (v === 'private' ? 'team' : 'private'))}
              aria-label="새 기록 공개 범위 전환"
            >
              <VisibilityBadge visibility={noteVisibility} />
            </button>
            <button
              type="submit"
              disabled={savingNote || !noteText.trim()}
              className="rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {savingNote ? '저장 중...' : '기록 추가'}
            </button>
          </div>
        </form>

        {records.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-xs text-slate-500">
            아직 등록된 기록이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {records.map((rec) => (
              <li key={rec.id}>
                <ContextMenuWrapper
                  items={buildRecordMenu(rec)}
                  ariaLabel="기록 작업 메뉴"
                >
                  {({ triggerButton }) => (
                    <div
                      className={`rounded-xl border p-4 ${
                        rec.visibility === 'private'
                          ? 'border-slate-200/80 bg-slate-50/70'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">
                          {new Date(rec.updatedAt).toLocaleString('ko-KR', {
                            timeZone: 'Asia/Seoul',
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {rec.isAuthor ? (
                            <button
                              type="button"
                              onClick={() => void handleToggleRecordVisibility(rec.id)}
                              title="클릭하여 공개 범위 전환"
                            >
                              <VisibilityBadge visibility={rec.visibility} />
                            </button>
                          ) : (
                            <VisibilityBadge visibility={rec.visibility} />
                          )}
                          {triggerButton}
                        </div>
                      </div>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">
                        {rec.contentMarkdown}
                      </p>
                    </div>
                  )}
                </ContextMenuWrapper>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
