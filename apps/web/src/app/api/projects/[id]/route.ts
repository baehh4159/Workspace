/**
 * apps/web/src/app/api/projects/[id]/route.ts
 *  - PATCH: Updates project title, visibility, or status (active | archived) via userClient RLS
 *  - DELETE: Deletes a project via userClient RLS (owner-only delete policy)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema, VisibilitySchema } from '@workspace/core/schemas';
import { getAuthenticatedContext } from '@/lib/supabase-server';

const PatchProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    visibility: VisibilitySchema.optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine(
    (d) => d.title !== undefined || d.visibility !== undefined || d.status !== undefined,
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

  const parsed = PatchProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) payload.title = parsed.data.title;
  if (parsed.data.visibility !== undefined) payload.visibility = parsed.data.visibility;
  if (parsed.data.status !== undefined) payload.status = parsed.data.status;

  const { data: updated, error } = await ctx.userClient
    .from('projects')
    .update(payload)
    .eq('id', id)
    .select('id, title, visibility, status, updated_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'PROJECT_UPDATE_FAILED' }, { status: 403 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ project: updated }, { status: 200 });
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
    .from('projects')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'PROJECT_DELETE_FAILED' }, { status: 500 });
  }
  if (!deleted) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id: deleted.id }, { status: 200 });
}
