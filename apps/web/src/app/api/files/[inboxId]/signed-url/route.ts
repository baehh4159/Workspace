/**
 * apps/web/src/app/api/files/[inboxId]/signed-url/route.ts
 * Issues a short-lived (120s) Private Storage Signed URL after verifying RLS visibility via userClient.
 */
import { NextResponse } from 'next/server';
import { UuidSchema } from '@workspace/core/schemas';
import {
  getAuthenticatedContext,
  PRIVATE_STORAGE_BUCKET,
} from '@/lib/supabase-server';

const SIGNED_URL_TTL_SECONDS = 120;

export async function GET(
  req: Request,
  context: { params: Promise<{ inboxId: string }> }
) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { inboxId } = await context.params;
  if (!UuidSchema.safeParse(inboxId).success) {
    return NextResponse.json({ error: 'INVALID_UUID' }, { status: 400 });
  }

  // userClient enforces active workspace membership + private/team visibility via RLS
  const { data: item, error: itemErr } = await ctx.userClient
    .from('inbox_items')
    .select('id, storage_path, original_purged_at')
    .eq('id', inboxId)
    .maybeSingle();

  if (itemErr) {
    return NextResponse.json({ error: 'INBOX_LOOKUP_FAILED' }, { status: 500 });
  }
  if (!item) {
    return NextResponse.json({ error: 'NOT_FOUND_OR_FORBIDDEN' }, { status: 404 });
  }
  if (!item.storage_path || item.original_purged_at) {
    return NextResponse.json({ error: 'ORIGINAL_PURGED_OR_MISSING' }, { status: 410 });
  }

  const { data: signed, error: signErr } = await ctx.adminClient.storage
    .from(PRIVATE_STORAGE_BUCKET)
    .createSignedUrl(item.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: 'SIGNED_URL_FAILED' }, { status: 500 });
  }

  return NextResponse.json(
    {
      signedUrl: signed.signedUrl,
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
