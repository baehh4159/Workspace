/**
 * apps/web/src/lib/plans.ts
 * Single source of truth for plans, prices and limits shown in the pricing page,
 * settings page and upgrade prompts.
 *
 * NOTE: Prices are SUGGESTED starting points (KRW, VAT included) — change them here.
 * Limits must stay in sync with supabase/migrations (free 500 MB cap, 30-day retention)
 * and with the AI quota rows created per workspace/month.
 */

export type PlanId = 'free' | 'pro' | 'team';
export type PaidPlanId = Exclude<PlanId, 'free'>;
export type BillingCycle = 'monthly' | 'yearly';

export interface PlanLimits {
  /** Days original files are kept. null = kept until the user deletes them. */
  originalRetentionDays: number | null;
  /** Days of history covered by full-text search. null = all time. */
  searchHistoryDays: number | null;
  /** Storage cap in bytes. null = no fixed cap. */
  storageBytes: number | null;
  /** Monthly AI quotas (shared by the whole workspace). */
  aiOcrPages: number;
  aiSttSeconds: number;
  aiTextClassify: number;
  maxSeats: number;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  /** KRW per month when billed monthly (per seat for team). */
  priceMonthly: number;
  /** KRW per month when billed yearly (per seat for team). */
  priceYearlyPerMonth: number;
  perSeat: boolean;
  /** Which workspace type can use the plan. */
  workspaceType: 'personal' | 'team' | 'any';
  highlight: boolean;
  features: string[];
  limits: PlanLimits;
}

const MB = 1024 * 1024;

/**
 * Seats for a team workspace that is still on the free plan.
 * Teams created before this limit existed keep their previous seat count (grandfathered).
 * Set to 10 to restore the old "10 seats for free" behaviour.
 */
export const FREE_TEAM_MAX_SEATS = 3;

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: '무료',
    tagline: '서류 정리 습관을 만드는 단계',
    priceMonthly: 0,
    priceYearlyPerMonth: 0,
    perSeat: false,
    workspaceType: 'any',
    highlight: false,
    features: [
      '메모·할 일·일정·프로젝트 무제한',
      '마감일·금액 자동 감지 → 할 일',
      '원본 파일 30일 보관 (본문·요약은 계속 유지)',
      '최근 30일 본문 검색',
      '월 AI 문서 읽기 30쪽 · 음성 받아쓰기 15분',
      '저장 용량 500MB',
    ],
    limits: {
      originalRetentionDays: 30,
      searchHistoryDays: 30,
      storageBytes: 500 * MB,
      aiOcrPages: 30,
      aiSttSeconds: 15 * 60,
      aiTextClassify: 100,
      maxSeats: 1,
    },
  },
  pro: {
    id: 'pro',
    name: '프로',
    tagline: '서류를 잃어버리지 않는 개인용',
    priceMonthly: 6900,
    priceYearlyPerMonth: 5900,
    perSeat: false,
    workspaceType: 'personal',
    highlight: true,
    features: [
      '무료 플랜의 모든 기능',
      '원본 파일 영구 보관 (자동 삭제 없음) — 연말정산 영수증도 1년 내내',
      '전체 기간 본문 검색',
      '월 AI 문서 읽기 500쪽 · 음성 받아쓰기 300분',
      '저장 용량 500MB 제한 해제',
    ],
    limits: {
      originalRetentionDays: null,
      searchHistoryDays: null,
      storageBytes: null,
      aiOcrPages: 500,
      aiSttSeconds: 300 * 60,
      aiTextClassify: 2000,
      maxSeats: 1,
    },
  },
  team: {
    id: 'team',
    name: '팀',
    tagline: '10명 이하 팀의 서류·할 일 공유',
    priceMonthly: 8900,
    priceYearlyPerMonth: 7900,
    perSeat: true,
    workspaceType: 'team',
    highlight: false,
    features: [
      '프로 플랜의 모든 기능',
      '팀원 최대 10명 · 팀 공유 프로젝트',
      '할 일·일정 팀 공유, 기록은 개인별 비공개 유지',
      '공유 링크로 로그인 없이 열람 → 1클릭 팀 합류',
      '월 AI 문서 읽기 1,500쪽 · 음성 받아쓰기 900분 (팀 공용)',
    ],
    limits: {
      originalRetentionDays: null,
      searchHistoryDays: null,
      storageBytes: null,
      aiOcrPages: 1500,
      aiSttSeconds: 900 * 60,
      aiTextClassify: 5000,
      maxSeats: 10,
    },
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'pro', 'team'];

/** Yearly billing saves this many percent vs. paying monthly (rounded down). */
export function yearlySavingsPercent(plan: PlanDefinition): number {
  if (plan.priceMonthly <= 0) return 0;
  return Math.floor(((plan.priceMonthly - plan.priceYearlyPerMonth) / plan.priceMonthly) * 100);
}

export function formatKrw(amount: number): string {
  return `₩${amount.toLocaleString('ko-KR')}`;
}

export function planName(id: PlanId): string {
  return PLANS[id]?.name ?? id;
}

/** Monthly AI quota limit per usage type for a plan (units: pages / seconds / calls). */
export function aiQuotaLimit(
  plan: PlanId,
  usageType: 'doc_ocr_pages' | 'voice_stt_seconds' | 'text_classify'
): number {
  const limits = PLANS[plan].limits;
  if (usageType === 'doc_ocr_pages') return limits.aiOcrPages;
  if (usageType === 'voice_stt_seconds') return limits.aiSttSeconds;
  return limits.aiTextClassify;
}

/** Builds a pricing-page link that records where the upgrade intent came from. */
export function pricingHref(from: string): string {
  return `/pricing?from=${encodeURIComponent(from)}`;
}
