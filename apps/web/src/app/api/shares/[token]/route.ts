/**
 * apps/web/src/app/api/shares/[token]/route.ts
 * Unauthenticated guest view endpoint:
 *  - Validates token_hash, expiry, and revocation
 *  - STRICT WHITELIST ONLY: returns target entity body + public (team) checklist tasks
 *  - NEVER queries or returns private records (records.visibility = 'private')
 *  - Issues short-lived (120s) Signed URL with Cache-Control: no-store
 */
import { NextResponse } from 'next/server';
import { GuestSharedViewSchema } from '@workspace/core/schemas';
import {
  createAdminClient,
  PRIVATE_STORAGE_BUCKET,
  sha256Hex,
} from '@/lib/supabase-server';

const SIGNED_URL_TTL_SECONDS = 120;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(
  _req: Request,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  if (!token || token.length < 16) {
    return NextResponse.json(
      { error: 'INVALID_SHARE_TOKEN' },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  const adminClient = createAdminClient();
  const tokenHash = sha256Hex(token);

  const { data: share, error: shareErr } = await adminClient
    .from('share_tokens')
    .select('workspace_id, entity_type, entity_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (
    shareErr ||
    !share ||
    share.revoked_at !== null ||
    new Date(share.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json(
      { error: 'SHARE_EXPIRED_OR_INVALID' },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  let title = 'Shared Item';
  let summaryText: string | null = null;
  let signedFileUrl: string | null = null;
  let publicChecklist: Array<{
    id: string;
    title: string;
    status: 'todo' | 'in_progress' | 'waiting' | 'done';
    dueAt: string | null;
  }> = [];

  if (share.entity_type === 'inbox_item') {
    const { data: item } = await adminClient
      .from('inbox_items')
      .select('title, summary_text, storage_path, original_purged_at')
      .eq('id', share.entity_id)
      .eq('workspace_id', share.workspace_id)
      .maybeSingle();

    if (!item) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    title = item.title ?? 'Shared Document';
    summaryText = item.summary_text ?? null;

    if (item.storage_path && !item.original_purged_at) {
      const { data: signed } = await adminClient.storage
        .from(PRIVATE_STORAGE_BUCKET)
        .createSignedUrl(item.storage_path, SIGNED_URL_TTL_SECONDS);
      signedFileUrl = signed?.signedUrl ?? null;
    }

    const { data: tasks } = await adminClient
      .from('tasks')
      .select('id, title, status, due_at')
      .eq('workspace_id', share.workspace_id)
      .eq('source_inbox_item_id', share.entity_id)
      .eq('visibility', 'team')
      .order('created_at', { ascending: true });

    publicChecklist = (tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.due_at,
    }));
  } else if (share.entity_type === 'project') {
    const { data: project } = await adminClient
      .from('projects')
      .select('title')
      .eq('id', share.entity_id)
      .eq('workspace_id', share.workspace_id)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    title = project.title;

    const { data: tasks } = await adminClient
      .from('tasks')
      .select('id, title, status, due_at')
      .eq('workspace_id', share.workspace_id)
      .eq('project_id', share.entity_id)
      .eq('visibility', 'team')
      .order('created_at', { ascending: true });

    publicChecklist = (tasks ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.due_at,
    }));
  } else if (share.entity_type === 'task') {
    const { data: task } = await adminClient
      .from('tasks')
      .select('id, title, status, due_at')
      .eq('id', share.entity_id)
      .eq('workspace_id', share.workspace_id)
      .maybeSingle();

    if (!task) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    title = task.title;
    publicChecklist = [
      { id: task.id, title: task.title, status: task.status, dueAt: task.due_at },
    ];
  }

  const payload = GuestSharedViewSchema.parse({
    entityType: share.entity_type,
    title,
    summaryText,
    signedFileUrl,
    publicChecklist,
    expiresAt: share.expires_at,
  });

  return NextResponse.json(payload, { status: 200, headers: NO_STORE_HEADERS });
}
