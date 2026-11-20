'use client';

/**
 * apps/web/src/components/workspace-nav.tsx
 * Active-tab aware navigation links covering all 6 core workspace routes
 * with horizontal scroll guard for narrow mobile viewports.
 */
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/today', label: '오늘' },
  { href: '/inbox', label: '입력함' },
  { href: '/projects', label: '프로젝트' },
  { href: '/calendar', label: '일정' },
  { href: '/search', label: '검색' },
  { href: '/settings', label: '설정' },
] as const;

export function WorkspaceNav() {
  const pathname = usePathname();

  return (
    <nav
      className="flex items-center gap-0.5 overflow-x-auto whitespace-nowrap sm:gap-1"
      aria-label="주요 메뉴"
    >
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={`shrink-0 rounded-lg px-2 py-1.5 text-xs transition-colors sm:px-3 sm:text-sm ${
              isActive
                ? 'bg-blue-50 font-semibold text-blue-700'
                : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
