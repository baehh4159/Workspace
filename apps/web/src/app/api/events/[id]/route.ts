/**
 * apps/web/src/app/api/events/[id]/route.ts
 *  - PATCH: Updates native event title, visibility, location, or time range via userClient RLS
 *  - DELETE: Deletes a native event via userClient RLS (owner-only delete policy)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema, VisibilitySchema } from '@workspace/core/schemas';
import { getAuthenticatedContext } from '@/lib/supabase-server';

const PatchEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    visibility: VisibilitySchema.optional(),
    location: z.string().trim().max(250).nullable().optional(),
    isAllDay: z.boolean().optional(),
    startsAt: IsoDateTimeSchema.optional(),
    endsAt: IsoDateTimeSchema.optional(),
  })
  .refine(
    (d) =>
      d.title !== undefined ||
      d.visibility !== undefined ||
      d.location !== undefined ||
      d.isAllDay !== undefined ||
      d.startsAt !== undefined ||
      d.endsAt !== undefined,
    { message: 'At least one field must be provided.' }
  )
  .refine(
    (d) =>
      !d.startsAt || !d.endsAt || new Date(d.endsAt).getTime() > new Date(d.startsAt).getTime(),
    { message: 'endsAt must be after startsAt.' }
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

  const parsed = PatchEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const payload: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) payload.title = parsed.data.title;
  if (parsed.data.visibility !== undefined) payload.visibility = parsed.data.visibility;
  if (parsed.data.location !== undefined) payload.location = parsed.data.location;
  if (parsed.data.isAllDay !== undefined) payload.is_all_day = parsed.data.isAllDay;
  if (parsed.data.startsAt !== undefined) payload.starts_at = parsed.data.startsAt;
  if (parsed.data.endsAt !== undefined) payload.ends_at = parsed.data.endsAt;

  const { data: updated, error } = await ctx.userClient
    .from('events')
    .update(payload)
    .eq('id', id)
    .select('id, title, visibility, location, is_all_day, starts_at, ends_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'EVENT_UPDATE_FAILED' }, { status: 403 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ event: updated }, { status: 200 });
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
    .from('events')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: 'EVENT_DELETE_FAILED' }, { status: 500 });
  }
  if (!deleted) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id: deleted.id }, { status: 200 });
}
