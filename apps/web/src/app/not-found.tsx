/**
 * apps/web/src/app/not-found.tsx
 * Korean 404 page.
 */
import React from 'react';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F7F8FA] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">{BRAND.name}</p>
        <h1 className="mt-2 text-lg font-bold text-slate-900">페이지를 찾을 수 없습니다</h1>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          주소가 바뀌었거나 삭제된 페이지입니다. 공유 링크라면 보낸 사람에게 새 링크를 요청해 주세요.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/today" className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800">
            오늘 화면으로
          </Link>
          <Link href="/" className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            소개 페이지
          </Link>
        </div>
      </div>
    </div>
  );
}
