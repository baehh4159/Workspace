/**
 * apps/web/src/app/login/page.tsx
 * 1-click Google & Kakao OAuth login page with brand symbols, safe open-redirect guard, and auto-redirect.
 */
import React from 'react';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_init_failed: '로그인 페이지로 이동하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  oauth_failed: '소셜 로그인 인증에 실패했습니다. 다시 시도해 주세요.',
  missing_code: '인증 코드가 누락되었습니다. 다시 로그인해 주세요.',
  invalid_provider: '지원하지 않는 로그인 방식입니다.',
};

function sanitizeNextPath(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/today';
  }
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = sanitizeNextPath(next);

  const session = await getServerWorkspaceSession();
  if (session) {
    redirect(safeNext);
  }

  const errorMessage = error ? ERROR_MESSAGES[error] ?? '로그인 중 오류가 발생했습니다.' : null;
  const encodedNext = encodeURIComponent(safeNext);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-4 py-12 text-slate-900">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="space-y-1.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            Workspace
          </p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            스캔부터 실행까지 한 곳에서
          </h1>
          <p className="text-xs leading-relaxed text-slate-500">
            가입 즉시 개인 워크스페이스가 자동 생성됩니다.
            <br />
            모든 문서와 메모는 기본값으로 <strong className="font-medium text-slate-700">나만 보기</strong>로 저장됩니다.
          </p>
        </div>

        {errorMessage && (
          <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 space-y-2.5">
          <a
            href={`/api/auth/oauth?provider=google&next=${encodedNext}`}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.18v2.98h5.27c-.23 1.24-.92 2.29-1.96 3v2.49h3.17c1.86-1.71 2.93-4.23 2.93-7.21 0-.42-.04-.84-.11-1.26z"
              />
              <path
                fill="currentColor"
                d="M12.17 22c2.65 0 4.88-.88 6.51-2.38l-3.17-2.49c-.88.59-2 .94-3.34.94-2.57 0-4.74-1.73-5.52-4.07H3.38v2.57A9.83 9.83 0 0 0 12.17 22z"
              />
              <path
                fill="currentColor"
                d="M6.65 14a5.9 5.9 0 0 1 0-3.99V7.44H3.38a9.84 9.84 0 0 0 0 9.12L6.65 14z"
              />
              <path
                fill="currentColor"
                d="M12.17 5.93c1.44 0 2.74.5 3.76 1.47l2.82-2.82C17.04 2.98 14.82 2 12.17 2a9.83 9.83 0 0 0-8.79 5.44l3.27 2.57c.78-2.34 2.95-4.08 5.52-4.08z"
              />
            </svg>
            Google로 계속하기
          </a>
          <a
            href={`/api/auth/oauth?provider=kakao&next=${encodedNext}`}
            className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-[#FEE500] px-4 py-2.5 text-sm font-semibold text-slate-900 transition-all hover:brightness-95"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
              <path
                fill="#191919"
                d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.84 5.31 4.61 6.72l-.95 3.52c-.08.3.25.54.51.37l4.17-2.75c.54.08 1.1.14 1.66.14 5.52 0 10-3.58 10-8s-4.48-8-10-8z"
              />
            </svg>
            카카오로 계속하기
          </a>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-slate-400">
          팀 공유 링크로 초대받으셨다면 공유받은 링크에서 바로 합류하실 수도 있습니다.
        </p>
      </div>
    </div>
  );
}
