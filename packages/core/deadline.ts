/**
 * packages/core/deadline.ts (shared by web and mobile)
 * Finds a deadline ("11/30까지 납부", "납부기한 2026-11-30", "금요일까지", "2027-01-14 만료")
 * and a money amount ("청구금액 48,320원") in Korean document text.
 *
 * Pure functions, no AI cost: runs on the OCR text/summary the AI already produced, or on memos.
 * A date only counts as a deadline when a deadline word (까지·마감·기한·만료·납부·제출…) is next to it,
 * so receipt dates and meeting dates are not turned into due dates.
 */

export interface DetectedDeadline {
  /** ISO timestamp: 18:00 KST on the detected day. */
  dueAt: string;
  /** e.g. "11월 30일 (월)" or "2027년 1월 14일 (목)" */
  label: string;
  /** e.g. "11/30" or "27/1/14" */
  shortLabel: string;
  /** Whole days from today (KST). Negative = already past. */
  daysFromToday: number;
  /** Deadline word that triggered the match, e.g. "까지" / "만료". */
  keyword: string;
}

export interface DetectedAmount {
  value: number;
  /** e.g. "48,320원" */
  label: string;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** Words right AFTER a date that make it a deadline. */
const AFTER_KEYWORDS = ['까지', '마감', '만료', '납부', '제출', '내로', '전까지'];
/** Words shortly BEFORE a date that make it a deadline. */
const BEFORE_KEYWORDS = [
  '납부기한', '납기', '마감일', '마감', '기한', '만료일', '만료', '제출기한', '제출', '결제일', '납부일', '유효기간', '갱신일',
];
/** Words before a "A ~ B" range whose end date is an expiry. */
const RANGE_KEYWORDS = ['계약기간', '임대기간', '보험기간', '유효기간', '기간'];

const AMOUNT_KEYWORDS = ['청구', '납부', '결제', '합계', '총액', '총', '본인부담', '금액', '보증금', '월세'];

interface KstDay {
  y: number;
  m: number;
  d: number;
}

function kstToday(now: Date): KstDay {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}

/** UTC epoch of 00:00 KST for a KST calendar day. */
function kstMidnight(day: KstDay): number {
  return Date.UTC(day.y, day.m - 1, day.d) - KST_OFFSET_MS;
}

function isValidDay(day: KstDay): boolean {
  if (day.m < 1 || day.m > 12 || day.d < 1 || day.d > 31) return false;
  const probe = new Date(Date.UTC(day.y, day.m - 1, day.d));
  return probe.getUTCMonth() === day.m - 1 && probe.getUTCDate() === day.d;
}

function addDays(day: KstDay, days: number): KstDay {
  const probe = new Date(Date.UTC(day.y, day.m - 1, day.d) + days * DAY_MS);
  return { y: probe.getUTCFullYear(), m: probe.getUTCMonth() + 1, d: probe.getUTCDate() };
}

function weekdayOf(day: KstDay): number {
  return new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
}

interface Candidate {
  day: KstDay;
  start: number;
  end: number;
  keyword: string | null;
}

function keywordAfter(text: string, end: number): string | null {
  const window = text.slice(end, end + 8).replace(/^[\s,.)\]]*(일)?\s*/, '');
  for (const kw of AFTER_KEYWORDS) {
    if (window.startsWith(kw)) return kw;
  }
  return null;
}

function keywordBefore(text: string, start: number): string | null {
  const window = text.slice(Math.max(0, start - 12), start);
  let best: { kw: string; pos: number } | null = null;
  for (const kw of BEFORE_KEYWORDS) {
    const pos = window.lastIndexOf(kw);
    if (pos >= 0 && (!best || pos + kw.length > best.pos + best.kw.length)) best = { kw, pos };
  }
  return best?.kw ?? null;
}

/** Year for a month/day written without a year: the occurrence closest to today (up to 60 days back). */
function inferYear(m: number, d: number, today: KstDay): number {
  const thisYear = { y: today.y, m, d };
  const diffDays = (kstMidnight(thisYear) - kstMidnight(today)) / DAY_MS;
  return diffDays < -60 ? today.y + 1 : today.y;
}

function collectCandidates(text: string, today: KstDay): Candidate[] {
  const out: Candidate[] = [];
  const taken: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const push = (day: KstDay, start: number, end: number) => {
    if (!isValidDay(day) || overlaps(start, end)) return;
    taken.push([start, end]);
    out.push({ day, start, end, keyword: null });
  };

  // 2026-11-30 · 2026.11.30 · 2026/11/30 · 2026년 11월 30일
  for (const m of text.matchAll(/(20\d{2})\s*(?:[-./]|년)\s*(\d{1,2})\s*(?:[-./]|월)\s*(\d{1,2})\s*일?/g)) {
    push({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }, m.index!, m.index! + m[0].length);
  }
  // 11월 30일
  for (const m of text.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    push({ y: inferYear(mo, d, today), m: mo, d }, m.index!, m.index! + m[0].length);
  }
  // 11/30 (not part of a longer number like 2026/11/30 or 1/2/3)
  for (const m of text.matchAll(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    push({ y: inferYear(mo, d, today), m: mo, d }, m.index!, m.index! + m[0].length);
  }
  // 오늘 / 내일 / 모레
  for (const m of text.matchAll(/(오늘|내일|모레)/g)) {
    const offset = m[1] === '오늘' ? 0 : m[1] === '내일' ? 1 : 2;
    push(addDays(today, offset), m.index!, m.index! + m[0].length);
  }
  // (이번 주 | 다음 주) 금요일
  for (const m of text.matchAll(/(이번\s*주|다음\s*주|담주)?\s*([월화수목금토일])요일/g)) {
    const target = WEEKDAYS.indexOf(m[2]);
    const todayWd = weekdayOf(today);
    let offset: number;
    if (m[1]) {
      const isoToday = todayWd === 0 ? 7 : todayWd; // Mon=1..Sun=7
      const isoTarget = target === 0 ? 7 : target;
      const thisMonday = 1 - isoToday;
      offset = thisMonday + (isoTarget - 1) + (m[1].replace(/\s/g, '') === '이번주' ? 0 : 7);
    } else {
      offset = (target - todayWd + 7) % 7;
    }
    push(addDays(today, offset), m.index!, m.index! + m[0].length);
  }

  return out.sort((a, b) => a.start - b.start);
}

function formatLabels(day: KstDay, today: KstDay): { label: string; shortLabel: string } {
  const wd = WEEKDAYS[weekdayOf(day)];
  const sameYear = day.y === today.y;
  return {
    label: `${sameYear ? '' : `${day.y}년 `}${day.m}월 ${day.d}일 (${wd})`,
    shortLabel: sameYear ? `${day.m}/${day.d}` : `${String(day.y).slice(2)}/${day.m}/${day.d}`,
  };
}

export function detectDeadline(text: string | null | undefined, now: Date = new Date()): DetectedDeadline | null {
  if (!text || !text.trim()) return null;
  const today = kstToday(now);
  const candidates = collectCandidates(text, today);

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    c.keyword = keywordAfter(text, c.end) ?? keywordBefore(text, c.start);

    // "계약기간 2025-01-15 ~ 2027-01-14": the range end is the expiry date
    const prev = candidates[i - 1];
    if (!c.keyword && prev && /^\s*[~∼～-]\s*$/.test(text.slice(prev.end, c.start))) {
      const before = text.slice(Math.max(0, prev.start - 10), prev.start);
      if (RANGE_KEYWORDS.some((kw) => before.includes(kw))) c.keyword = '만료';
    }
  }

  const deadlines = candidates.filter((c) => c.keyword !== null);
  if (deadlines.length === 0) return null;

  // Prefer the earliest deadline that is not long past; otherwise the most recent past one.
  const todayMs = kstMidnight(today);
  const upcoming = deadlines
    .filter((c) => kstMidnight(c.day) >= todayMs - DAY_MS)
    .sort((a, b) => kstMidnight(a.day) - kstMidnight(b.day));
  const chosen =
    upcoming[0] ?? deadlines.sort((a, b) => kstMidnight(b.day) - kstMidnight(a.day))[0];

  const { label, shortLabel } = formatLabels(chosen.day, today);
  return {
    dueAt: new Date(kstMidnight(chosen.day) + 18 * 60 * 60 * 1000).toISOString(),
    label,
    shortLabel,
    daysFromToday: Math.round((kstMidnight(chosen.day) - todayMs) / DAY_MS),
    keyword: chosen.keyword as string,
  };
}

export function detectAmount(text: string | null | undefined): DetectedAmount | null {
  if (!text) return null;
  const found: Array<{ value: number; hasKeyword: boolean }> = [];

  for (const m of text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)\s*(만\s*)?원/g)) {
    const base = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(base) || base <= 0) continue;
    const value = m[2] ? base * 10_000 : base;
    if (value < 100) continue;
    const before = text.slice(Math.max(0, m.index! - 10), m.index!);
    found.push({ value, hasKeyword: AMOUNT_KEYWORDS.some((kw) => before.includes(kw)) });
  }
  if (found.length === 0) return null;

  const pool = found.some((f) => f.hasKeyword) ? found.filter((f) => f.hasKeyword) : found;
  const value = Math.max(...pool.map((f) => f.value));
  return { value, label: `${value.toLocaleString('ko-KR')}원` };
}

/** Human label for a due date relative to today: "오늘", "내일", "D-5", "3일 지남". */
export function relativeDueLabel(daysFromToday: number): string {
  if (daysFromToday === 0) return '오늘';
  if (daysFromToday === 1) return '내일';
  if (daysFromToday < 0) return `${Math.abs(daysFromToday)}일 지남`;
  return `D-${daysFromToday}`;
}
