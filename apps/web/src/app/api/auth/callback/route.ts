/**
 * apps/web/src/app/api/auth/callback/route.ts
 * Uses @supabase/ssr createServerClient to read PKCE code_verifier, exchange OAuth code,
 * write authenticated session cookies onto NextResponse, honor ws_oauth_next cookie,
 * and atomically join team workspace via join_team_workspace_atomic() when shareToken is present.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
  ACTIVE_WORKSPACE_COOKIE,
  createAdminClient,
  sha256Hex,
} from '@/lib/supabase-server';

const PENDING_SHARE_COOKIE = 'ws_pending_share_token';
const OAUTH_NEXT_COOKIE = 'ws_oauth_next';

function sanitizeNextPath(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/today';
  }
  return raw;
}

export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const code = reqUrl.searchParams.get('code');
  const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? reqUrl.origin;

  if (!code) {
    const errRes = NextResponse.redirect(`${appOrigin}/login?error=missing_code`, { status: 302 });
    errRes.headers.set('Cache-Control', 'no-store');
    return errRes;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    const errRes = NextResponse.redirect(`${appOrigin}/login?error=oauth_failed`, { status: 302 });
    errRes.headers.set('Cache-Control', 'no-store');
    return errRes;
  }

  const cookieStore = await cookies();
  const cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }> = [];

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(list: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.push(...list);
      },
    },
  });

  const { data: sessionData, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr || !sessionData.user) {
    const errRes = NextResponse.redirect(`${appOrigin}/login?error=oauth_failed`, { status: 302 });
    errRes.headers.set('Cache-Control', 'no-store');
    return errRes;
  }

  const user = sessionData.user;
  const pendingShareToken = cookieStore.get(PENDING_SHARE_COOKIE)?.value;
  let redirectPath = sanitizeNextPath(cookieStore.get(OAUTH_NEXT_COOKIE)?.value);
  let joinedWorkspaceId: string | null = null;

  if (pendingShareToken && pendingShareToken.length >= 16) {
    const adminClient = createAdminClient();
    const tokenHash = sha256Hex(pendingShareToken);

    const { data: share } = await adminClient
      .from('share_tokens')
      .select('workspace_id, entity_type, scope, expires_at, revoked_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    const isValidJoinShare =
      share &&
      share.revoked_at === null &&
      share.scope === 'view_and_join' &&
      new Date(share.expires_at).getTime() > Date.now();

    if (isValidJoinShare) {
      const { data: joinOutcome, error: joinErr } = await adminClient.rpc(
        'join_team_workspace_atomic',
        {
          p_workspace_id: share.workspace_id,
          p_user_id: user.id,
        }
      );

      if (!joinErr) {
        if (joinOutcome === 'joined') {
          joinedWorkspaceId = share.workspace_id;
          redirectPath = share.entity_type === 'inbox_item' ? '/inbox?joined=1' : '/today?joined=1';
        } else if (joinOutcome === 'already_member') {
          joinedWorkspaceId = share.workspace_id;
          redirectPath = share.entity_type === 'inbox_item' ? '/inbox' : '/today';
        } else if (joinOutcome === 'seat_limit_reached') {
          redirectPath = '/today?joinError=team_seat_limit_reached';
        }
      }
    }
  }

  const res = NextResponse.redirect(`${appOrigin}${redirectPath}`, { status: 302 });
  res.headers.set('Cache-Control', 'no-store');

  // Persist Supabase auth session cookies onto the redirect response
  for (const { name, value, options } of cookiesToSet) {
    res.cookies.set(name, value, options);
  }

  // Switch active workspace cookie immediately when joining via a team share link
  if (joinedWorkspaceId) {
    res.cookies.set(ACTIVE_WORKSPACE_COOKIE, joinedWorkspaceId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  const clearOpts = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };

  res.cookies.set(PENDING_SHARE_COOKIE, '', clearOpts);
  res.cookies.set(OAUTH_NEXT_COOKIE, '', clearOpts);

  return res;
}
