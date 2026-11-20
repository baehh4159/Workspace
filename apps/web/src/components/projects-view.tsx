'use client';

/**
 * apps/web/src/components/projects-view.tsx
 * Project list + inline create form + 3-zone Context Menu & ⋯ trigger:
 *  - Single team workspace: direct 1-click transfer confirmation
 *  - Multiple team workspaces: routes cleanly to /settings transfer panel to prevent mis-moves
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VisibilityBadge } from '@/components/workspace-primitives';
import { ContextMenuWrapper, type ContextMenuItem } from '@/components/context-menu';
import { useDialog } from '@/components/dialog-provider';

export interface ProjectListItem {
  id: string;
  title: string;
  visibility: 'private' | 'team';
  status: 'active' | 'archived';
  isOwner: boolean;
  updatedAt: string;
}

export function ProjectsView({
  workspaceId,
  projects: initialProjects,
  teamWorkspaces = [],
}: {
  workspaceId: string;
  projects: ProjectListItem[];
  teamWorkspaces?: Array<{ id: string; name: string }>;
}) {
  const dialog = useDialog();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectListItem[]>(initialProjects);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'team'>('private');
  const [creating, setCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating || !title.trim()) return;
    setCreating(true);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, title: title.trim(), visibility }),
      });
      if (!res.ok) {
        setErrorMsg('프로젝트 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setTitle('');
      router.refresh();
    } catch {
      setErrorMsg('네트워크 오류로 프로젝트를 생성하지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const handleQuickShare = async (proj: ProjectListItem) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await fetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          entityType: 'project',
          entityId: proj.id,
          scope: 'view_and_join',
          expiresInDays: 14,
        }),
      });
      if (!res.ok) throw new Error('FAILED');
      const data = (await res.json()) as { shareUrl?: string };
      if (data.shareUrl) {
        await navigator.clipboard.writeText(data.shareUrl).catch(() => {});
        setNoticeMsg(`'${proj.title}' 14일 게스트 공유 링크를 발급해 복사했습니다: ${data.shareUrl}`);
      }
    } catch {
      setErrorMsg('게스트 공유 링크 발급에 실패했습니다.');
    }
  };

  const handleToggleVisibility = async (proj: ProjectListItem) => {
    const nextVis: 'private' | 'team' = proj.visibility === 'private' ? 'team' : 'private';
    const prev = projects;
    setErrorMsg(null);
    setNoticeMsg(null);
    setProjects((cur) => cur.map((p) => (p.id === proj.id ? { ...p, visibility: nextVis } : p)));
    try {
      const res = await fetch(`/api/projects/${proj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: nextVis }),
      });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setProjects(prev);
      setErrorMsg('프로젝트 공개 범위 변경에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const handleTransferToTeam = async (proj: ProjectListItem, targetTeam: { id: string; name: string }) => {
    if (
      !(await dialog.confirm({
        title: '팀 워크스페이스로 옮길까요?',
        description: `'${proj.title}' 프로젝트를 [팀] ${targetTeam.name}(으)로 옮깁니다. 안에 있는 "나만 보기" 기록은 계속 나만 볼 수 있습니다.`,
        confirmLabel: '옮기기',
      }))
    ) {
      return;
    }
    const prev = projects;
    setErrorMsg(null);
    setNoticeMsg(null);
    setProjects((cur) => cur.filter((p) => p.id !== proj.id));
    try {
      const res = await fetch('/api/workspaces/transfer-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceWorkspaceId: workspaceId,
          targetWorkspaceId: targetTeam.id,
          projectIds: [proj.id],
        }),
      });
      if (!res.ok) throw new Error('FAILED');
      setNoticeMsg(`'${proj.title}'을(를) [팀] ${targetTeam.name}(으)로 이동했습니다.`);
      router.refresh();
    } catch {
      setProjects(prev);
      setErrorMsg('팀 워크스페이스 이동에 실패했습니다.');
    }
  };

  const handleArchiveProject = async (proj: ProjectListItem) => {
    const prev = projects;
    setErrorMsg(null);
    setNoticeMsg(null);
    setProjects((cur) => cur.filter((p) => p.id !== proj.id));
    try {
      const res = await fetch(`/api/projects/${proj.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (!res.ok) throw new Error('FAILED');
      setNoticeMsg(`'${proj.title}' 프로젝트를 보관했습니다.`);
      router.refresh();
    } catch {
      setProjects(prev);
      setErrorMsg('프로젝트 보관에 실패했습니다.');
    }
  };

  const handleDeleteProject = async (proj: ProjectListItem) => {
    if (!(await dialog.confirm({ title: '프로젝트를 삭제할까요?', description: `'${proj.title}' 프로젝트가 영구 삭제되며 되돌릴 수 없습니다.`, confirmLabel: '삭제', tone: 'danger' }))) return;
    const prev = projects;
    setErrorMsg(null);
    setNoticeMsg(null);
    setProjects((cur) => cur.filter((p) => p.id !== proj.id));
    try {
      const res = await fetch(`/api/projects/${proj.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('FAILED');
      router.refresh();
    } catch {
      setProjects(prev);
      setErrorMsg('프로젝트 삭제에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const buildProjectMenu = (proj: ProjectListItem): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [
      {
        id: 'open-new-tab',
        label: '새 탭에서 열기',
        group: 1,
        onSelect: () => window.open(`/projects/${proj.id}`, '_blank', 'noopener,noreferrer'),
      },
      {
        id: 'quick-share',
        label: '게스트 공유 링크 발급·복사',
        group: 1,
        onSelect: () => void handleQuickShare(proj),
      },
    ];

    if (proj.isOwner) {
      menu.push({
        id: 'toggle-vis',
        label: proj.visibility === 'private' ? '팀 공유로 전환' : '나만 보기로 전환',
        group: 2,
        tone: 'owner',
        onSelect: () => void handleToggleVisibility(proj),
      });
    }

    if (proj.isOwner && teamWorkspaces.length === 1) {
      const targetTeam = teamWorkspaces[0];
      menu.push({
        id: 'transfer-team',
        label: `팀으로 이동 (${targetTeam.name})`,
        group: 2,
        onSelect: () => void handleTransferToTeam(proj, targetTeam),
      });
    } else if (proj.isOwner && teamWorkspaces.length > 1) {
      menu.push({
        id: 'transfer-team-settings',
        label: '팀 워크스페이스 선택 이동...',
        group: 2,
        onSelect: () => router.push('/settings'),
      });
    }

    if (proj.isOwner) {
      menu.push({
        id: 'archive',
        label: '프로젝트 보관',
        group: 3,
        onSelect: () => void handleArchiveProject(proj),
      });
      menu.push({
        id: 'delete',
        label: '프로젝트 삭제',
        group: 3,
        tone: 'danger',
        onSelect: () => void handleDeleteProject(proj),
      });
    }

    return menu;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900">프로젝트</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            팀 프로젝트 안에서도 내 메모(기록)는 나만 보기로 안전하게 분리됩니다.
          </p>
        </div>
      </header>

      <form
        onSubmit={(e) => void handleCreate(e)}
        className="rounded-xl border border-slate-200 bg-white p-4"
      >
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={creating}
            placeholder="새 프로젝트 이름 (예: 2026 Q2 계약 검토)"
            className="w-full rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60"
          />
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setVisibility((v) => (v === 'private' ? 'team' : 'private'))}
              aria-label="프로젝트 공개 범위 전환"
            >
              <VisibilityBadge visibility={visibility} />
            </button>
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {creating ? '생성 중...' : '프로젝트 만들기'}
            </button>
          </div>
        </div>
        {errorMsg && <p className="mt-2.5 text-xs text-red-600">{errorMsg}</p>}
      </form>

      {noticeMsg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-700 break-all">
          {noticeMsg}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-700">아직 생성된 프로젝트가 없습니다.</p>
          <p className="mt-1 text-xs text-slate-500">
            위에서 첫 프로젝트를 만들거나 입력함에서 스캔 문서를 프로젝트에 바로 연결해 보세요.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {projects.map((proj) => (
            <li key={proj.id}>
              <ContextMenuWrapper
                items={buildProjectMenu(proj)}
                ariaLabel={`${proj.title} 프로젝트 메뉴`}
              >
                {({ triggerButton }) => (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-blue-300">
                    <Link href={`/projects/${proj.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{proj.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        최근 수정:{' '}
                        {new Date(proj.updatedAt).toLocaleDateString('ko-KR', {
                          timeZone: 'Asia/Seoul',
                        })}
                      </p>
                    </Link>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <VisibilityBadge visibility={proj.visibility} />
                      {triggerButton}
                    </div>
                  </div>
                )}
              </ContextMenuWrapper>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
