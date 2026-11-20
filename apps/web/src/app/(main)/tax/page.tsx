/**
 * apps/web/src/app/(main)/tax/page.tsx
 * 연말정산 서류함: receipts of the selected year grouped into 의료비·교육비·기부금·월세 from their text.
 */
import React from 'react';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { detectAmount } from '@/lib/deadline-detect';
import {
  classifyTaxReceipt,
  defaultTaxYear,
  isProofDocument,
  isTaxDocument,
  kstYearRange,
  receiptAmount,
} from '@/lib/tax-receipts';
import { TaxReceiptsView, type TaxReceiptRow } from '@/components/tax-receipts-view';

export const dynamic = 'force-dynamic';

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  const { year: yearParam } = await searchParams;
  const suggestedYear = defaultTaxYear();
  const thisYear = new Date(Date.now() + 9 * 3_600_000).getUTCFullYear();
  const parsedYear = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : suggestedYear;
  const year = Math.min(thisYear, Math.max(thisYear - 5, parsedYear));
  const { startIso, endIso } = kstYearRange(year);

  const { data } = await session.userClient
    .from('inbox_items')
    .select('id, title, summary_text, extracted_text, raw_text, created_at, storage_path, original_purged_at, original_expires_at')
    .eq('workspace_id', session.activeWorkspace.id)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('created_at', { ascending: false })
    .limit(500);

  const rows: TaxReceiptRow[] = [];
  for (const item of data ?? []) {
    const text = [item.title, item.summary_text, item.extracted_text, item.raw_text]
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .join('\n');
    const category = classifyTaxReceipt(text);
    if (!category) continue;
    const amount = receiptAmount(text, category, detectAmount);
    if (!isTaxDocument(text, category, amount)) continue;

    rows.push({
      id: item.id as string,
      title: (item.title as string | null) ?? '제목 없는 영수증',
      summary: (item.summary_text as string | null) ?? null,
      createdAt: item.created_at as string,
      category,
      amount,
      isProof: isProofDocument(text, category),
      original: item.original_purged_at
        ? 'expired'
        : item.storage_path
          ? 'kept'
          : 'none',
      originalExpiresAt: (item.original_expires_at as string | null) ?? null,
    });
  }

  const years = Array.from({ length: 3 }, (_, i) => thisYear - i);

  return (
    <TaxReceiptsView
      key={`${session.activeWorkspace.id}-${year}`}
      year={year}
      years={years}
      rows={rows}
      isFreePlan={session.activeWorkspace.plan === 'free'}
    />
  );
}
