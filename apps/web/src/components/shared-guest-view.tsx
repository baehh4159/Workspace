'use client';

/**
 * apps/web/src/components/shared-guest-view.tsx
 * Client view for SSR-hydrated Guest Share page:
 *  - Shows inline image preview when signedFileUrl is a scanned image (jpg/png/webp/heic)
 *  - Respects share scope (hides 1-click team join CTA on read_only links)
 *  - Passes shareToken into Google/Kakao 1-click OAuth
 *  - Modal closes on backdrop click and Escape key with aria-modal semantics
 */
import React, { useEffect, useState } from 'react';
import type { ResolvedGuestShare } from '@/lib/guest-share';
import { BRAND } from '@/lib/brand';

function isImageSignedUrl(url: string | null): boolean {
  if (!url) return false;
  const pathOnly = url.split('?')[0]?.toLowerCase() ?? '';
  return /\.(jpe?g|png|webp|heic)$/.test(pathOnly);
}

export function SharedGuestView({
  shareToken,
  data,
  canJoinTeam,
}: {
  shareToken: string;
  data: ResolvedGuestShare['payload'];
  canJoinTeam: boolean;
}) {
  const [showJoinSheet, setShowJoinSheet] = useState(false);

  useEffect(() => {
    if (!showJoinSheet) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowJoinSheet(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showJoinSheet]);

  const encodedToken = encodeURIComponent(shareToken);
  const showInlineImage = isImageSignedUrl(data.signedFileUrl);

  return (
    <div className="min-h-screen bg-[#F7F8FA] px-4 pb-28 pt-8 text-slate-900 sm:px-6">
      <article className="mx-auto max-w-2xl space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>공유된 항목</span>
            <span>
              만료일: {new Date(data.expiresAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
            </span>
          </div>

          <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900">{data.title}</h1>

          {data.summaryText && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
              {data.summaryText}
            </p>
          )}

          {showInlineImage && data.signedFileUrl && (
            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-[#F7F8FA]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.signedFileUrl}
                alt={data.title}
                className="max-h-96 w-full object-contain"
              />
            </div>
          )}

          {data.signedFileUrl && (
            <div className="mt-4">
              <a
                href={data.signedFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-[#F7F8FA] px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100"
              >
                원본 스캔 문서 열기 (임시 보안 링크)
              </a>
            </div>
          )}
        </div>

        {data.publicChecklist.length > 0 && (
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">함께 확인할 체크리스트</h2>
            <ul className="space-y-2.5">
              {data.publicChecklist.map((task) => (
                <li key={task.id} className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={!canJoinTeam}
                    onClick={() => {
                      if (canJoinTeam) setShowJoinSheet(true);
                    }}
                    className="flex items-center gap-3 text-left disabled:cursor-default"
                  >
                    <span
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        task.status === 'done'
                          ? 'border-blue-700 bg-blue-700 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {task.status === 'done' ? '✓' : ''}
                    </span>
                    <span
                      className={`text-sm ${
                        task.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'
                      }`}
                    >
                      {task.title}
                    </span>
                  </button>
                  {task.dueAt && (
                    <span className="shrink-0 text-xs text-slate-400">
                      {new Date(task.dueAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-center text-xs text-slate-500">
          작성자의 개인 메모는 공유되지 않습니다 · 만료일 이후 링크는 자동 비활성화됩니다.
        </p>
      </article>

      {canJoinTeam && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <span className="text-xs text-slate-600">로그인 없이 열람 중 · 체크나 댓글을 남기려면</span>
            <button
              type="button"
              onClick={() => setShowJoinSheet(true)}
              className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              {data.publicChecklist.length > 0 ? '완료 체크하고 팀에서 함께 보기' : '팀에 합류해서 함께 보기'}
            </button>
          </div>
        </div>
      )}

      {!canJoinTeam && (
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <span className="text-xs text-slate-600">
              {BRAND.name}로 공유된 페이지 · {BRAND.tagline}
            </span>
            <a
              href="/"
              className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              나도 무료로 써 보기
            </a>
          </div>
        </div>
      )}

      {canJoinTeam && showJoinSheet && (
        <div
          onClick={() => setShowJoinSheet(false)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="guest-join-title"
            className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
          >
            <h3 id="guest-join-title" className="text-base font-bold text-slate-900">
              1클릭으로 팀에서 함께 보기
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              가입 즉시 이 문서의 체크리스트를 함께 완료하고 팀 워크스페이스에 합류할 수 있습니다.
            </p>
            <div className="mt-4 space-y-2">
              <a
                href={`/api/auth/oauth?provider=google&shareToken=${encodedToken}`}
                className="block w-full rounded-lg bg-blue-700 px-4 py-2.5 text-center text-xs font-semibold text-white hover:bg-blue-800"
              >
                Google로 1클릭 계속하기
              </a>
              <a
                href={`/api/auth/oauth?provider=kakao&shareToken=${encodedToken}`}
                className="block w-full rounded-lg bg-[#FEE500] px-4 py-2.5 text-center text-xs font-semibold text-slate-900 hover:brightness-95"
              >
                카카오로 1클릭 계속하기
              </a>
            </div>
            <button
              type="button"
              onClick={() => setShowJoinSheet(false)}
              className="mt-3 w-full py-1.5 text-xs text-slate-500 hover:text-slate-700"
            >
              그냥 문서만 계속 볼게요
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
