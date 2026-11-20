/**
 * apps/web/src/app/api/inbox/ingest/route.ts
 * Step 2 of 2-step upload:
 *  - Prevents storagePath replay & handles concurrent 23505 idempotency safely
 *  - Atomically rolls back storage_used_bytes via release_workspace_storage_bytes on any failure
 *  - Never deletes an existing item's storage file on concurrent 23505 collisions
 *  - Uses standard UNIQUE (workspace_id, source_inbox_item_id, source_tag_id) for tasks.upsert
 */
import { NextResponse } from 'next/server';
import { FREE_PLAN_LIMITS, IngestInboxItemSchema } from '@workspace/core/schemas';
import {
  assertActiveWorkspaceMember,
  getAuthenticatedContext,
  PRIVATE_STORAGE_BUCKET,
} from '@/lib/supabase-server';

async function getUploadedObjectSize(
  adminClient: ReturnType<typeof import('@/lib/supabase-server').createAdminClient>,
  storagePath: string
): Promise<number | null> {
  const lastSlash = storagePath.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  const folder = storagePath.slice(0, lastSlash);
  const fileName = storagePath.slice(lastSlash + 1);

  const { data, error } = await adminClient.storage
    .from(PRIVATE_STORAGE_BUCKET)
    .list(folder, { search: fileName, limit: 10 });

  if (error || !data) return null;
  const match = data.find((obj) => obj.name === fileName);
  const size = match?.metadata?.size;
  return typeof size === 'number' ? size : null;
}

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

  const parsed = IngestInboxItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const membership = await assertActiveWorkspaceMember(ctx.adminClient, input.workspaceId, ctx.user.id);
  if (!membership) {
    return NextResponse.json({ error: 'FORBIDDEN_WORKSPACE' }, { status: 403 });
  }

  const expectedUserPrefix = `${input.workspaceId}/${ctx.user.id}/`;
  if (!input.storagePath.startsWith(expectedUserPrefix)) {
    return NextResponse.json({ error: 'FORBIDDEN_STORAGE_PATH' }, { status: 403 });
  }

  // 1) Idempotency check
  const { data: existingByKey } = await ctx.adminClient
    .from('inbox_items')
    .select('*')
    .eq('workspace_id', input.workspaceId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existingByKey) {
    return NextResponse.json({ item: existingByKey, deduplicated: true }, { status: 200 });
  }

  // 2) Pre-check storagePath replay across different idempotency keys
  const { data: existingByPath } = await ctx.adminClient
    .from('inbox_items')
    .select('id')
    .eq('storage_path', input.storagePath)
    .maybeSingle();

  if (existingByPath) {
    return NextResponse.json({ error: 'STORAGE_PATH_ALREADY_INGESTED' }, { status: 409 });
  }

  // 3) Verify actual uploaded object exists and matches declared size
  const actualSize = await getUploadedObjectSize(ctx.adminClient, input.storagePath);
  if (actualSize === null || actualSize <= 0) {
    return NextResponse.json({ error: 'UPLOADED_OBJECT_NOT_FOUND' }, { status: 400 });
  }
  if (
    actualSize > FREE_PLAN_LIMITS.MAX_SINGLE_UPLOAD_BYTES ||
    actualSize > input.fileSizeBytes
  ) {
    await ctx.adminClient.storage.from(PRIVATE_STORAGE_BUCKET).remove([input.storagePath]);
    return NextResponse.json(
      { error: 'FILE_SIZE_MISMATCH_OR_EXCEEDED', actualSize, declaredSize: input.fileSizeBytes },
      { status: 400 }
    );
  }

  // 4) Atomically reserve storage bytes under FOR UPDATE lock
  const { error: storageErr } = await ctx.adminClient.rpc('add_workspace_storage_bytes', {
    p_workspace_id: input.workspaceId,
    p_delta_bytes: actualSize,
  });

  if (storageErr) {
    await ctx.adminClient.storage.from(PRIVATE_STORAGE_BUCKET).remove([input.storagePath]);
    const isQuota = storageErr.message.includes('FREE_STORAGE_LIMIT_EXCEEDED');
    return NextResponse.json(
      { error: isQuota ? 'FREE_STORAGE_LIMIT_EXCEEDED' : 'STORAGE_QUOTA_ERROR' },
      { status: isQuota ? 402 : 500 }
    );
  }

  const originalExpiresAt =
    membership.plan === 'free'
      ? new Date(Date.now() + FREE_PLAN_LIMITS.RETENTION_DAYS * 86400 * 1000).toISOString()
      : null;

  // 5) Insert inbox_items row
  const { data: created, error: insertErr } = await ctx.adminClient
    .from('inbox_items')
    .insert({
      workspace_id: input.workspaceId,
      owner_user_id: ctx.user.id,
      visibility: input.visibility,
      source_type: input.sourceType,
      idempotency_key: input.idempotencyKey,
      title: input.title ?? null,
      storage_path: input.storagePath,
      file_size_bytes: actualSize,
      page_count: input.pageCount ?? null,
      audio_seconds: input.audioSeconds ?? null,
      processing_status: 'ready',
      original_expires_at: originalExpiresAt,
    })
    .select('*')
    .single();

  if (insertErr || !created) {
    // Always roll back the storage_used_bytes increment atomically
    await ctx.adminClient.rpc('release_workspace_storage_bytes', {
      p_workspace_id: input.workspaceId,
      p_delta_bytes: actualSize,
    });

    if (insertErr?.code === '23505') {
      // Never delete the storage file on a unique conflict (could belong to the winning request)
      const { data: winner } = await ctx.adminClient
        .from('inbox_items')
        .select('*')
        .eq('workspace_id', input.workspaceId)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();

      if (winner) {
        return NextResponse.json({ item: winner, deduplicated: true }, { status: 200 });
      }
      return NextResponse.json({ error: 'STORAGE_PATH_ALREADY_INGESTED' }, { status: 409 });
    }

    await ctx.adminClient.storage.from(PRIVATE_STORAGE_BUCKET).remove([input.storagePath]);
    return NextResponse.json({ error: 'INGEST_INSERT_FAILED' }, { status: 500 });
  }

  // 6) Attach tags and create tasks ONLY for action_trigger tags
  if (input.tagIds.length > 0) {
    const { data: validTags } = await ctx.adminClient
      .from('tags')
      .select('id, label, kind, default_due_offset_days')
      .eq('workspace_id', input.workspaceId)
      .in('id', input.tagIds);

    if (validTags && validTags.length > 0) {
      await ctx.adminClient.from('entity_tags').upsert(
        validTags.map((t) => ({
          workspace_id: input.workspaceId,
          tag_id: t.id,
          entity_type: 'inbox_item',
          entity_id: created.id,
          created_by: ctx.user.id,
        })),
        { onConflict: 'workspace_id,tag_id,entity_type,entity_id', ignoreDuplicates: true }
      );

      const actionTags = validTags.filter((t) => t.kind === 'action_trigger');
      if (actionTags.length > 0) {
        await ctx.adminClient.from('tasks').upsert(
          actionTags.map((t) => ({
            workspace_id: input.workspaceId,
            source_inbox_item_id: created.id,
            source_tag_id: t.id,
            owner_user_id: ctx.user.id,
            assignee_user_id: ctx.user.id,
            visibility: input.visibility,
            title: input.title ? `[${t.label}] ${input.title}` : t.label,
            due_at:
              t.default_due_offset_days != null
                ? new Date(Date.now() + t.default_due_offset_days * 86400 * 1000).toISOString()
                : null,
          })),
          {
            onConflict: 'workspace_id,source_inbox_item_id,source_tag_id',
            ignoreDuplicates: true,
          }
        );
      }
    }
  }

  return NextResponse.json({ item: created, deduplicated: false }, { status: 201 });
}
