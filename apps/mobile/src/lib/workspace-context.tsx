/**
 * apps/mobile/src/lib/workspace-context.tsx
 * Shared auth + active workspace provider for Expo Router tabs.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabaseMobile } from '@/lib/supabase-mobile';
import { fetchActiveWorkspaces, type MobileWorkspaceSummary } from '@/lib/workspace-api';

interface WorkspaceContextValue {
  loading: boolean;
  isAuthenticated: boolean;
  workspaces: MobileWorkspaceSummary[];
  activeWorkspace: MobileWorkspaceSummary | null;
  selectWorkspace: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  loading: true,
  isAuthenticated: false,
  workspaces: [],
  activeWorkspace: null,
  selectWorkspace: () => {},
  refreshWorkspaces: async () => {},
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [workspaces, setWorkspaces] = useState<MobileWorkspaceSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabaseMobile.auth.getSession();
      if (!data.session) {
        setIsAuthenticated(false);
        setWorkspaces([]);
        setActiveId(null);
        return;
      }

      setIsAuthenticated(true);
      const list = await fetchActiveWorkspaces();
      setWorkspaces(list);
      setActiveId((prev) => {
        if (prev && list.some((w) => w.id === prev)) return prev;
        return list.find((w) => w.type === 'personal')?.id ?? list[0]?.id ?? null;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshWorkspaces();
    const { data: sub } = supabaseMobile.auth.onAuthStateChange(() => {
      void refreshWorkspaces();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [refreshWorkspaces]);

  const activeWorkspace = workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null;

  return (
    <WorkspaceContext.Provider
      value={{
        loading,
        isAuthenticated,
        workspaces,
        activeWorkspace,
        selectWorkspace: setActiveId,
        refreshWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
