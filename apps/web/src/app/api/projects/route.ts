/**
 * apps/web/src/app/api/projects/route.ts
 * Creates a new project in the active workspace via RLS-scoped userClient.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UuidSchema, VisibilitySchema } from '@workspace/core/schemas';
import { getAuthenticatedContext } from '@/lib/supabase-server';

const CreateProjectBodySchema = z.object({
  workspaceId: UuidSchema,
  title: z.string().trim().min(1).max(200),
  visibility: VisibilitySchema.default('private'),
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

  const parsed = CreateProjectBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { workspaceId, title, visibility } = parsed.data;

  // userClient RLS verifies active workspace membership and owner_user_id = auth.uid()
  const { data: project, error } = await ctx.userClient
    .from('projects')
    .insert({
      workspace_id: workspaceId,
      owner_user_id: ctx.user.id,
      title,
      visibility,
      status: 'active',
    })
    .select('id, workspace_id, title, visibility, status, created_at, updated_at')
    .single();

  if (error || !project) {
    return NextResponse.json({ error: 'PROJECT_CREATE_FAILED' }, { status: 403 });
  }

  return NextResponse.json({ project }, { status: 201 });
}
