'use client';

/**
 * apps/web/src/components/pricing-plans.tsx
 * Plan cards with monthly/yearly toggle. Every upgrade CTA posts to /api/billing/checkout.
 *  - Demo mode: the plan is applied immediately (simulated payment).
 *  - Real mode before a payment provider exists: the request is recorded as a pre-registration.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  formatKrw,
  yearlySavingsPercent,
  type BillingCycle,
  type PlanDefinition,
  type PlanId,
} from '@/lib/plans';

export interface PricingCurrentWorkspace {
  workspaceId: string;
  workspaceName: string;
  workspaceType: 'personal' | 'team';
  plan: PlanId;
  role: 'owner' | 'member';
}

type Cta =
  | { kind: 'current'; label: string }
  | { kind: 'disabled'; label: string; hint?: string }
  | { kind: 'link'; label: string; href: string }
  | { kind: 'checkout'; label: string; plan: PlanId };

function resolveCta(plan: PlanDefinition, current: PricingCurrentWorkspace | null, demoMode: boolean): Cta {
  if (!current) {
    return plan.id === 'free'
      ? { kind: 'link', label: '무료로 시작하기', href: '/login?next=/today' }
      : { kind: 'link', label: `${plan.name} 시작하기`, href: '/login?next=/pricing' };
  }

  if (current.plan === plan.id) return { kind: 'current', label: '현재 플랜' };

  if (plan.id === 'free') {
    return demoMode && current.role === 'owner'
      ? { kind: 'checkout', label: '무료로 되돌리기 (데모)', plan: 'free' }
      : { kind: 'disabled', label: '기본 플랜' };
  }

  if (plan.workspaceType === 'team' && current.workspaceType === 'personal') {
    return { kind: 'link', label: '팀 워크스페이스 만들기', href: '/settings#create-team' };
  }
  if (plan.workspaceType === 'personal' && current.workspaceType === 'team') {
    return { kind: 'disabled', label: '개인 워크스페이스용', hint: '개인 워크스페이스로 전환하면 선택할 수 있어요.' };
  }
  if (current.role !== 'owner') {
    return { kind: 'disabled', label: '소유자만 변경 가능', hint: '워크스페이스 소유자에게 업그레이드를 요청하세요.' };
  }
  return { kind: 'checkout', label: `${plan.name}로 업그레이드`, plan: plan.id };
}

export function PricingPlans({
  plans,
  current,
  demoMode,
  source,
}: {
  plans: PlanDefinition[];
  current: PricingCurrentWorkspace | null;
  demoMode: boolean;
  source: string;
}) {
  const router = useRouter();
  const [cycle, setCycle] = useState<BillingCycle>('yearly');
  const [pendingPlan, setPendingPlan] = useState<PlanId | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'info'; text: string; showLinks: boolean } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const maxSavings = Math.max(...plans.map((p) => yearlySavingsPercent(p)));

  const handleCheckout = async (plan: PlanId) => {
    if (!current || pendingPlan) return;
    setPendingPlan(plan);
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: current.workspaceId, plan, cycle, source }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (!res.ok && res.status !== 202) {
        setErrorMsg(
          data.error === 'OWNER_ONLY'
            ? '워크스페이스 소유자만 플랜을 바꿀 수 있습니다.'
            : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        );
        return;
      }
      const planLabel = plans.find((p) => p.id === plan)?.name ?? plan;
      if (data.status === 'activated') {
        setNotice({
          tone: 'success',
          text:
            plan === 'free'
              ? '데모: 무료 플랜으로 되돌렸습니다.'
              : `데모: ${planLabel} 플랜이 바로 적용됐습니다. 실제 서비스에서는 이 자리에서 결제가 진행됩니다.`,
          showLinks: plan !== 'free',
        });
      } else if (data.status === 'waitlisted') {
        setNotice({
          tone: 'info',
          text: `${planLabel} 플랜 신청이 접수됐습니다. 결제가 열리면 가장 먼저 안내해 드릴게요. 그때까지 지금처럼 무료로 쓰실 수 있습니다.`,
          showLinks: false,
        });
      }
      router.refresh();
    } catch {
      setErrorMsg('네트워크 오류로 요청하지 못했습니다.');
    } finally {
      setPendingPlan(null);
    }
  };

  return (
    <div>
      <div className="flex flex-col items-center gap-2">
        <div
          role="radiogroup"
          aria-label="결제 주기"
          className="inline-flex rounded-full border border-slate-200 bg-white p-1 text-sm"
        >
          {(['monthly', 'yearly'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={`rounded-full px-4 py-1.5 font-medium transition-colors ${
                cycle === c ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {c === 'monthly' ? '월간 결제' : '연간 결제'}
            </button>
          ))}
        </div>
        {maxSavings > 0 && (
          <p className="text-xs font-medium text-blue-700">연간 결제 시 최대 {maxSavings}% 할인</p>
        )}
      </div>

      {current && (
        <p className="mt-4 text-center text-xs text-slate-500">
          현재 워크스페이스: <strong className="font-semibold text-slate-700">{current.workspaceName}</strong> (
          {current.workspaceType === 'team' ? '팀' : '개인'}) ·{' '}
          {plans.find((p) => p.id === current.plan)?.name ?? current.plan} 플랜
        </p>
      )}

      {notice && (
        <div
          role="status"
          className={`mx-auto mt-5 max-w-2xl rounded-xl border px-4 py-3 text-sm ${
            notice.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-blue-200 bg-blue-50 text-blue-900'
          }`}
        >
          <p>{notice.text}</p>
          {notice.showLinks && (
            <p className="mt-1.5 flex flex-wrap gap-3 text-xs font-semibold">
              <Link href="/search" className="underline underline-offset-2">
                전체 기간 검색 써 보기 →
              </Link>
              <Link href="/settings" className="underline underline-offset-2">
                늘어난 한도 확인 →
              </Link>
            </p>
          )}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="mx-auto mt-5 max-w-2xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {errorMsg}
        </div>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const cta = resolveCta(plan, current, demoMode);
          const price = cycle === 'yearly' ? plan.priceYearlyPerMonth : plan.priceMonthly;
          const savings = yearlySavingsPercent(plan);
          return (
            <section
              key={plan.id}
              aria-labelledby={`plan-${plan.id}`}
              className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
                plan.highlight ? 'border-blue-600 shadow-lg shadow-blue-100' : 'border-slate-200'
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-6 rounded-full bg-blue-700 px-3 py-0.5 text-xs font-semibold text-white">
                  가장 많이 선택
                </span>
              )}
              <h2 id={`plan-${plan.id}`} className="text-base font-bold text-slate-900">
                {plan.name}
              </h2>
              <p className="mt-1 text-xs text-slate-500">{plan.tagline}</p>

              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight text-slate-900">
                  {price === 0 ? '₩0' : formatKrw(price)}
                </span>
                {price > 0 && (
                  <span className="text-sm text-slate-500">/ {plan.perSeat ? '인·월' : '월'}</span>
                )}
              </div>
              <p className="mt-1 h-4 text-xs text-slate-500">
                {price === 0
                  ? '카드 등록 없이 계속 무료'
                  : cycle === 'yearly'
                    ? `연 ${formatKrw(price * 12)}${plan.perSeat ? ' (1인 기준)' : ''} · ${savings}% 할인`
                    : `연간 결제 시 월 ${formatKrw(plan.priceYearlyPerMonth)}`}
              </p>

              <div className="mt-5">
                {cta.kind === 'link' && (
                  <Link
                    href={cta.href}
                    className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${
                      plan.highlight
                        ? 'bg-blue-700 text-white hover:bg-blue-800'
                        : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {cta.label}
                  </Link>
                )}
                {cta.kind === 'checkout' && (
                  <button
                    type="button"
                    disabled={pendingPlan !== null}
                    onClick={() => void handleCheckout(cta.plan)}
                    className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60 ${
                      plan.highlight || plan.id === 'team'
                        ? 'bg-blue-700 text-white hover:bg-blue-800'
                        : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {pendingPlan === cta.plan ? '처리 중...' : cta.label}
                  </button>
                )}
                {(cta.kind === 'current' || cta.kind === 'disabled') && (
                  <div>
                    <span
                      className={`block w-full rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${
                        cta.kind === 'current'
                          ? 'bg-slate-100 text-slate-700'
                          : 'border border-dashed border-slate-200 text-slate-400'
                      }`}
                    >
                      {cta.label}
                    </span>
                    {cta.kind === 'disabled' && cta.hint && (
                      <p className="mt-1.5 text-center text-[11px] text-slate-400">{cta.hint}</p>
                    )}
                  </div>
                )}
              </div>

              <ul className="mt-6 space-y-2.5 text-sm text-slate-700">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-blue-700"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="m3.5 8.5 3 3 6-7"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
