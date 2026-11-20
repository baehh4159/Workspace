/**
 * apps/web/src/app/api/inbox/[id]/triage/route.ts
 * 2-second inbox triage: convert_to_task | link_to_project | link_to_event | archive
 * - Checks { error } on every triage_status update
 * - Scopes convert_to_task idempotency check to source_inbox_item_id === item.id (409 on cross-item key reuse)
 */
import { NextResponse } from 'next/server';
import { TriageInboxItemSchema, UuidSchema } from '@workspace/core/schemas';
import { assertActiveWorkspaceMember, getAuthenticatedContext } from '@/lib/supabase-server';

export async function POST(
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

  const parsed = TriageInboxItemSchema.safeParse(body);
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

  const { data: item } = await ctx.adminClient
    .from('inbox_items')
    .select('id, workspace_id, owner_user_id, visibility, triage_status')
    .eq('id', id)
    .eq('workspace_id', input.workspaceId)
    .maybeSingle();

  if (!item || (item.owner_user_id !== ctx.user.id && item.visibility !== 'team')) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  if (input.action === 'archive') {
    const { error: updErr } = await ctx.adminClient
      .from('inbox_items')
      .update({ triage_status: 'archived' })
      .eq('id', item.id);

    if (updErr) {
      return NextResponse.json({ error: 'ARCHIVE_FAILED' }, { status: 500 });
    }
    return NextResponse.json({ id: item.id, triageStatus: 'archived' }, { status: 200 });
  }

  if (input.action === 'link_to_project') {
    const { data: proj } = await ctx.adminClient
      .from('projects')
      .select('id, owner_user_id, visibility')
      .eq('id', input.projectId)
      .eq('workspace_id', input.workspaceId)
      .maybeSingle();

    if (!proj || (proj.owner_user_id !== ctx.user.id && proj.visibility !== 'team')) {
      return NextResponse.json({ error: 'FORBIDDEN_PROJECT' }, { status: 403 });
    }

    const { error: linkErr } = await ctx.adminClient.from('entity_links').upsert(
      {
        workspace_id: input.workspaceId,
        from_type: 'inbox_item',
        from_id: item.id,
        to_type: 'project',
        to_id: proj.id,
        created_by: ctx.user.id,
      },
      { onConflict: 'workspace_id,from_type,from_id,to_type,to_id', ignoreDuplicates: true }
    );

    if (linkErr) {
      return NextResponse.json({ error: 'LINK_FAILED' }, { status: 500 });
    }

    const { error: triageErr } = await ctx.adminClient
      .from('inbox_items')
      .update({ triage_status: 'triaged' })
      .eq('id', item.id);

    if (triageErr) {
      return NextResponse.json({ error: 'TRIAGE_STATUS_UPDATE_FAILED' }, { status: 500 });
    }

    return NextResponse.json(
      { id: item.id, triageStatus: 'triaged', linkedProjectId: proj.id },
      { status: 200 }
    );
  }

  if (input.action === 'link_to_event') {
    const { data: evt } = await ctx.adminClient
      .from('events')
      .select('id, owner_user_id, visibility')
      .eq('id', input.eventId)
      .eq('workspace_id', input.workspaceId)
      .maybeSingle();

    if (!evt || (evt.owner_user_id !== ctx.user.id && evt.visibility !== 'team')) {
      return NextResponse.json({ error: 'FORBIDDEN_EVENT' }, { status: 403 });
    }

    const { error: linkErr } = await ctx.adminClient.from('entity_links').upsert(
      {
        workspace_id: input.workspaceId,
        from_type: 'inbox_item',
        from_id: item.id,
        to_type: 'event',
        to_id: evt.id,
        created_by: ctx.user.id,
      },
      { onConflict: 'workspace_id,from_type,from_id,to_type,to_id', ignoreDuplicates: true }
    );

    if (linkErr) {
      return NextResponse.json({ error: 'LINK_FAILED' }, { status: 500 });
    }

    const { error: triageErr } = await ctx.adminClient
      .from('inbox_items')
      .update({ triage_status: 'triaged' })
      .eq('id', item.id);

    if (triageErr) {
      return NextResponse.json({ error: 'TRIAGE_STATUS_UPDATE_FAILED' }, { status: 500 });
    }

    return NextResponse.json(
      { id: item.id, triageStatus: 'triaged', linkedEventId: evt.id },
      { status: 200 }
    );
  }

  // action === 'convert_to_task'
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
    const { data: existingTask } = await ctx.adminClient
      .from('tasks')
      .select('*')
      .eq('workspace_id', input.workspaceId)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();

    if (existingTask) {
      if (existingTask.source_inbox_item_id !== item.id) {
        return NextResponse.json({ error: 'IDEMPOTENCY_KEY_CONFLICT' }, { status: 409 });
      }
      if (item.triage_status !== 'triaged') {
        const { error: triageErr } = await ctx.adminClient
          .from('inbox_items')
          .update({ triage_status: 'triaged' })
          .eq('id', item.id);
        if (triageErr) {
          return NextResponse.json({ error: 'TRIAGE_STATUS_UPDATE_FAILED' }, { status: 500 });
        }
      }
      return NextResponse.json(
        { id: item.id, triageStatus: 'triaged', task: existingTask, deduplicated: true },
        { status: 200 }
      );
    }
  }

  const { data: createdTask, error: taskErr } = await ctx.adminClient
    .from('tasks')
    .insert({
      workspace_id: input.workspaceId,
      project_id: verifiedProjectId,
      source_inbox_item_id: item.id,
      idempotency_key: input.idempotencyKey ?? null,
      owner_user_id: ctx.user.id,
      assignee_user_id: ctx.user.id,
      visibility: item.visibility,
      title: input.taskTitle,
      due_at: input.taskDueAt ?? null,
    })
    .select('*')
    .single();

  if (taskErr || !createdTask) {
    if (taskErr?.code === '23505' && input.idempotencyKey) {
      const { data: winner } = await ctx.adminClient
        .from('tasks')
        .select('*')
        .eq('workspace_id', input.workspaceId)
        .eq('idempotency_key', input.idempotencyKey)
        .eq('source_inbox_item_id', item.id)
        .maybeSingle();

      if (winner) {
        const { error: triageErr } = await ctx.adminClient
          .from('inbox_items')
          .update({ triage_status: 'triaged' })
          .eq('id', item.id);
        if (triageErr) {
          return NextResponse.json({ error: 'TRIAGE_STATUS_UPDATE_FAILED' }, { status: 500 });
        }
        return NextResponse.json(
          { id: item.id, triageStatus: 'triaged', task: winner, deduplicated: true },
          { status: 200 }
        );
      }
      return NextResponse.json({ error: 'IDEMPOTENCY_KEY_CONFLICT' }, { status: 409 });
    }
    return NextResponse.json({ error: 'TASK_CREATE_FAILED' }, { status: 500 });
  }

  const { error: triageErr } = await ctx.adminClient
    .from('inbox_items')
    .update({ triage_status: 'triaged' })
    .eq('id', item.id);

  if (triageErr) {
    return NextResponse.json({ error: 'TRIAGE_STATUS_UPDATE_FAILED' }, { status: 500 });
  }

  return NextResponse.json(
    { id: item.id, triageStatus: 'triaged', task: createdTask, deduplicated: false },
    { status: 201 }
  );
}
