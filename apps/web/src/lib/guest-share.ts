/**
 * apps/web/src/lib/guest-share.ts
 * Server-only whitelist resolver for unauthenticated guest share tokens.
 *  - Validates token_hash, revocation, and expiry
 *  - STRICT WHITELIST ONLY: never queries or returns private records
 *  - Issues short-lived (120s) Private Storage Signed URL when original exists
 */
import { GuestSharedViewSchema } from '@workspace/core/schemas';
import {
  createAdminClient,
  PRIVATE_STORAGE_BUCKET,
  sha256Hex,
} from '@/lib/supabase-server';

const SIGNED_URL_TTL_SECONDS = 120;

export interface ResolvedGuestShare {
  scope: 'read_only' | 'view_and_join';
  payload: {
    entityType: 'inbox_item' | 'project' | 'task';
    title: string;
    summaryText: string | null;
    signedFileUrl: string | null;
    publicChecklist: Array<{
      id: string;
      title: string;
      status: 'todo' | 'in_progress' | 'waiting' | 'done';
      dueAt: string | null;
    }>;
    expiresAt: string;
  };
}

export async function resolveGuestShareByToken(
  token: string
): Promise<ResolvedGuestShare | null> {
  if (!token || token.length < 16) return null;

  const adminClient = createAdminClient();
  const tokenHash = sha256Hex(token);

  const { data: share, error: shareErr } = await adminClient
    .from('share_tokens')
    .select('workspace_id, entity_type, entity_id, scope, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (
    shareErr ||
    !share ||
    share.revoked_at !== null ||
    new Date(share.expires_at).getTime() <= Date.now()
  ) {
    return null;
  }

  let title = '공유된 항목';
  let summaryText: string | null = null;
  let signedFileUrl: string | null = null;
  let publicChecklist: ResolvedGuestShare['payload']['publicChecklist'] = [];

  if (share.entity_type === 'inbox_item') {
    const { data: item } = await adminClient
      .from('inbox_items')
      .select('title, summary_text, storage_path, original_purged_at')
      .eq('id', share.entity_id)
      .eq('workspace_id', share.workspace_id)
      .maybeSingle();

    if (!item) return null;

    title = item.title ?? '공유된 스캔 문서';
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

    if (!project) return null;
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

    if (!task) return null;
    title = task.title;
    publicChecklist = [
      { id: task.id, title: task.title, status: task.status, dueAt: task.due_at },
    ];
  } else {
    return null;
  }

  const parsed = GuestSharedViewSchema.safeParse({
    entityType: share.entity_type,
    title,
    summaryText,
    signedFileUrl,
    publicChecklist,
    expiresAt: share.expires_at,
  });

  if (!parsed.success) return null;

  return {
    scope: share.scope as 'read_only' | 'view_and_join',
    payload: parsed.data,
  };
}
