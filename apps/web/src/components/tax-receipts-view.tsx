'use client';

/**
 * apps/web/src/components/tax-receipts-view.tsx
 * 연말정산 서류함: category totals, receipt list, original-file status and CSV export.
 */
import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { pricingHref } from '@/lib/plans';
import { TAX_CATEGORIES, buildTaxCsv, taxCategory, type TaxCategoryId } from '@/lib/tax-receipts';

export interface TaxReceiptRow {
  id: string;
  title: string;
  summary: string | null;
  createdAt: string;
  category: TaxCategoryId;
  amount: number | null;
  /** Supporting document (e.g. lease for 월세): listed, but not a payment. */
  isProof: boolean;
  /** kept = original file available · expired = removed after the free 30 days · none = text only */
  original: 'kept' | 'expired' | 'none';
  originalExpiresAt: string | null;
}

const CATEGORY_STYLE: Record<TaxCategoryId, string> = {
  medical: 'bg-rose-50 text-rose-800 ring-rose-200',
  education: 'bg-amber-50 text-amber-800 ring-amber-200',
  donation: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  rent: 'bg-sky-50 text-sky-800 ring-sky-200',
};

function formatWon(value: number): string {
  return `${value.toLocaleString('ko-KR')}원`;
}

function kstDate(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function TaxReceiptsView({
  year,
  years,
  rows,
  isFreePlan,
}: {
  year: number;
  years: number[];
  rows: TaxReceiptRow[];
  isFreePlan: boolean;
}) {
  const [filter, setFilter] = useState<TaxCategoryId | 'all'>('all');
  const [openError, setOpenError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const map = new Map<TaxCategoryId, { count: number; sum: number; missingAmount: number }>();
    for (const c of TAX_CATEGORIES) map.set(c.id, { count: 0, sum: 0, missingAmount: 0 });
    for (const r of rows) {
      const t = map.get(r.category)!;
      t.count += 1;
      if (r.amount !== null) t.sum += r.amount;
      else if (!r.isProof) t.missingAmount += 1;
    }
    return map;
  }, [rows]);

  const visible = filter === 'all' ? rows : rows.filter((r) => r.category === filter);
  const expiredCount = rows.filter((r) => r.original === 'expired').length;
  const expiringCount = rows.filter((r) => r.original === 'kept' && r.originalExpiresAt).length;

  const handleExport = () => {
    const csv = buildTaxCsv(
      visible.map((r) => ({
        date: kstDate(r.createdAt),
        category: taxCategory(r.category).label,
        title: r.title,
        amount: r.amount,
        originalStatus: (r.isProof ? '증빙 서류 · ' : '') + (r.original === 'kept' ? '보관 중' : r.original === 'expired' ? '만료됨' : '없음'),
      }))
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    // ASCII file name: some browsers drop non-ASCII names and save the file as "download" without .csv
    a.download = `tax-receipts-${year}${filter === 'all' ? '' : `-${filter}`}.csv`;
    document.body.appendChild(a);
    a.click();
    // Revoke after the browser has picked up the download (immediate revoke can drop the file name).
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const handleOpenOriginal = async (id: string) => {
    setOpenError(null);
    try {
      const res = await fetch(`/api/files/${id}/signed-url`, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { signedUrl?: string };
      if (!res.ok || !data.signedUrl) {
        setOpenError(res.status === 410 ? '원본 파일이 이미 정리되었습니다.' : '원본 파일을 열 수 없습니다.');
        return;
      }
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setOpenError('네트워크 오류로 원본 파일을 열 수 없습니다.');
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">연말정산 서류함</h1>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {year}년에 올린 영수증을 내용으로 읽어 의료비·교육비·기부금·월세로 나눴습니다. 간소화 서비스에 없는 항목을 챙길 때
            쓰세요.
          </p>
        </div>
        <nav className="flex gap-1" aria-label="연도 선택">
          {years.map((y) => (
            <Link
              key={y}
              href={`/tax?year=${y}`}
              aria-current={y === year ? 'page' : undefined}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                y === year ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {y}년
            </Link>
          ))}
        </nav>
      </header>

      {isFreePlan && (expiredCount > 0 || expiringCount > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            {expiredCount > 0
              ? `원본이 이미 정리된 영수증이 ${expiredCount}건 있습니다.`
              : `영수증 ${expiringCount}건의 원본이 올린 날부터 30일 뒤 정리됩니다.`}
          </p>
          <p className="mt-1 text-xs leading-relaxed">
            무료 플랜은 원본 파일을 30일만 보관합니다. 금액과 본문은 남지만, 연말정산 때 영수증 원본을 내야 한다면 1년 내내 보관해야
            합니다.{' '}
            <Link href={pricingHref('tax')} className="font-semibold underline underline-offset-2">
              프로로 원본 지키기 →
            </Link>
          </p>
        </div>
      )}

      <section aria-label="분류별 합계" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TAX_CATEGORIES.map((c) => {
          const t = totals.get(c.id)!;
          const active = filter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilter(active ? 'all' : c.id)}
              aria-pressed={active}
              className={`rounded-xl border bg-white p-4 text-left transition-colors ${
                active ? 'border-blue-600 ring-1 ring-blue-200' : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CATEGORY_STYLE[c.id]}`}>
                {c.label}
              </span>
              <p className="mt-2 text-lg font-bold tracking-tight text-slate-900">{formatWon(t.sum)}</p>
              <p className="text-xs text-slate-500">
                {t.count}건{t.missingAmount > 0 ? ` · 금액 확인 ${t.missingAmount}건` : ''}
              </p>
            </button>
          );
        })}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {filter === 'all' ? '전체' : taxCategory(filter).label} 영수증 {visible.length}건
          </h2>
          <button
            type="button"
            onClick={handleExport}
            disabled={visible.length === 0}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            엑셀(CSV)로 내려받기
          </button>
        </div>

        {openError && <p className="px-4 pt-3 text-xs text-red-700">{openError}</p>}

        {visible.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">{year}년 영수증이 아직 없습니다.</p>
            <p className="mt-1 text-xs text-slate-500">
              병원·약국·안경점 영수증, 기부금 영수증, 월세 이체 내역을{' '}
              <Link href="/inbox" className="font-medium text-blue-700 hover:underline">
                입력함
              </Link>
              에 올리면 자동으로 여기에 모입니다.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${CATEGORY_STYLE[r.category]}`}>
                      {taxCategory(r.category).label}
                    </span>
                    <time dateTime={r.createdAt}>{kstDate(r.createdAt)}</time>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-900">{r.title}</p>
                  {r.summary && <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">{r.summary}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-sm font-bold text-slate-900">
                    {r.amount !== null ? (
                      formatWon(r.amount)
                    ) : r.isProof ? (
                      <span className="text-xs font-medium text-slate-500">증빙 서류</span>
                    ) : (
                      <span className="text-xs font-medium text-amber-700">금액 확인 필요</span>
                    )}
                  </span>
                  {r.original === 'kept' ? (
                    <button
                      type="button"
                      onClick={() => void handleOpenOriginal(r.id)}
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      원본 열기
                    </button>
                  ) : r.original === 'expired' ? (
                    <span className="text-xs text-slate-400" title="무료 플랜에서 30일이 지나 원본 파일이 정리되었습니다. 본문과 금액은 남아 있습니다.">
                      원본 정리됨
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-[#F7F8FA] p-4">
        <h2 className="text-sm font-semibold text-slate-900">간소화 자료에서 빠지기 쉬운 항목</h2>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600">
          {TAX_CATEGORIES.map((c) => (
            <li key={c.id}>
              <strong className="font-semibold text-slate-800">{c.label}</strong> · {c.hint}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-slate-400">
          분류는 영수증 글자를 보고 자동으로 정한 것입니다. 공제 대상 여부와 한도는 국세청 안내를 확인하세요.
        </p>
      </section>
    </div>
  );
}
