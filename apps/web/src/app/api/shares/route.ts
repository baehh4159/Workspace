/**
 * apps/web/src/app/api/shares/route.ts
 *  - POST: Issues 7/14/30-day guest share tokens (stored as SHA-256 hash only)
 *  - DELETE: Immediately revokes an existing share token (revoked_at = now())
 */
import { NextResponse } from 'next/server';
import { CreateShareTokenSchema, RevokeShareTokenSchema } from '@workspace/core/schemas';
import {
  assertActiveWorkspaceMember,
  generateOpaqueToken,
  getAuthenticatedContext,
  sha256Hex,
} from '@/lib/supabase-server';

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

  const parsed = CreateShareTokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { workspaceId, entityType, entityId, scope, expiresInDays } = parsed.data;
  const membership = await assertActiveWorkspaceMember(ctx.adminClient, workspaceId, ctx.user.id);
  if (!membership) {
    return NextResponse.json({ error: 'FORBIDDEN_WORKSPACE' }, { status: 403 });
  }

  const { data: canAccess } = await ctx.userClient.rpc('can_access_entity', {
    p_workspace_id: workspaceId,
    p_entity_type: entityType,
    p_entity_id: entityId,
  });

  if (!canAccess) {
    return NextResponse.json({ error: 'FORBIDDEN_ENTITY' }, { status: 403 });
  }

  const rawToken = generateOpaqueToken(32);
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString();

  const { data: share, error: insertErr } = await ctx.adminClient
    .from('share_tokens')
    .insert({
      workspace_id: workspaceId,
      token_hash: tokenHash,
      entity_type: entityType,
      entity_id: entityId,
      scope,
      created_by: ctx.user.id,
      expires_at: expiresAt,
    })
    .select('id, entity_type, entity_id, scope, expires_at')
    .single();

  if (insertErr || !share) {
    return NextResponse.json({ error: 'SHARE_CREATE_FAILED' }, { status: 500 });
  }

  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? '';
  return NextResponse.json(
    {
      shareId: share.id,
      shareUrl: `${origin}/s/${rawToken}`,
      expiresAt: share.expires_at,
    },
    { status: 201 }
  );
}

export async function DELETE(req: Request) {
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

  const parsed = RevokeShareTokenSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { workspaceId, shareId } = parsed.data;
  const membership = await assertActiveWorkspaceMember(ctx.adminClient, workspaceId, ctx.user.id);
  if (!membership) {
    return NextResponse.json({ error: 'FORBIDDEN_WORKSPACE' }, { status: 403 });
  }

  const { data: existing } = await ctx.adminClient
    .from('share_tokens')
    .select('id, created_by, revoked_at')
    .eq('id', shareId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  // Only the creator or workspace owner can revoke a share link
  if (existing.created_by !== ctx.user.id && membership.role !== 'owner') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  if (existing.revoked_at) {
    return NextResponse.json({ revoked: true, shareId, alreadyRevoked: true }, { status: 200 });
  }

  const { error: revokeErr } = await ctx.adminClient
    .from('share_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId)
    .eq('workspace_id', workspaceId);

  if (revokeErr) {
    return NextResponse.json({ error: 'SHARE_REVOKE_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ revoked: true, shareId }, { status: 200 });
}
