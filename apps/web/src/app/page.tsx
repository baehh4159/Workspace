/**
 * apps/web/src/app/page.tsx
 * Public landing page. Leads with the one workflow competitors don't do:
 * a paper document becomes a dated task in seconds.
 */
import React from 'react';
import Link from 'next/link';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import { DEMO_MODE } from '@/lib/demo/mock-supabase';
import { BRAND } from '@/lib/brand';
import { PLANS, PLAN_ORDER, formatKrw } from '@/lib/plans';
import { MarketingFooter, MarketingHeader } from '@/components/marketing-shell';

export const dynamic = 'force-dynamic';

const PAIN_POINTS = [
  {
    title: '고지서 사진만 찍어 두고 납부일을 놓친다',
    body: '갤러리와 카톡 "나와의 채팅"에 쌓인 사진은 다시 열어 보지 않습니다.',
  },
  {
    title: '연말정산 때 영수증을 찾느라 스크롤만 한다',
    body: '"그 영수증 어디 뒀지?" 파일 이름이 아니라 내용으로 찾아야 합니다.',
  },
  {
    title: '계약 만료일을 지나서야 알게 된다',
    body: '계약서는 서랍 속에, 만료일은 기억 속에만 있습니다.',
  },
];

const STEPS = [
  {
    no: '1',
    title: '찍거나 올리기',
    body: '스캐너 앱, 웹 업로드(PDF·사진), 한 줄 메모, 30초 음성. 무엇이든 입력함으로 모입니다.',
  },
  {
    no: '2',
    title: 'AI가 읽고 마감일 찾기',
    body: '본문을 읽어 요약하고, "11월 30일까지 납부" 같은 기한과 금액을 찾아 표시합니다.',
  },
  {
    no: '3',
    title: '2초 정리',
    body: '할 일로 / 프로젝트로 / 보관. 버튼 하나(또는 T·P·E 키)로 끝나고, 찾아낸 마감일은 할 일에 자동으로 붙습니다.',
  },
];

const USE_CASES = [
  { who: '개인', title: '공과금·카드 고지서', body: '납부기한이 붙은 할 일로. 오늘 화면에서 지난 일은 빨갛게 표시됩니다.' },
  { who: '개인', title: '연말정산 영수증', body: '의료비·기부금 영수증을 "연말정산" 프로젝트에 모아 두고 본문으로 검색합니다.' },
  { who: '개인', title: '임대차·보험 계약서', body: '만료일을 할 일로 걸어 두고, 원본은 필요할 때 바로 엽니다.' },
  { who: '팀', title: '거래처 견적서', body: '팀 입력함에 올리면 담당자가 바로 검토 할 일로 가져갑니다.' },
  { who: '팀', title: '계약 검토', body: '팀 프로젝트로 공유하되, 내 메모는 "나만 보기"로 분리됩니다.' },
  { who: '팀', title: '외부 협업', body: '로그인 없이 열리는 공유 링크로 보여 주고, 원하면 1클릭으로 팀에 합류시킵니다.' },
];

const FAQ = [
  {
    q: '정말 무료로 계속 쓸 수 있나요?',
    a: '네. 메모·할 일·일정·프로젝트는 무료 플랜에서도 무제한입니다. 원본을 오래 보관하거나 30일보다 오래된 서류를 검색할 때만 유료 플랜이 필요합니다.',
  },
  {
    q: '스캐너 앱이 꼭 있어야 하나요?',
    a: '아니요. 웹 입력함에 PDF나 사진을 끌어다 놓으면 됩니다. 스캐너 앱을 쓰면 스캔 직후 자동으로 입력함에 들어옵니다.',
  },
  {
    q: '팀원이 제 메모를 볼 수 있나요?',
    a: '모든 기록의 기본값은 "나만 보기"입니다. 팀에 보여 줄 항목만 골라서 공개합니다.',
  },
];

export default async function LandingPage() {
  const session = await getServerWorkspaceSession();
  const signedIn = Boolean(session);
  const primaryHref = signedIn ? '/today' : '/login?next=/today';
  const primaryLabel = signedIn ? (DEMO_MODE ? '데모 열어 보기' : '내 워크스페이스 열기') : '무료로 시작하기';

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <MarketingHeader signedIn={signedIn} demoMode={DEMO_MODE} />

      <main>
        {/* Hero */}
        <section className="border-b border-slate-100 bg-gradient-to-b from-blue-50/60 to-white">
          <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.1fr_1fr] md:py-20">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                고지서 · 영수증 · 계약서 · 견적서
              </p>
              <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
                {BRAND.tagline}
              </h1>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                찍어서 올리면 AI가 읽고 마감일과 금액을 찾아 줍니다. 사진첩과 &lsquo;나와의 채팅&rsquo;에 쌓아 두고
                잊어버리던 서류가, 기한이 붙은 할 일로 바뀝니다.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href={primaryHref}
                  className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-800"
                >
                  {primaryLabel}
                </Link>
                <Link
                  href="/pricing"
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  요금제 보기
                </Link>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                카드 등록 없이 시작 · 모든 기록은 기본값 &lsquo;나만 보기&rsquo; · 구글·카카오 계정으로 바로 가입
              </p>
            </div>

            {/* Product moment: document → detected deadline → task */}
            <div aria-hidden="true" className="relative">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/60">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-base">📄</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500">스캔 문서 · 방금 전</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">전기요금 고지서 11월</p>
                    <p className="mt-1 text-xs text-slate-600">AI 요약: 11월 전기요금 48,320원, 11/30까지 납부</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                        📅 11월 30일 마감
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                        💳 48,320원
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
                  <span className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white">
                    할 일로 · 11/30 마감
                  </span>
                  <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">프로젝트</span>
                  <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600">보관</span>
                </div>
              </div>
              <div className="ml-8 mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg shadow-slate-200/50">
                <p className="text-xs font-semibold text-slate-500">오늘 할 일</p>
                <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                  <span className="flex items-center gap-2 text-sm text-slate-900">
                    <span className="h-3.5 w-3.5 rounded border border-slate-300" />
                    전기요금 고지서 11월 납부
                  </span>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">D-3</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pain points */}
        <section className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">이런 적 있으시죠?</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {PAIN_POINTS.map((p) => (
              <div key={p.title} className="rounded-2xl border border-slate-200 bg-[#F7F8FA] p-5">
                <h3 className="text-sm font-semibold text-slate-900">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-slate-600">
            메모 앱은 적어 둘 뿐이고, 할 일 앱은 직접 입력해야 합니다. {BRAND.name}에서는 서류가 곧 할 일이 됩니다.
          </p>
        </section>

        {/* How it works */}
        <section id="how" className="scroll-mt-16 border-y border-slate-100 bg-[#F7F8FA]">
          <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
            <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">사용 방법은 세 단계뿐입니다</h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.no} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">
                    {s.no}
                  </span>
                  <h3 className="mt-3 text-sm font-semibold text-slate-900">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Use cases */}
        <section id="use-cases" className="mx-auto max-w-5xl scroll-mt-16 px-4 py-14 sm:px-6">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">혼자서도, 10명 이하 팀에서도</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {USE_CASES.map((u) => (
              <div key={u.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    u.who === '팀' ? 'bg-teal-50 text-teal-800' : 'bg-blue-50 text-blue-800'
                  }`}
                >
                  {u.who}
                </span>
                <h3 className="mt-2.5 text-sm font-semibold text-slate-900">{u.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{u.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="border-y border-slate-100 bg-[#F7F8FA]">
          <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">무료로 시작하세요</h2>
                <p className="mt-1.5 text-sm text-slate-600">서류가 쌓여 오래 보관하고 예전 것까지 찾아야 할 때 업그레이드하면 됩니다.</p>
              </div>
              <Link href="/pricing" className="text-sm font-semibold text-blue-700 hover:underline">
                요금제 자세히 보기 →
              </Link>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {PLAN_ORDER.map((id) => {
                const plan = PLANS[id];
                return (
                  <div
                    key={id}
                    className={`rounded-2xl border bg-white p-5 ${plan.highlight ? 'border-blue-600' : 'border-slate-200'}`}
                  >
                    <p className="text-sm font-bold text-slate-900">{plan.name}</p>
                    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                      {plan.priceYearlyPerMonth === 0 ? '₩0' : formatKrw(plan.priceYearlyPerMonth)}
                      {plan.priceYearlyPerMonth > 0 && (
                        <span className="ml-1 text-xs font-medium text-slate-500">
                          / {plan.perSeat ? '인·월' : '월'} (연간)
                        </span>
                      )}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">{plan.tagline}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">자주 묻는 질문</h2>
          <div className="mt-6 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
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

        {/* Final CTA */}
        <section className="bg-slate-900">
          <div className="mx-auto flex max-w-5xl flex-col items-start gap-5 px-4 py-14 sm:px-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                오늘 받은 고지서 한 장으로 시작해 보세요
              </h2>
              <p className="mt-1.5 text-sm text-slate-300">가입은 구글·카카오 계정으로 바로 끝납니다.</p>
            </div>
            <Link
              href={primaryHref}
              className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100"
            >
              {primaryLabel}
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  );
}
