/**
 * apps/web/src/app/api/inbox/upload-url/route.ts
 * Step 1 of 2-step upload: validates MIME & size against workspace quota
 * and issues a workspace-scoped Private Storage signed upload URL.
 */
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { FREE_PLAN_LIMITS, RequestUploadUrlSchema } from '@workspace/core/schemas';
import {
  assertActiveWorkspaceMember,
  getAuthenticatedContext,
  PRIVATE_STORAGE_BUCKET,
} from '@/lib/supabase-server';

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/m4a': 'm4a',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
};

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

  const parsed = RequestUploadUrlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { workspaceId, sourceType, contentType, fileSizeBytes } = parsed.data;
  const membership = await assertActiveWorkspaceMember(ctx.adminClient, workspaceId, ctx.user.id);
  if (!membership) {
    return NextResponse.json({ error: 'FORBIDDEN_WORKSPACE' }, { status: 403 });
  }

  // Pre-check free-plan 500 MB cap (final atomic enforcement also runs on /ingest)
  if (
    membership.plan === 'free' &&
    membership.storageUsedBytes + fileSizeBytes > FREE_PLAN_LIMITS.STORAGE_BYTES
  ) {
    return NextResponse.json(
      {
        error: 'FREE_STORAGE_LIMIT_EXCEEDED',
        limitBytes: FREE_PLAN_LIMITS.STORAGE_BYTES,
        usedBytes: membership.storageUsedBytes,
      },
      { status: 402 }
    );
  }

  // Cross-check sourceType vs MIME family before issuing upload URL
  const isAudio = contentType.startsWith('audio/');
  if (sourceType === 'scanner_doc' && isAudio) {
    return NextResponse.json({ error: 'INVALID_MIME_FOR_SCANNER_DOC' }, { status: 400 });
  }
  if (sourceType === 'quick_voice' && !isAudio) {
    return NextResponse.json({ error: 'INVALID_MIME_FOR_QUICK_VOICE' }, { status: 400 });
  }

  const ext = MIME_TO_EXT[contentType] ?? 'bin';
  const storagePath = `${workspaceId}/${ctx.user.id}/${crypto.randomUUID()}.${ext}`;

  const { data: signed, error: signErr } = await ctx.adminClient.storage
    .from(PRIVATE_STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (signErr || !signed) {
    return NextResponse.json({ error: 'UPLOAD_URL_ISSUE_FAILED' }, { status: 500 });
  }

  return NextResponse.json(
    {
      uploadUrl: signed.signedUrl,
      uploadToken: signed.token,
      storagePath,
      expectedContentType: contentType,
      maxContentLengthBytes: fileSizeBytes,
    },
    { status: 201 }
  );
}
