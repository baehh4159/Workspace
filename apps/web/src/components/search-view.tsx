'use client';

/**
 * apps/web/src/components/search-view.tsx
 * Full-text pg_trgm Search + 3-zone Context Menu on Result Cards:
 *  - Consistent source label ('스캔 문서' | '음성 메모' | '메모')
 *  - Safe React keyword <mark> highlighting in title & snippet
 */
import React, { useState } from 'react';
import { ContextMenuWrapper, type ContextMenuItem } from '@/components/context-menu';

interface SearchResultItem {
  id: string;
  title: string | null;
  snippet: string;
  sourceType: 'scanner_doc' | 'quick_tag' | 'quick_text' | 'quick_voice';
  createdAt: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightKeyword(text: string, keyword: string): React.ReactNode {
  const clean = keyword.trim();
  if (!clean) return text;
  const regex = new RegExp(`(${escapeRegExp(clean)})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, idx) =>
    idx % 2 === 1 ? (
      <mark key={idx} className="rounded bg-blue-50 px-0.5 font-medium text-blue-800">
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

function getSourceLabel(sourceType: SearchResultItem['sourceType']): string {
  if (sourceType === 'scanner_doc') return '스캔 문서';
  if (sourceType === 'quick_voice') return '음성 메모';
  return '메모';
}

export function SearchView({
  workspaceId,
  authToken,
  isFreePlan = true,
  onUpgradeClick,
}: {
  workspaceId: string;
  authToken?: string;
  isFreePlan?: boolean;
  onUpgradeClick?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [olderMatchCount, setOlderMatchCount] = useState(0);
  const [isPaywallLimited, setIsPaywallLimited] = useState(isFreePlan);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const authHeaders = (): HeadersInit =>
    authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setLoading(true);
    setSearched(true);
    setSubmittedQuery(trimmed);
    setSearchError(null);
    setActionNotice(null);
    try {
      const params = new URLSearchParams({ workspaceId, q: trimmed, limit: '20' });
      const res = await fetch(`/api/search?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) {
        setItems([]);
        setOlderMatchCount(0);
        setSearchError('검색 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const data = (await res.json()) as {
        items: SearchResultItem[];
        olderMatchCount: number;
        isPaywallLimited: boolean;
      };
      setItems(data.items);
      setOlderMatchCount(data.olderMatchCount);
      setIsPaywallLimited(data.isPaywallLimited);
    } catch {
      setItems([]);
      setOlderMatchCount(0);
      setSearchError('네트워크 연결을 확인한 뒤 다시 검색해 주세요.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenOriginal = async (itemId: string) => {
    setActionNotice(null);
    try {
      const res = await fetch(`/api/files/${itemId}/signed-url`, {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (!res.ok) {
        setSearchError(
          res.status === 410
            ? '원본 파일이 이미 만료되었거나 삭제되었습니다.'
            : '원본 파일을 열 수 없습니다.'
        );
        return;
      }
      const data = (await res.json()) as { signedUrl?: string };
      if (data.signedUrl) {
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      }
    } catch {
      setSearchError('네트워크 오류로 원본 파일을 열 수 없습니다.');
    }
  };

  const handleCopySnippet = async (item: SearchResultItem) => {
    setSearchError(null);
    try {
      await navigator.clipboard.writeText(item.snippet || item.title || '');
      setActionNotice('요약·스니펫을 클립보드에 복사했습니다.');
    } catch {
      setSearchError('클립보드 복사에 실패했습니다.');
    }
  };

  const handleConvertToTask = async (item: SearchResultItem) => {
    setSearchError(null);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/inbox/${item.id}/triage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          workspaceId,
          action: 'convert_to_task',
          taskTitle: item.title || item.snippet.slice(0, 80) || '새 할 일',
        }),
      });
      if (!res.ok) throw new Error('FAILED');
      setActionNotice('검색 항목을 할 일로 전환했습니다.');
    } catch {
      setSearchError('할 일 전환에 실패했습니다.');
    }
  };

  const buildResultMenu = (item: SearchResultItem): ContextMenuItem[] => {
    const menu: ContextMenuItem[] = [];
    if (item.sourceType === 'scanner_doc' || item.sourceType === 'quick_voice') {
      menu.push({
        id: 'open-original',
        label: '원본 파일 열기 (새 탭)',
        group: 1,
        onSelect: () => void handleOpenOriginal(item.id),
      });
    }
    menu.push({
      id: 'copy-snippet',
      label: '요약·스니펫 복사',
      group: 1,
      onSelect: () => void handleCopySnippet(item),
    });
    menu.push({
      id: 'to-task',
      label: '할 일로 전환',
      group: 2,
      onSelect: () => void handleConvertToTask(item),
    });
    return menu;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 sm:px-6">
      <div>
        <form onSubmit={(e) => void runSearch(e)} className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="스캔 문서 본문, 견적서 키워드, 메모 검색..."
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="shrink-0 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            {loading ? '검색 중' : '검색'}
          </button>
        </form>
        {isPaywallLimited && (
          <p className="mt-2 px-1 text-xs text-slate-500">
            무료 플랜: 최근 30일 문서 기준 검색 중
          </p>
        )}
      </div>

      {searchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {searchError}
        </div>
      )}

      {actionNotice && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-medium text-blue-800">
          {actionNotice}
        </div>
      )}

      {searched && !searchError && items.length > 0 && (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id}>
              <ContextMenuWrapper
                items={buildResultMenu(item)}
                ariaLabel={`${item.title || '검색 결과'} 작업 메뉴`}
              >
                {({ triggerButton }) => (
                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{getSourceLabel(item.sourceType)}</span>
                      <div className="flex items-center gap-1.5">
                        <time dateTime={item.createdAt}>
                          {new Date(item.createdAt).toLocaleDateString('ko-KR', {
                            timeZone: 'Asia/Seoul',
                          })}
                        </time>
                        {triggerButton}
                      </div>
                    </div>
                    <h2 className="mt-1 text-sm font-semibold text-slate-900">
                      {highlightKeyword(item.title || '제목 없는 항목', submittedQuery)}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                      {highlightKeyword(item.snippet, submittedQuery)}
                    </p>
                  </div>
                )}
              </ContextMenuWrapper>
            </li>
          ))}
        </ul>
      )}

      {searched && !searchError && isPaywallLimited && olderMatchCount > 0 && (
        <section className="relative overflow-hidden rounded-xl border border-blue-200 bg-white p-5">
          <div aria-hidden="true" className="pointer-events-none select-none space-y-2.5 opacity-45 blur-[3px]">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="h-3.5 w-2/5 rounded bg-slate-300" />
              <div className="mt-2 h-3 w-4/5 rounded bg-slate-200" />
            </div>
            {olderMatchCount > 1 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="h-3.5 w-1/3 rounded bg-slate-300" />
                <div className="mt-2 h-3 w-3/4 rounded bg-slate-200" />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col items-start justify-between gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-semibold text-slate-900">
                30일 이전 스캔 문서에서 <span className="text-blue-700">{olderMatchCount}건</span> 더 발견됨
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                프로·팀 플랜으로 업그레이드하면 전체 기간 본문 검색과 원본 장기 보관이 열립니다.
              </p>
            </div>
            <button
              type="button"
              onClick={onUpgradeClick}
              className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              전체 검색 열기
            </button>
          </div>
        </section>
      )}

      {searched && !loading && !searchError && items.length === 0 && olderMatchCount === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
          일치하는 문서나 메모가 없습니다.
        </p>
      )}
    </div>
  );
}
