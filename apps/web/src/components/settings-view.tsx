'use client';

/**
 * apps/web/src/components/settings-view.tsx
 * Workspace Settings View with 3-zone Context Menu on Active Share Link rows:
 *  - Right-click / ⋯ menu: 연결된 원본 항목 열기, 공유 링크 즉시 회수 (no raw URL re-copy per token_hash security)
 */
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContextMenuWrapper, type ContextMenuItem } from '@/components/context-menu';

export interface AiQuotaRow {
  usageType: 'doc_ocr_pages' | 'voice_stt_seconds' | 'text_classify';
  label: string;
  usedUnits: number;
  reservedUnits: number;
  limitUnits: number;
  unitLabel: string;
}

export interface ActiveShareItem {
  id: string;
  entityType: 'inbox_item' | 'project' | 'task';
  entityId: string;
  scope: 'read_only' | 'view_and_join';
  expiresAt: string;
  createdAt: string;
  canRevoke: boolean;
}

export interface TeamWorkspaceOption {
  id: string;
  name: string;
}

export interface TransferableItem {
  id: string;
  title: string;
  kind: 'project' | 'inbox_item';
}

const ENTITY_LABEL: Record<ActiveShareItem['entityType'], string> = {
  inbox_item: '스캔·메모',
  project: '프로젝트',
  task: '할 일',
};

const FREE_STORAGE_LIMIT_BYTES = 500 * 1024 * 1024;

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatQuotaDisplay(q: AiQuotaRow): string {
  const consumed = q.usedUnits + q.reservedUnits;
  if (q.usageType === 'voice_stt_seconds') {
    const usedMin = consumed / 60;
    const limitMin = Math.round(q.limitUnits / 60);
    const formattedUsed = Number.isInteger(usedMin) ? String(usedMin) : usedMin.toFixed(1);
    return `${formattedUsed} / ${limitMin} 분`;
  }
  return `${consumed} / ${q.limitUnits} ${q.unitLabel}`;
}

function getSourceHref(share: ActiveShareItem): string {
  if (share.entityType === 'project') return `/projects/${share.entityId}`;
  if (share.entityType === 'inbox_item') return '/inbox';
  return '/today';
}

export function SettingsView({
  workspace,
  activeMemberCount,
  periodYm,
  aiQuotas,
  initialShares,
  teamWorkspaces = [],
  transferableItems = [],
}: {
  workspace: {
    id: string;
    name: string;
    type: 'personal' | 'team';
    plan: 'free' | 'pro' | 'team';
    maxSeats: number;
    storageUsedBytes: number;
  };
  activeMemberCount: number;
  periodYm: string;
  aiQuotas: AiQuotaRow[];
  initialShares: ActiveShareItem[];
  teamWorkspaces?: TeamWorkspaceOption[];
  transferableItems?: TransferableItem[];
}) {
  const router = useRouter();
  const [shares, setShares] = useState<ActiveShareItem[]>(initialShares);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [teamName, setTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);

  const [targetTeamId, setTargetTeamId] = useState(teamWorkspaces[0]?.id ?? '');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [selectedInboxIds, setSelectedInboxIds] = useState<string[]>([]);
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    setShares(initialShares);
  }, [initialShares]);

  useEffect(() => {
    if (!targetTeamId && teamWorkspaces[0]?.id) {
      setTargetTeamId(teamWorkspaces[0].id);
    }
  }, [teamWorkspaces, targetTeamId]);

  const storagePct =
    workspace.plan === 'free'
      ? Math.min(100, Math.round((workspace.storageUsedBytes / FREE_STORAGE_LIMIT_BYTES) * 100))
      : 0;

  const handleRevoke = async (shareId: string, skipConfirm = false) => {
    if (!skipConfirm && !window.confirm('이 공유 링크를 즉시 회수할까요? 외부 접근이 바로 차단됩니다.')) {
      return;
    }
    setRevokingId(shareId);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/shares', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspace.id, shareId }),
      });
      if (!res.ok) {
        setErrorMsg('공유 링크 회수에 실패했습니다. 권한을 확인해 주세요.');
        return;
      }
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      router.refresh();
    } catch {
      setErrorMsg('네트워크 오류로 공유 링크를 회수하지 못했습니다.');
    } finally {
      setRevokingId(null);
    }
  };

  const buildShareMenu = (s: ActiveShareItem): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [
      {
        id: 'open-source',
        label: '연결된 원본 항목 열기',
        group: 1,
        onSelect: () => router.push(getSourceHref(s)),
      },
    ];
    if (s.canRevoke) {
      menu.push({
        id: 'revoke',
        label: '공유 링크 즉시 회수',
        group: 3,
        tone: 'danger',
        disabled: revokingId === s.id,
        onSelect: () => void handleRevoke(s.id, false),
      });
    }
    return menu;
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creatingTeam || !teamName.trim()) return;
    setCreatingTeam(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: teamName.trim() }),
      });
      if (!res.ok) {
        setErrorMsg('팀 워크스페이스 생성에 실패했습니다.');
        return;
      }
      setTeamName('');
      setSuccessMsg('새 팀 워크스페이스를 만들고 전환했습니다.');
      router.refresh();
    } catch {
      setErrorMsg('네트워크 오류로 팀 워크스페이스를 생성하지 못했습니다.');
    } finally {
      setCreatingTeam(false);
    }
  };

  const toggleTransferItem = (item: TransferableItem) => {
    if (item.kind === 'project') {
      setSelectedProjectIds((prev) =>
        prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]
      );
    } else {
      setSelectedInboxIds((prev) =>
        prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]
      );
    }
  };

  const handleTransfer = async () => {
    const totalSelected = selectedProjectIds.length + selectedInboxIds.length;
    if (transferring || !targetTeamId || totalSelected === 0) return;

    setTransferring(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/workspaces/transfer-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceWorkspaceId: workspace.id,
          targetWorkspaceId: targetTeamId,
          projectIds: selectedProjectIds,
          inboxItemIds: selectedInboxIds,
        }),
      });
      if (res.status === 402) {
        setErrorMsg('대상 팀 워크스페이스의 무료 저장 용량(500MB)을 초과하여 이동할 수 없습니다.');
        return;
      }
      if (!res.ok) {
        setErrorMsg('선택 항목 이동에 실패했습니다.');
        return;
      }
      setSelectedProjectIds([]);
      setSelectedInboxIds([]);
      setSuccessMsg(`선택한 ${totalSelected}건의 항목을 팀 워크스페이스로 안전하게 이동했습니다.`);
      router.refresh();
    } catch {
      setErrorMsg('네트워크 오류로 항목 이동에 실패했습니다.');
    } finally {
      setTransferring(false);
    }
  };

  const selectedCount = selectedProjectIds.length + selectedInboxIds.length;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-lg font-bold tracking-tight text-slate-900">워크스페이스 설정</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          {workspace.name} · {workspace.type === 'team' ? '팀 워크스페이스' : '개인 워크스페이스'} ·{' '}
          <strong className="font-semibold uppercase text-slate-700">{workspace.plan}</strong> 플랜
        </p>
      </header>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-700">
          {successMsg}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">플랜 · 좌석 · 저장 용량</h2>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
            좌석 {activeMemberCount} / {workspace.maxSeats}명
          </span>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>원본 스캔·음성 저장 용량</span>
            <span className="font-medium text-slate-900">
              {formatMb(workspace.storageUsedBytes)}
              {workspace.plan === 'free' ? ' / 500.0 MB' : ' (유료 확장)'}
            </span>
          </div>
          {workspace.plan === 'free' && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${storagePct >= 85 ? 'bg-amber-500' : 'bg-blue-700'}`}
                style={{ width: `${storagePct}%` }}
              />
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            {workspace.plan === 'free'
              ? '무료 플랜은 원본 파일을 30일 보관하며(만료 7일·1일 전 알림), 처리 실패한 원본은 자동 삭제되지 않습니다.'
              : '유료 플랜은 사용자 확인(user_confirmed_at) 전까지 원본 파일을 자동 삭제하지 않습니다.'}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">새 팀 워크스페이스 만들기</h2>
          <p className="text-xs text-slate-500">
            개인 워크스페이스는 그대로 유지되며, 최대 10명이 함께 쓰는 별도 팀 공간이 생성됩니다.
          </p>
        </div>

        <form onSubmit={(e) => void handleCreateTeam(e)} className="flex items-center gap-2">
          <input
            type="text"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            disabled={creatingTeam}
            placeholder="팀 이름 (예: 스튜디오 A 팀)"
            className="w-full rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={creatingTeam || !teamName.trim()}
            className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {creatingTeam ? '생성 중...' : '팀 만들기'}
          </button>
        </form>
      </section>

      {workspace.type === 'personal' && teamWorkspaces.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">개인 → 팀 항목 선택 이동</h2>
            <p className="text-xs text-slate-500">
              선택한 프로젝트·문서만 팀 워크스페이스로 옮기며, 기존 공개 설정(나만 보기)은 그대로 유지됩니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={targetTeamId}
              onChange={(e) => setTargetTeamId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-[#F7F8FA] px-3 py-1.5 text-xs font-medium text-slate-800"
            >
              {teamWorkspaces.map((tw) => (
                <option key={tw.id} value={tw.id}>
                  이동 대상: [팀] {tw.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={transferring || selectedCount === 0}
              onClick={() => void handleTransfer()}
              className="rounded-lg bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {transferring ? '이동 중...' : `선택 항목 이동 (${selectedCount}건)`}
            </button>
          </div>

          {transferableItems.length === 0 ? (
            <p className="rounded-lg bg-[#F7F8FA] px-3.5 py-3 text-xs text-slate-500">
              이동할 수 있는 개인 프로젝트나 스캔·메모 항목이 없습니다.
            </p>
          ) : (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
              {transferableItems.map((item) => {
                const checked =
                  item.kind === 'project'
                    ? selectedProjectIds.includes(item.id)
                    : selectedInboxIds.includes(item.id);
                return (
                  <li key={`${item.kind}-${item.id}`} className="px-3 py-2.5">
                    <label className="flex cursor-pointer items-center justify-between gap-3">
                      <span className="flex items-center gap-2.5 text-xs text-slate-800">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTransferItem(item)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                        />
                        {item.title}
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {item.kind === 'project' ? '프로젝트' : '스캔·메모'}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">월간 AI 처리 한도 ({periodYm})</h2>
          <span className="text-[11px] text-slate-500">Zero Data Retention 적용</span>
        </div>

        <div className="space-y-3">
          {aiQuotas.map((q) => {
            const consumed = q.usedUnits + q.reservedUnits;
            const pct = q.limitUnits > 0 ? Math.min(100, Math.round((consumed / q.limitUnits) * 100)) : 0;
            return (
              <div key={q.usageType} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-700">{q.label}</span>
                  <span className="font-medium text-slate-900">{formatQuotaDisplay(q)}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : 'bg-blue-700'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">활성 게스트 공유 링크 ({shares.length})</h2>
          <p className="text-xs text-slate-500">
            회수 버튼 클릭 또는 우클릭 메뉴에서 즉시 링크 접근을 차단할 수 있습니다.
          </p>
        </div>

        {shares.length === 0 ? (
          <p className="rounded-lg bg-[#F7F8FA] px-3.5 py-4 text-xs text-slate-500">
            현재 활성화된 외부 공유 링크가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shares.map((s) => (
              <li key={s.id} className="py-2 first:pt-1 last:pb-1">
                <ContextMenuWrapper
                  items={buildShareMenu(s)}
                  ariaLabel={`${ENTITY_LABEL[s.entityType]} 공유 링크 메뉴`}
                >
                  {({ triggerButton }) => (
                    <div className="flex items-center justify-between gap-3 py-1">
                      <div>
                        <p className="text-xs font-semibold text-slate-900">
                          {ENTITY_LABEL[s.entityType]} ·{' '}
                          <span className="font-normal text-slate-600">
                            {s.scope === 'view_and_join' ? '열람 + 팀 합류' : '열람 전용'}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          만료일:{' '}
                          {new Date(s.expiresAt).toLocaleDateString('ko-KR', {
                            timeZone: 'Asia/Seoul',
                          })}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {s.canRevoke && (
                          <button
                            type="button"
                            disabled={revokingId === s.id}
                            onClick={() => void handleRevoke(s.id, false)}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
                          >
                            {revokingId === s.id ? '회수 중...' : '즉시 회수'}
                          </button>
                        )}
                        {triggerButton}
                      </div>
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
