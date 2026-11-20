'use client';

/**
 * apps/web/src/components/workspace-switcher.tsx
 * Interactive personal / team workspace switcher calling POST /api/workspaces/switch.
 */
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface SwitcherWorkspace {
  id: string;
  name: string;
  type: 'personal' | 'team';
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
}: {
  workspaces: SwitcherWorkspace[];
  activeWorkspaceId: string;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value;
    if (!nextId || nextId === activeWorkspaceId) return;
    setSwitching(true);
    try {
      const res = await fetch('/api/workspaces/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: nextId }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className="sr-only">워크스페이스 전환</span>
      <select
        value={activeWorkspaceId}
        disabled={switching}
        onChange={(e) => void handleChange(e)}
        className="max-w-[9.5rem] truncate rounded-full border border-slate-200 bg-[#F7F8FA] px-3 py-1 text-xs font-medium text-slate-800 focus:border-blue-600 focus:outline-none disabled:opacity-60 sm:max-w-none"
      >
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.type === 'team' ? `[팀] ${ws.name}` : `[개인] ${ws.name}`}
          </option>
        ))}
      </select>
    </label>
  );
}
