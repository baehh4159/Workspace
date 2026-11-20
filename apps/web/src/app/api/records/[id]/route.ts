/**
 * apps/web/src/app/api/records/[id]/route.ts
 *  - PATCH: Updates record visibility or markdown content via userClient RLS (author-only)
 *  - DELETE: Deletes a record via userClient RLS (author-only delete policy)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema, VisibilitySchema } from '@workspace/core/schemas';
import { getAuthenticatedContext } from '@/lib/supabase-server';

const PatchRecordBodySchema = z
  .object({
    visibility: VisibilitySchema.optional(),
    contentMarkdown: z.string().trim().min(1).max(20000).optional(),
  })
  .refine((d) => d.visibility !== undefined || d.contentMarkdown !== undefined, {
    message: 'At least one field (visibility or contentMarkdown) must be provided.',
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

  const parsed = PatchRecordBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = {};
  if (parsed.data.visibility !== undefined) {
    updatePayload.visibility = parsed.data.visibility;
  }
  if (parsed.data.contentMarkdown !== undefined) {
    updatePayload.content_markdown = parsed.data.contentMarkdown;
  }

  const { data: updated, error } = await ctx.userClient
    .from('records')
    .update(updatePayload)
    .eq('id', id)
    .select('id, visibility, content_markdown, updated_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'RECORD_UPDATE_FORBIDDEN_OR_FAILED' }, { status: 403 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ record: updated }, { status: 200 });
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
    .from('records')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'RECORD_DELETE_FAILED' }, { status: 500 });
  }
  if (!deleted) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id: deleted.id }, { status: 200 });
}
