/**
 * apps/web/src/app/api/events/route.ts
 * Creates a native workspace event (all-day + timezone aware) via RLS-scoped userClient.
 */
import { NextResponse } from 'next/server';
import { CreateEventSchema } from '@workspace/core/schemas';
import { getAuthenticatedContext } from '@/lib/supabase-server';

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

  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const input = parsed.data;

  // Verify projectId access upfront via userClient RLS if linking to a project
  if (input.projectId) {
    const { data: proj } = await ctx.userClient
      .from('projects')
      .select('id')
      .eq('id', input.projectId)
      .eq('workspace_id', input.workspaceId)
      .maybeSingle();

    if (!proj) {
      return NextResponse.json({ error: 'FORBIDDEN_PROJECT' }, { status: 403 });
    }
  }

  const { data: event, error } = await ctx.userClient
    .from('events')
    .insert({
      workspace_id: input.workspaceId,
      project_id: input.projectId ?? null,
      owner_user_id: ctx.user.id,
      visibility: input.visibility,
      title: input.title,
      is_all_day: input.isAllDay,
      timezone: input.timezone,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      location: input.location ?? null,
    })
    .select(
      'id, workspace_id, project_id, owner_user_id, visibility, title, is_all_day, timezone, starts_at, ends_at, location'
    )
    .single();

  if (error || !event) {
    return NextResponse.json({ error: 'EVENT_CREATE_FAILED' }, { status: 403 });
  }

  return NextResponse.json({ event }, { status: 201 });
}
