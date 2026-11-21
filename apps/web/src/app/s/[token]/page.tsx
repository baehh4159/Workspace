/**
 * apps/web/src/app/s/[token]/page.tsx
 * SSR Guest Share Page: resolves whitelist payload directly on the server (zero loading flicker)
 * and renders SharedGuestView without ever exposing private records.
 */
import React from 'react';
import type { Metadata } from 'next';
import { resolveGuestShareByToken } from '@/lib/guest-share';
import { SharedGuestView } from '@/components/shared-guest-view';

export const dynamic = 'force-dynamic';

// Shared documents must never be indexed, and the token in the URL must not leak via Referer
// when the guest opens the original file or any outbound link.
export const metadata: Metadata = {
  title: '공유된 문서',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default async function GuestSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveGuestShareByToken(token);

  if (!resolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-4">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-slate-900">
            공유 링크가 만료되었거나 회수되었습니다.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            공유한 담당자에게 새 링크를 요청해 주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <SharedGuestView
      shareToken={token}
      data={resolved.payload}
      canJoinTeam={resolved.scope === 'view_and_join' && resolved.workspaceType === 'team'}
    />
  );
}
