/**
 * apps/web/src/lib/tax-receipts.ts
 * Sorts receipts into Korean year-end tax settlement (연말정산) categories from the document text.
 * Pure keyword rules — no AI cost. Results are a starting point for the user, not tax advice.
 */

export type TaxCategoryId = 'medical' | 'education' | 'donation' | 'rent';

export interface TaxCategory {
  id: TaxCategoryId;
  label: string;
  /** Keywords searched in title + summary + OCR text. */
  keywords: string[];
  /** Words that, when present, make a match unreliable (e.g. "보험료" in a medical receipt context). */
  excludes?: string[];
  /** Short hint about items that are often missing from the NTS 간소화 service. */
  hint: string;
}

export const TAX_CATEGORIES: TaxCategory[] = [
  {
    id: 'medical',
    label: '의료비',
    keywords: [
      '병원', '의원', '치과', '한의원', '약국', '의약품', '진료비', '진료', '수술', '입원', '검진', '처방',
      '안경', '콘택트렌즈', '보청기', '산후조리',
    ],
    excludes: ['보험료', '보험증권'],
    hint: '시력교정용 안경·콘택트렌즈, 산후조리원 비용은 간소화 자료에 없을 수 있습니다.',
  },
  {
    id: 'education',
    label: '교육비',
    keywords: ['교복', '등록금', '수업료', '입학금', '유치원', '어린이집', '체험학습', '방과후', '급식비'],
    hint: '교복 구입비, 현장체험학습비는 간소화 자료에 없을 수 있습니다.',
  },
  {
    id: 'donation',
    label: '기부금',
    keywords: ['기부금', '기부', '후원금', '후원', '헌금', '성금', '정치자금'],
    hint: '종교단체·일부 단체 기부금은 간소화 자료에 없을 수 있어 영수증이 필요합니다.',
  },
  {
    id: 'rent',
    label: '월세',
    keywords: ['월세', '임차료'],
    hint: '월세 세액공제는 임대차계약서와 이체 내역을 직접 내야 할 수 있습니다.',
  },
];

const CATEGORY_BY_ID = new Map(TAX_CATEGORIES.map((c) => [c.id, c]));

export function taxCategory(id: TaxCategoryId): TaxCategory {
  return CATEGORY_BY_ID.get(id) as TaxCategory;
}

/**
 * Returns the best-matching category, or null.
 * The category with the most keyword hits wins; ties go to the earlier category in TAX_CATEGORIES.
 */
export function classifyTaxReceipt(text: string | null | undefined): TaxCategoryId | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ');
  let best: { id: TaxCategoryId; hits: number } | null = null;

  for (const category of TAX_CATEGORIES) {
    if (category.excludes?.some((word) => normalized.includes(word))) continue;
    const hits = category.keywords.filter((word) => normalized.includes(word)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { id: category.id, hits };
  }
  return best?.id ?? null;
}

/**
 * Amount to count for a receipt. For rent, only the figure right after "월세" counts
 * (a lease also lists the 보증금, which is not rent).
 */
export function receiptAmount(
  text: string,
  category: TaxCategoryId,
  detectAmount: (t: string) => { value: number } | null
): number | null {
  if (category === 'rent') {
    if (isProofDocument(text, category)) return null;
    // First amount that follows any "월세" mention (the title may mention it before the amount).
    for (let idx = text.indexOf('월세'); idx >= 0; idx = text.indexOf('월세', idx + 2)) {
      const found = detectAmount(text.slice(idx, idx + 40));
      if (found) return found.value;
    }
    return null;
  }
  return detectAmount(text)?.value ?? null;
}

/** Supporting documents that prove a deduction but are not payments (e.g. a lease for 월세). */
export function isProofDocument(text: string, category: TaxCategoryId): boolean {
  return category === 'rent' && text.includes('계약서');
}

/** Whether a classified document should be listed (receipts, or rent proof such as a lease). */
export function isTaxDocument(text: string, category: TaxCategoryId, amount: number | null): boolean {
  if (amount !== null) return true;
  if (text.includes('영수증')) return true;
  return isProofDocument(text, category);
}

/** Year whose receipts people are usually collecting right now (Jan–Feb → last year). */
export function defaultTaxYear(now: Date = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const year = kst.getUTCFullYear();
  return kst.getUTCMonth() <= 1 ? year - 1 : year;
}

/** [start, end) of a KST calendar year as ISO strings, for created_at range queries. */
export function kstYearRange(year: number): { startIso: string; endIso: string } {
  const offset = 9 * 3_600_000;
  return {
    startIso: new Date(Date.UTC(year, 0, 1) - offset).toISOString(),
    endIso: new Date(Date.UTC(year + 1, 0, 1) - offset).toISOString(),
  };
}

export interface TaxReceiptCsvRow {
  date: string;
  category: string;
  title: string;
  amount: number | null;
  originalStatus: string;
}

function csvCell(value: string): string {
  // Neutralize spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV with a UTF-8 BOM so Excel opens Korean text correctly. */
export function buildTaxCsv(rows: TaxReceiptCsvRow[]): string {
  const header = ['날짜', '분류', '내용', '금액(원)', '원본'];
  const lines = rows.map((r) =>
    [r.date, r.category, r.title, r.amount === null ? '' : String(r.amount), r.originalStatus].map(csvCell).join(',')
  );
  return `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}
