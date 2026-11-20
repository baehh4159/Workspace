/**
 * apps/web/src/app/api/workspaces/transfer-items/route.ts
 * POST: Selectively transfers owned projects / inbox_items / tasks from a personal workspace
 * to a team workspace via transfer_personal_items_to_team() RPC.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema } from '@workspace/core/schemas';
import { getAuthenticatedContext } from '@/lib/supabase-server';

const TransferItemsSchema = z
  .object({
    sourceWorkspaceId: UuidSchema,
    targetWorkspaceId: UuidSchema,
    projectIds: z.array(UuidSchema).max(50).default([]),
    inboxItemIds: z.array(UuidSchema).max(50).default([]),
    taskIds: z.array(UuidSchema).max(50).default([]),
  })
  .refine(
    (d) =>
      d.sourceWorkspaceId !== d.targetWorkspaceId &&
      d.projectIds.length + d.inboxItemIds.length + d.taskIds.length > 0,
    {
      message: 'Select at least one item and distinct source/target workspaces.',
    }
  );

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

  const parsed = TransferItemsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const { data, error } = await ctx.adminClient.rpc('transfer_personal_items_to_team', {
    p_source_workspace_id: input.sourceWorkspaceId,
    p_target_workspace_id: input.targetWorkspaceId,
    p_user_id: ctx.user.id,
    p_project_ids: input.projectIds,
    p_inbox_item_ids: input.inboxItemIds,
    p_task_ids: input.taskIds,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('TARGET_STORAGE_LIMIT_EXCEEDED')) {
      return NextResponse.json({ error: 'TARGET_STORAGE_LIMIT_EXCEEDED' }, { status: 402 });
    }
    if (msg.includes('FORBIDDEN_WORKSPACE') || msg.includes('TRANSFER_REQUIRES_PERSONAL_TO_TEAM')) {
      return NextResponse.json({ error: 'FORBIDDEN_TRANSFER' }, { status: 403 });
    }
    return NextResponse.json({ error: 'TRANSFER_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ transferred: data }, { status: 200 });
}
