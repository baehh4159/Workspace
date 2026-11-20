/**
 * apps/web/src/app/api/records/route.ts
 * Creates a record with independent per-record visibility (private | team) and
 * optionally links it to a project via entity_links (verifying project access first).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema, VisibilitySchema } from '@workspace/core/schemas';
import { getAuthenticatedContext } from '@/lib/supabase-server';

const CreateRecordBodySchema = z.object({
  workspaceId: UuidSchema,
  contentMarkdown: z.string().trim().min(1).max(20000),
  visibility: VisibilitySchema.default('private'),
  projectId: UuidSchema.optional(),
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

  const parsed = CreateRecordBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { workspaceId, contentMarkdown, visibility, projectId } = parsed.data;

  // Verify user can access target project before creating any record or link
  if (projectId) {
    const { data: proj } = await ctx.userClient
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!proj) {
      return NextResponse.json({ error: 'FORBIDDEN_PROJECT' }, { status: 403 });
    }
  }

  const { data: record, error: recErr } = await ctx.userClient
    .from('records')
    .insert({
      workspace_id: workspaceId,
      author_user_id: ctx.user.id,
      visibility,
      content_markdown: contentMarkdown,
    })
    .select('id, workspace_id, author_user_id, visibility, content_markdown, created_at, updated_at')
    .single();

  if (recErr || !record) {
    return NextResponse.json({ error: 'RECORD_CREATE_FAILED' }, { status: 403 });
  }

  if (projectId) {
    const { error: linkErr } = await ctx.adminClient.from('entity_links').insert({
      workspace_id: workspaceId,
      from_type: 'project',
      from_id: projectId,
      to_type: 'record',
      to_id: record.id,
      created_by: ctx.user.id,
    });

    if (linkErr) {
      // Roll back orphan record if link fails so project detail stays consistent
      await ctx.adminClient.from('records').delete().eq('id', record.id);
      return NextResponse.json({ error: 'RECORD_LINK_FAILED' }, { status: 500 });
    }
  }

  return NextResponse.json({ record }, { status: 201 });
}
