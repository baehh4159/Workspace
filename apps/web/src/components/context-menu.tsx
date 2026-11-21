'use client';

/**
 * apps/web/src/components/context-menu.tsx
 * Unified 3-Zone Context Menu & ⋯ Trigger Button:
 *  - Guarantees at most ONE context menu is open across the entire page (ws:context-menu-open event)
 *  - Identical menu items for desktop right-click (onContextMenu) and card ⋯ button
 *  - Browser-native right-click guard: never intercepts <input>, <textarea>, contenteditable, or active text selection
 *  - Full WAI-ARIA role="menu" / role="menuitem" + ArrowUp/ArrowDown/Enter/Escape/Tab + viewport clamping
 *  - Closes on real page scrolls only (late scroll events right after opening are ignored)
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  id: string;
  label: string;
  /** 1 = primary/explore, 2 = organize/visibility/share, 3 = destructive/archive */
  group: 1 | 2 | 3;
  tone?: 'default' | 'owner' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

const MENU_OPEN_EVENT = 'ws:context-menu-open';

function shouldKeepNativeContextMenu(target: EventTarget | null): boolean {
  if (typeof window !== 'undefined') {
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length > 0) return true;
  }
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) {
    return true;
  }
  return false;
}

export function ContextMenuWrapper({
  items,
  ariaLabel = '항목 작업 메뉴',
  className = '',
  children,
}: {
  items: ContextMenuItem[];
  ariaLabel?: string;
  className?: string;
  children: (props: {
    triggerButton: React.ReactNode;
    isMenuOpen: boolean;
  }) => React.ReactNode;
}) {
  const instanceId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [focusIdx, setFocusIdx] = useState(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const visibleItems = items.filter((item) => Boolean(item));
  const enabledIndices = visibleItems
    .map((item, idx) => (!item.disabled ? idx : -1))
    .filter((idx) => idx >= 0);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const openAt = useCallback(
    (clientX: number, clientY: number) => {
      if (visibleItems.length === 0) return;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, { detail: instanceId }));
      }
      setPos({ x: clientX, y: clientY });
      setFocusIdx(enabledIndices[0] ?? 0);
      setOpen(true);
    },
    [visibleItems.length, enabledIndices, instanceId]
  );

  useEffect(() => {
    const onOtherMenuOpen = (e: Event) => {
      const custom = e as CustomEvent<string>;
      if (custom.detail !== instanceId) {
        setOpen(false);
      }
    };
    window.addEventListener(MENU_OPEN_EVENT, onOtherMenuOpen);
    return () => window.removeEventListener(MENU_OPEN_EVENT, onOtherMenuOpen);
  }, [instanceId]);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (visibleItems.length === 0) return;
    if (shouldKeepNativeContextMenu(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    openAt(e.clientX, e.clientY);
  };

  const handleMoreButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      closeMenu(false);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    openAt(rect.right - 224, rect.bottom + 6);
  };

  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 12;
    let nextX = pos.x;
    let nextY = pos.y;
    if (nextX + rect.width > window.innerWidth - pad) {
      nextX = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (nextY + rect.height > window.innerHeight - pad) {
      nextY = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (nextX < pad) nextX = pad;
    if (nextY < pad) nextY = pad;
    if (nextX !== pos.x || nextY !== pos.y) {
      setPos({ x: nextX, y: nextY });
    }
  }, [open, pos.x, pos.y]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focusIdx]?.focus();
  }, [open, focusIdx]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current !== e.target &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        closeMenu(false);
      }
    };
    // Close when the page really scrolls (the anchor moved), but ignore scroll events that are
    // still arriving from the scroll that preceded the tap (momentum scrolling on phones,
    // scroll-into-view before a click) — otherwise the menu closes the moment it opens.
    const openedAt = performance.now();
    const startScrollY = window.scrollY;
    const onScroll = (e: Event) => {
      if (performance.now() - openedAt < 250) return;
      const target = e.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      const isPageScroll =
        target === document || target === document.documentElement || target === document.body;
      if (isPageScroll && Math.abs(window.scrollY - startScrollY) < 4) return;
      closeMenu(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        closeMenu(false);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMenu(true);
        return;
      }
      if (enabledIndices.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const curPos = enabledIndices.indexOf(focusIdx);
        const nextIdx = enabledIndices[(curPos + 1) % enabledIndices.length];
        setFocusIdx(nextIdx);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const curPos = enabledIndices.indexOf(focusIdx);
        const nextIdx =
          enabledIndices[(curPos - 1 + enabledIndices.length) % enabledIndices.length];
        setFocusIdx(nextIdx);
      }
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, focusIdx, enabledIndices, closeMenu]);

  const triggerButton =
    visibleItems.length > 0 ? (
      <button
        ref={triggerRef}
        type="button"
        onClick={handleMoreButtonClick}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
      >
        <span aria-hidden="true" className="text-sm leading-none tracking-tighter">
          ⋯
        </span>
      </button>
    ) : null;

  return (
    <div onContextMenu={handleContextMenu} className={className}>
      {children({ triggerButton, isMenuOpen: open })}

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          style={{ left: pos.x, top: pos.y }}
          className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg ring-1 ring-slate-900/5"
        >
          {visibleItems.map((item, idx) => {
            const prev = idx > 0 ? visibleItems[idx - 1] : null;
            const needsDivider = prev !== null && prev.group !== item.group;
            const toneClass =
              item.tone === 'danger'
                ? 'text-red-700 hover:bg-red-50 focus:bg-red-50'
                : item.tone === 'owner'
                  ? 'text-teal-800 hover:bg-teal-50 focus:bg-teal-50'
                  : 'text-slate-700 hover:bg-slate-50 focus:bg-slate-50';

            return (
              <React.Fragment key={item.id}>
                {needsDivider && (
                  <div role="separator" className="my-1 border-t border-slate-100" />
                )}
                <button
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeMenu(false);
                    item.onSelect();
                  }}
                  className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-xs font-medium transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-45 ${toneClass}`}
                >
                  <span>{item.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
