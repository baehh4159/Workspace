/**
 * apps/web/src/lib/supabase-server.ts
 * Dual-mode Supabase server auth:
 *  - API Routes: supports Authorization: Bearer <jwt> (Mobile/Scanner) AND @supabase/ssr cookie session (Web)
 *  - Server Components: getServerWorkspaceSession() resolves user, active workspaces, and selected workspace
 */
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { DEMO_MODE, DEMO_USER, createMockSupabaseClient } from '@/lib/demo/mock-supabase';

export interface AuthContext {
  user: User;
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  type: 'personal' | 'team';
  plan: 'free' | 'pro' | 'team';
  role: 'owner' | 'member';
}

export interface ServerWorkspaceSession {
  user: User;
  userClient: SupabaseClient;
  workspaces: WorkspaceSummary[];
  activeWorkspace: WorkspaceSummary;
}

export const PRIVATE_STORAGE_BUCKET = 'inbox-originals';
export const ACTIVE_WORKSPACE_COOKIE = 'ws_active_workspace_id';

function getPublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return { url, anonKey };
}

export function createAdminClient(): SupabaseClient {
  if (DEMO_MODE) return createMockSupabaseClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase admin environment variables');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function createCookieServerClient(): Promise<SupabaseClient> {
  if (DEMO_MODE) return createMockSupabaseClient();
  const { url, anonKey } = getPublicEnv();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Read-only in Server Components / Route Handlers that don't mutate session cookies
      },
    },
  });
}

/**
 * Dual-mode API authentication:
 *  1) If Authorization: Bearer <token> is sent (Mobile / Scanner), verifies that token.
 *  2) Otherwise falls back to @supabase/ssr HttpOnly session cookies (Web browser).
 */
export async function getAuthenticatedContext(req: Request): Promise<AuthContext | null> {
  if (DEMO_MODE) {
    const mock = createMockSupabaseClient();
    return { user: DEMO_USER, userClient: mock, adminClient: mock };
  }
  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (bearerToken) {
    const { url, anonKey } = getPublicEnv();
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await userClient.auth.getUser(bearerToken);
    if (error || !data.user) return null;

    return {
      user: data.user,
      userClient,
      adminClient: createAdminClient(),
    };
  }

  // Fallback: @supabase/ssr cookie session for same-origin Web requests
  const cookieClient = await createCookieServerClient();
  const { data, error } = await cookieClient.auth.getUser();
  if (error || !data.user) return null;

  return {
    user: data.user,
    userClient: cookieClient,
    adminClient: createAdminClient(),
  };
}

/** Server Component helper to load authenticated user + active workspaces */
export async function getServerWorkspaceSession(): Promise<ServerWorkspaceSession | null> {
  const userClient = await createCookieServerClient();
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return null;

  const { data: rows, error: wsErr } = await userClient
    .from('workspace_members')
    .select('role, status, workspaces!inner(id, name, type, plan)')
    .eq('user_id', userData.user.id)
    .eq('status', 'active');

  if (wsErr || !rows || rows.length === 0) return null;

  const workspaces: WorkspaceSummary[] = rows
    .map((r) => {
      const ws = Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces;
      if (!ws) return null;
      return {
        id: ws.id as string,
        name: ws.name as string,
        type: ws.type as 'personal' | 'team',
        plan: ws.plan as 'free' | 'pro' | 'team',
        role: r.role as 'owner' | 'member',
      };
    })
    .filter((w): w is WorkspaceSummary => w !== null);

  if (workspaces.length === 0) return null;

  const cookieStore = await cookies();
  const preferredId = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const activeWorkspace =
    workspaces.find((w) => w.id === preferredId) ??
    workspaces.find((w) => w.type === 'personal') ??
    workspaces[0];

  return {
    user: userData.user,
    userClient,
    workspaces,
    activeWorkspace,
  };
}

export async function assertActiveWorkspaceMember(
  adminClient: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<{ role: 'owner' | 'member'; plan: 'free' | 'pro' | 'team'; storageUsedBytes: number } | null> {
  const { data, error } = await adminClient
    .from('workspace_members')
    .select('role, status, workspaces!inner(plan, storage_used_bytes)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data || data.status !== 'active') return null;

  const wsRaw = Array.isArray(data.workspaces) ? data.workspaces[0] : data.workspaces;
  if (!wsRaw) return null;

  return {
    role: data.role as 'owner' | 'member',
    plan: wsRaw.plan as 'free' | 'pro' | 'team',
    storageUsedBytes: Number(wsRaw.storage_used_bytes ?? 0),
  };
}

export function sha256Hex(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
