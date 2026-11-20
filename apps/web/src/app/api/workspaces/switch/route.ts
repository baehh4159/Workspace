/**
 * apps/web/src/app/api/workspaces/switch/route.ts
 * Switches the active workspace cookie after verifying active membership.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema } from '@workspace/core/schemas';
import {
  ACTIVE_WORKSPACE_COOKIE,
  assertActiveWorkspaceMember,
  getAuthenticatedContext,
} from '@/lib/supabase-server';

const SwitchWorkspaceSchema = z.object({
  workspaceId: UuidSchema,
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

  const parsed = SwitchWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const membership = await assertActiveWorkspaceMember(
    ctx.adminClient,
    parsed.data.workspaceId,
    ctx.user.id
  );
  if (!membership) {
    return NextResponse.json({ error: 'FORBIDDEN_WORKSPACE' }, { status: 403 });
  }

  const res = NextResponse.json(
    { activeWorkspaceId: parsed.data.workspaceId },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  );
  res.cookies.set(ACTIVE_WORKSPACE_COOKIE, parsed.data.workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}
