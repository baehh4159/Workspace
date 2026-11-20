/**
 * apps/web/src/app/api/inbox/[id]/route.ts
 *  - PATCH: Updates inbox item visibility or title via userClient RLS (owner-only visibility trigger)
 *  - DELETE: Server-mediated DELETE removing Private Storage object and decrementing storage_used_bytes
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema, VisibilitySchema } from '@workspace/core/schemas';
import {
  assertActiveWorkspaceMember,
  getAuthenticatedContext,
  PRIVATE_STORAGE_BUCKET,
} from '@/lib/supabase-server';

const PatchInboxItemSchema = z
  .object({
    visibility: VisibilitySchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((d) => d.visibility !== undefined || d.title !== undefined, {
    message: 'At least one field (visibility or title) must be provided.',
  });

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'INVALID_UUID' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = PatchInboxItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};
  if (parsed.data.visibility !== undefined) payload.visibility = parsed.data.visibility;
  if (parsed.data.title !== undefined) payload.title = parsed.data.title;

  const { data: updated, error } = await ctx.userClient
    .from('inbox_items')
    .update(payload)
    .eq('id', id)
    .select('id, title, visibility')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'INBOX_UPDATE_FAILED' }, { status: 403 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ item: updated }, { status: 200 });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'INVALID_UUID' }, { status: 400 });
  }

  const { data: item, error: fetchErr } = await ctx.adminClient
    .from('inbox_items')
    .select('id, workspace_id, owner_user_id, storage_path, original_purged_at')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !item) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const membership = await assertActiveWorkspaceMember(ctx.adminClient, item.workspace_id, ctx.user.id);
  if (!membership || item.owner_user_id !== ctx.user.id) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  if (item.storage_path && !item.original_purged_at) {
    const { error: rmErr } = await ctx.adminClient.storage
      .from(PRIVATE_STORAGE_BUCKET)
      .remove([item.storage_path]);

    if (rmErr) {
      return NextResponse.json({ error: 'STORAGE_DELETE_FAILED' }, { status: 500 });
    }

    const { error: purgeErr } = await ctx.adminClient.rpc('mark_original_purged', {
      p_inbox_item_id: item.id,
      p_force: true,
    });

    if (purgeErr) {
      return NextResponse.json({ error: 'STORAGE_COUNTER_SYNC_FAILED' }, { status: 500 });
    }
  }

  const { error: delErr } = await ctx.adminClient
    .from('inbox_items')
    .delete()
    .eq('id', item.id)
    .eq('owner_user_id', ctx.user.id);

  if (delErr) {
    return NextResponse.json({ error: 'DELETE_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ deleted: true, id: item.id }, { status: 200 });
}
