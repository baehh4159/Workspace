/**
 * apps/web/src/app/api/workspaces/route.ts
 * POST: Creates a new team workspace with default tags and switches active workspace cookie.
 * New teams start on the free plan with FREE_TEAM_MAX_SEATS seats; the team plan raises it to 10.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ACTIVE_WORKSPACE_COOKIE,
  getAuthenticatedContext,
} from '@/lib/supabase-server';
import { FREE_TEAM_MAX_SEATS } from '@/lib/billing';

const CreateTeamWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function POST(req: Request) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = CreateTeamWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { data, error } = await ctx.adminClient.rpc('create_team_workspace_atomic', {
    p_name: parsed.data.name,
    p_user_id: ctx.user.id,
  });

  if (error || !data) {
    return NextResponse.json({ error: 'TEAM_WORKSPACE_CREATE_FAILED' }, { status: 500 });
  }

  const workspace = Array.isArray(data) ? data[0] : data;
  if (!workspace?.id) {
    return NextResponse.json({ error: 'TEAM_WORKSPACE_CREATE_FAILED' }, { status: 500 });
  }

  // Free teams get a small seat cap so growing teams have a reason to upgrade.
  const { error: seatErr } = await ctx.adminClient
    .from('workspaces')
    .update({ max_seats: FREE_TEAM_MAX_SEATS })
    .eq('id', workspace.id as string)
    .eq('plan', 'free');
  if (!seatErr && workspace.plan === 'free') {
    workspace.max_seats = FREE_TEAM_MAX_SEATS;
  }

  const res = NextResponse.json({ workspace }, { status: 201 });
  res.cookies.set(ACTIVE_WORKSPACE_COOKIE, workspace.id as string, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}
