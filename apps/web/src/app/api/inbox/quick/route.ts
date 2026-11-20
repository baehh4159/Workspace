/**
 * apps/web/src/app/api/inbox/quick/route.ts
 * AI-optional fast capture (3s Tag -> 10s Text) with:
 *  - Strict projectId authorization guard (rejects unauthorized projectId with 403)
 *  - Concurrent 23505 idempotency deduplication
 *  - Status vs action_trigger tag separation
 */
import { NextResponse } from 'next/server';
import { QuickCaptureSchema } from '@workspace/core/schemas';
import { assertActiveWorkspaceMember, getAuthenticatedContext } from '@/lib/supabase-server';

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

  const parsed = QuickCaptureSchema.safeParse(body);
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

  // Verify projectId upfront before writing any row (blocks cross-workspace / private project bypass)
  let verifiedProjectId: string | null = null;
  if (input.projectId) {
    const { data: proj } = await ctx.adminClient
      .from('projects')
      .select('id, owner_user_id, visibility')
      .eq('id', input.projectId)
      .eq('workspace_id', input.workspaceId)
      .maybeSingle();

    if (!proj || (proj.owner_user_id !== ctx.user.id && proj.visibility !== 'team')) {
      return NextResponse.json({ error: 'FORBIDDEN_PROJECT' }, { status: 403 });
    }
    verifiedProjectId = proj.id;
  }

  if (input.idempotencyKey) {
    const { data: existing } = await ctx.adminClient
      .from('inbox_items')
      .select('*')
      .eq('workspace_id', input.workspaceId)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ item: existing, deduplicated: true }, { status: 200 });
    }
  }

  const { data: created, error: insertErr } = await ctx.adminClient
    .from('inbox_items')
    .insert({
      workspace_id: input.workspaceId,
      owner_user_id: ctx.user.id,
      visibility: input.visibility,
      source_type: input.sourceType,
      idempotency_key: input.idempotencyKey ?? null,
      title: input.title ?? null,
      raw_text: input.rawText ?? null,
      processing_status: 'ready',
    })
    .select('*')
    .single();

  if (insertErr || !created) {
    if (insertErr?.code === '23505' && input.idempotencyKey) {
      const { data: winner } = await ctx.adminClient
        .from('inbox_items')
        .select('*')
        .eq('workspace_id', input.workspaceId)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();

      if (winner) {
        return NextResponse.json({ item: winner, deduplicated: true }, { status: 200 });
      }
    }
    return NextResponse.json({ error: 'QUICK_CAPTURE_FAILED' }, { status: 500 });
  }

  if (verifiedProjectId) {
    await ctx.adminClient.from('entity_links').upsert(
      {
        workspace_id: input.workspaceId,
        from_type: 'inbox_item',
        from_id: created.id,
        to_type: 'project',
        to_id: verifiedProjectId,
        created_by: ctx.user.id,
      },
      { onConflict: 'workspace_id,from_type,from_id,to_type,to_id', ignoreDuplicates: true }
    );
  }

  const createdTasks: unknown[] = [];
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
        const baseTitle = input.title || input.rawText?.slice(0, 60) || '';
        const { data: tasks } = await ctx.adminClient
          .from('tasks')
          .upsert(
            actionTags.map((t) => ({
              workspace_id: input.workspaceId,
              project_id: verifiedProjectId,
              source_inbox_item_id: created.id,
              source_tag_id: t.id,
              owner_user_id: ctx.user.id,
              assignee_user_id: ctx.user.id,
              visibility: input.visibility,
              title: baseTitle ? `[${t.label}] ${baseTitle}` : t.label,
              due_at:
                t.default_due_offset_days != null
                  ? new Date(Date.now() + t.default_due_offset_days * 86400 * 1000).toISOString()
                  : null,
            })),
            {
              onConflict: 'workspace_id,source_inbox_item_id,source_tag_id',
              ignoreDuplicates: true,
            }
          )
          .select('*');
        if (tasks) createdTasks.push(...tasks);
      }
    }
  }

  return NextResponse.json(
    { item: created, createdTasks, deduplicated: false },
    { status: 201 }
  );
}
