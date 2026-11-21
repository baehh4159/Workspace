'use client';

/**
 * apps/web/src/components/onboarding-checklist.tsx
 * "시작하기" card on Today: walks a new user to the moment the product clicks
 * (a paper document becomes a task with a due date). Hidden when every step is done
 * or when the user dismisses it (remembered in localStorage).
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export interface OnboardingState {
  memo: boolean;
  upload: boolean;
  docToTask: boolean;
  invite: boolean;
}

const DISMISS_KEY = 'ws_onboarding_dismissed_v1';

const STEPS: Array<{
  key: keyof OnboardingState;
  title: string;
  body: string;
  cta: string;
  href: string;
}> = [
  {
    key: 'memo',
    title: '한 줄 메모 남기기',
    body: '떠오른 일을 바로 적어 두세요. AI 없이 즉시 저장됩니다.',
    cta: '메모 쓰기',
    href: '#quick-capture-input',
  },
  {
    key: 'upload',
    title: '서류 한 장 올리기',
    body: '고지서·영수증·계약서 PDF나 사진을 입력함에 끌어다 놓으세요.',
    cta: '입력함 열기',
    href: '/inbox',
  },
  {
    key: 'docToTask',
    title: '서류를 마감일 있는 할 일로',
    body: '입력함 카드의 "할 일로"를 누르면 찾아낸 마감일이 함께 저장됩니다.',
    cta: '입력함에서 해 보기',
    href: '/inbox',
  },
  {
    key: 'invite',
    title: '함께 쓸 사람 초대하기',
    body: '가족·동료와 팀을 만들거나 공유 링크를 보내세요. 내 메모는 계속 나만 봅니다.',
    cta: '팀 만들기',
    href: '/settings#create-team',
  },
];

export function OnboardingChecklist({ state }: { state: OnboardingState }) {
  // Start hidden so users who dismissed it never see a flash before localStorage is read.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const doneCount = STEPS.filter((s) => state[s.key]).length;
  if (dismissed || doneCount === STEPS.length) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Private mode: hide for this visit only
    }
  };

  const focusMemo = (e: React.MouseEvent) => {
    const input = document.getElementById('quick-capture-input');
    if (input) {
      e.preventDefault();
      input.focus();
      input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  return (
    <section aria-labelledby="onboarding-title" className="rounded-xl border border-blue-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="onboarding-title" className="text-sm font-semibold text-slate-900">
            시작하기 · {doneCount}/{STEPS.length}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">네 가지만 해 보면 서류를 놓치지 않는 흐름이 만들어집니다.</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-xs text-slate-400 hover:text-slate-600"
          aria-label="시작하기 안내 닫기"
        >
          닫기
        </button>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label="시작하기 진행률"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={doneCount}
      >
        <div className="h-full rounded-full bg-blue-700" style={{ width: `${(doneCount / STEPS.length) * 100}%` }} />
      </div>

      <ol className="mt-3 space-y-2">
        {STEPS.map((step, i) => {
          const done = state[step.key];
          return (
            <li key={step.key} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  done ? 'bg-blue-700 text-white' : 'border border-slate-300 text-slate-500'
                }`}
              >
                {done ? '✓' : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                  {step.title}
                  <span className="sr-only">{done ? ' (완료)' : ' (아직 안 함)'}</span>
                </p>
                {!done && <p className="mt-0.5 text-xs text-slate-500">{step.body}</p>}
              </div>
              {!done && (
                <Link
                  href={step.href}
                  onClick={step.key === 'memo' ? focusMemo : undefined}
                  className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                >
                  {step.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
