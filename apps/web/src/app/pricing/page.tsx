/**
 * apps/web/src/app/pricing/page.tsx
 * Public pricing page. Works signed-out (CTAs go to login) and signed-in (CTAs upgrade the
 * active workspace). `?from=` tells which paywall sent the user here and is stored with the request.
 */
import React from 'react';
import type { Metadata } from 'next';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { DEMO_MODE } from '@/lib/demo/mock-supabase';
import { BRAND } from '@/lib/brand';
import { PLANS, PLAN_ORDER, type PlanLimits } from '@/lib/plans';
import { FREE_TEAM_MAX_SEATS } from '@/lib/billing';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-shell';
import { PricingPlans, type PricingCurrentWorkspace } from '@/components/pricing-plans';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `요금제 — ${BRAND.name}`,
  description: '무료로 시작하고, 서류가 쌓이면 프로·팀 플랜으로 원본 영구 보관과 전체 기간 검색을 쓰세요.',
};

const SOURCE_CONTEXT: Record<string, string> = {
  search: '30일보다 오래된 서류까지 찾으려면 프로 또는 팀 플랜이 필요합니다.',
  expiry: '원본 파일을 자동 삭제 없이 계속 보관하려면 프로 또는 팀 플랜이 필요합니다.',
  ai_quota: `이번 달 무료 AI 한도를 모두 썼습니다. 월 AI 문서 읽기가 프로는 ${PLANS.pro.limits.aiOcrPages}쪽, 팀은 ${PLANS.team.limits.aiOcrPages.toLocaleString('ko-KR')}쪽으로 늘어납니다.`,
  storage: '무료 저장 용량(500MB)이 거의 찼습니다. 유료 플랜은 500MB 제한이 없습니다.',
  tax: '연말정산 때 낼 영수증 원본은 1년 내내 보관해야 합니다. 무료 플랜은 원본을 30일 뒤 정리하지만, 프로·팀 플랜은 지우지 않습니다.',
  team_seats: `무료 팀 워크스페이스는 ${FREE_TEAM_MAX_SEATS}명까지입니다. 팀 플랜은 최대 10명까지 함께 쓸 수 있습니다.`,
};

function formatRetention(days: number | null): string {
  return days === null ? '영구 보관' : `${days}일`;
}

function formatSearch(days: number | null): string {
  return days === null ? '전체 기간' : `최근 ${days}일`;
}

function formatStorage(bytes: number | null): string {
  return bytes === null ? '제한 없음' : `${Math.round(bytes / (1024 * 1024))}MB`;
}

const COMPARISON_ROWS: Array<{ label: string; value: (l: PlanLimits, planId: string) => string }> = [
  { label: '원본 파일 보관', value: (l) => formatRetention(l.originalRetentionDays) },
  { label: '본문 검색 범위', value: (l) => formatSearch(l.searchHistoryDays) },
  { label: 'AI 문서 읽기 (월)', value: (l) => `${l.aiOcrPages.toLocaleString('ko-KR')}쪽` },
  { label: '음성 받아쓰기 (월)', value: (l) => `${Math.round(l.aiSttSeconds / 60).toLocaleString('ko-KR')}분` },
  { label: '저장 용량', value: (l) => formatStorage(l.storageBytes) },
  {
    label: '함께 쓰는 인원',
    value: (l, planId) =>
      planId === 'free' ? `개인 1명 · 팀 ${FREE_TEAM_MAX_SEATS}명` : planId === 'team' ? `최대 ${l.maxSeats}명` : '1명',
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: '무료 플랜에서 30일이 지나면 서류가 사라지나요?',
    a: 'PDF·사진·음성 같은 원본 파일만 정리됩니다. AI가 읽어 둔 본문·요약과 만들어 둔 할 일은 그대로 남습니다. 만료 7일 전부터 입력함에 표시되고, 그때 원본을 내려받을 수 있습니다.',
  },
  {
    q: '개인 워크스페이스와 팀 워크스페이스는 따로 결제하나요?',
    a: '네. 개인 워크스페이스는 프로 플랜, 팀 워크스페이스는 팀 플랜을 씁니다. 팀에 합류하거나 팀을 떠나도 개인 워크스페이스와 그 안의 기록은 그대로 유지됩니다.',
  },
  {
    q: '팀 플랜 요금은 어떻게 계산되나요?',
    a: `팀 워크스페이스에 참여한 인원 수 × 인당 요금입니다. 무료 팀 워크스페이스는 ${FREE_TEAM_MAX_SEATS}명까지 함께 쓸 수 있습니다.`,
  },
  {
    q: '연말정산 서류함은 무료로 쓸 수 있나요?',
    a: '네. 영수증 자동 분류, 분류별 합계, 엑셀(CSV) 내려받기는 무료입니다. 다만 무료 플랜은 원본 파일을 30일 뒤 정리하므로, 1년 동안 모은 영수증 원본을 연말정산 때 내야 한다면 프로 플랜이 필요합니다.',
  },
  {
    q: '팀원이 제 개인 메모를 볼 수 있나요?',
    a: '아니요. 모든 기록의 기본값은 "나만 보기"입니다. 팀 프로젝트 안에서도 기록마다 공개 여부를 따로 정할 수 있습니다.',
  },
];

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const source = from && /^[a-z_]{1,40}$/.test(from) ? from : 'pricing';
  const contextMessage =
    from && Object.prototype.hasOwnProperty.call(SOURCE_CONTEXT, from) ? SOURCE_CONTEXT[from] : undefined;

  // Public page: render as signed-out if the auth backend is unreachable.
  const session = await getServerWorkspaceSession().catch(() => null);
  const current: PricingCurrentWorkspace | null = session
    ? {
        workspaceId: session.activeWorkspace.id,
        workspaceName: session.activeWorkspace.name,
        workspaceType: session.activeWorkspace.type,
        plan: session.activeWorkspace.plan,
        role: session.activeWorkspace.role,
      }
    : null;

  const plans = PLAN_ORDER.map((id) => PLANS[id]);

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-slate-900">
      <MarketingHeader signedIn={Boolean(session)} demoMode={DEMO_MODE} />

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">요금제</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            무료로 시작하고, 서류가 쌓이면 업그레이드하세요
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            모든 플랜에서 메모·할 일·일정·프로젝트는 무제한입니다. 원본을 오래 보관하고 예전 서류까지
            찾아야 할 때 유료 플랜이 필요합니다.
          </p>
          {contextMessage && (
            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {contextMessage}
            </p>
          )}
        </div>

        <div className="mt-10">
          <PricingPlans plans={plans} current={current} demoMode={DEMO_MODE} source={source} />
        </div>

        <section className="mt-16" aria-labelledby="compare-title">
          <h2 id="compare-title" className="text-lg font-bold text-slate-900">
            플랜 비교
          </h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    항목
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className="px-4 py-3 font-semibold text-slate-800">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="px-4 py-3 font-medium text-slate-600">
                      {row.label}
                    </th>
                    {plans.map((p) => (
                      <td key={p.id} className="px-4 py-3 text-slate-900">
                        {row.value(p.limits, p.id)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">표시 가격은 부가세 포함 금액입니다.</p>
        </section>

        <section className="mt-16" aria-labelledby="faq-title">
          <h2 id="faq-title" className="text-lg font-bold text-slate-900">
            자주 묻는 질문
          </h2>
          <div className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {FAQ.map((item) => (
              <details key={item.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-900">
                  {item.q}
                  <span className="text-slate-400 transition-transform group-open:rotate-45" aria-hidden="true">
                    +
                  </span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
