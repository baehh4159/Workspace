/**
 * apps/web/src/app/api/tasks/[id]/route.ts
 *  - PATCH: Updates task status, title, dueAt, or visibility via userClient RLS
 *    (owner-only visibility & immutable fields enforced by DB triggers)
 *  - DELETE: Deletes a task via userClient RLS (owner-only delete policy)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema, VisibilitySchema } from '@workspace/core/schemas';
import { getAuthenticatedContext } from '@/lib/supabase-server';

const PatchTaskSchema = z
  .object({
    status: z.enum(['todo', 'in_progress', 'waiting', 'done']).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    dueAt: IsoDateTimeSchema.nullable().optional(),
    visibility: VisibilitySchema.optional(),
  })
  .refine(
    (d) =>
      d.status !== undefined ||
      d.title !== undefined ||
      d.dueAt !== undefined ||
      d.visibility !== undefined,
    { message: 'At least one field must be provided.' }
  );

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

  const parsed = PatchTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) payload.status = parsed.data.status;
  if (parsed.data.title !== undefined) payload.title = parsed.data.title;
  if (parsed.data.dueAt !== undefined) payload.due_at = parsed.data.dueAt;
  if (parsed.data.visibility !== undefined) {
    payload.visibility = parsed.data.visibility;
    // DB constraint: private tasks must be assigned to owner_user_id
    if (parsed.data.visibility === 'private') {
      payload.assignee_user_id = ctx.user.id;
    }
  }

  const { data: updated, error } = await ctx.userClient
    .from('tasks')
    .update(payload)
    .eq('id', id)
    .select('id, title, status, due_at, visibility, updated_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'TASK_UPDATE_FAILED' }, { status: 403 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ task: updated }, { status: 200 });
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

  const { data: deleted, error } = await ctx.userClient
    .from('tasks')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'TASK_DELETE_FAILED' }, { status: 500 });
  }
  if (!deleted) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id: deleted.id }, { status: 200 });
}
