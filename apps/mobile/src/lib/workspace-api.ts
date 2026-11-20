/**
 * apps/mobile/src/lib/workspace-api.ts
 * Typed Bearer-authenticated API client calling apps/web Next.js Route Handlers:
 *  - 2-step presigned upload (POST /api/inbox/upload-url -> PUT binary -> POST /api/inbox/ingest)
 *  - AI-optional Quick Capture (POST /api/inbox/quick) with caller-supplied idempotencyKey support
 *  - 2-second Inbox Triage (POST /api/inbox/[id]/triage)
 *  - Task Status Toggle (PATCH /api/tasks/[id])
 *  - Push Token Registration (POST/DELETE /api/push/register)
 */
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { getAccessToken, supabaseMobile } from '@/lib/supabase-mobile';

export interface MobileWorkspaceSummary {
  id: string;
  name: string;
  type: 'personal' | 'team';
  plan: 'free' | 'pro' | 'team';
  role: 'owner' | 'member';
}

export interface MobileTag {
  id: string;
  label: string;
  kind: 'status' | 'action_trigger';
  defaultDueOffsetDays: number | null;
}

export type UploadableMimeType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'audio/m4a'
  | 'audio/mp4'
  | 'audio/mpeg'
  | 'audio/webm'
  | 'audio/wav';

export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

function getApiBaseUrl(): string {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/+$/, '');
  if (!base) {
    throw new Error('EXPO_PUBLIC_API_BASE_URL is not configured');
  }
  return base;
}

async function authedJsonFetch<T>(path: string, init: RequestInit): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiHttpError(401, 'UNAUTHORIZED');
  }

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new ApiHttpError(res.status, `API_${res.status}:${errText || res.statusText}`);
  }

  return (await res.json()) as T;
}

export async function fetchActiveWorkspaces(): Promise<MobileWorkspaceSummary[]> {
  const { data: userRes } = await supabaseMobile.auth.getUser();
  if (!userRes.user) return [];

  const { data: rows, error } = await supabaseMobile
    .from('workspace_members')
    .select('role, status, workspaces!inner(id, name, type, plan)')
    .eq('user_id', userRes.user.id)
    .eq('status', 'active');

  if (error || !rows) return [];

  return rows
    .map((r) => {
      const ws = Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces;
      if (!ws) return null;
      return {
        id: ws.id as string,
        name: ws.name as string,
        type: ws.type as 'personal' | 'team',
        plan: ws.plan as 'free' | 'pro' | 'team',
        role: r.role as 'owner' | 'member',
      };
    })
    .filter((w): w is MobileWorkspaceSummary => w !== null);
}

export async function uploadAndIngestFile(params: {
  workspaceId: string;
  localUri: string;
  fileName: string;
  contentType: UploadableMimeType;
  sourceType: 'scanner_doc' | 'quick_voice';
  visibility?: 'private' | 'team';
  title?: string;
  pageCount?: number;
  audioSeconds?: number;
  tagIds?: string[];
  idempotencyKey?: string;
}): Promise<{ item: { id: string; title: string | null } }> {
  const fileInfo = await FileSystem.getInfoAsync(params.localUri);
  if (!fileInfo.exists || typeof fileInfo.size !== 'number' || fileInfo.size <= 0) {
    throw new ApiHttpError(400, 'LOCAL_FILE_MISSING_OR_EMPTY');
  }

  const uploadMeta = await authedJsonFetch<{
    uploadUrl: string;
    storagePath: string;
    expectedContentType: string;
  }>('/api/inbox/upload-url', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      sourceType: params.sourceType,
      contentType: params.contentType,
      fileSizeBytes: fileInfo.size,
      fileName: params.fileName,
    }),
  });

  const putRes = await FileSystem.uploadAsync(uploadMeta.uploadUrl, params.localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      'Content-Type': uploadMeta.expectedContentType,
    },
  });

  if (putRes.status < 200 || putRes.status >= 300) {
    throw new ApiHttpError(putRes.status, `STORAGE_PUT_FAILED_${putRes.status}`);
  }

  return authedJsonFetch<{ item: { id: string; title: string | null } }>('/api/inbox/ingest', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      sourceType: params.sourceType,
      idempotencyKey: params.idempotencyKey ?? Crypto.randomUUID(),
      visibility: params.visibility ?? 'private',
      storagePath: uploadMeta.storagePath,
      fileSizeBytes: fileInfo.size,
      title: params.title,
      pageCount: params.pageCount,
      audioSeconds: params.audioSeconds,
      tagIds: params.tagIds ?? [],
    }),
  });
}

export async function createQuickCapture(params: {
  workspaceId: string;
  rawText?: string;
  tagIds: string[];
  visibility: 'private' | 'team';
  idempotencyKey?: string;
}): Promise<{ item: { id: string } }> {
  const trimmed = params.rawText?.trim() ?? '';
  const sourceType = trimmed.length > 0 ? 'quick_text' : 'quick_tag';

  return authedJsonFetch<{ item: { id: string } }>('/api/inbox/quick', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      sourceType,
      visibility: params.visibility,
      rawText: trimmed.length > 0 ? trimmed : undefined,
      tagIds: params.tagIds,
      idempotencyKey: params.idempotencyKey ?? Crypto.randomUUID(),
    }),
  });
}

export async function triageInboxItem(
  itemId: string,
  payload:
    | { workspaceId: string; action: 'convert_to_task'; taskTitle: string }
    | { workspaceId: string; action: 'link_to_project'; projectId: string }
    | { workspaceId: string; action: 'archive' }
): Promise<void> {
  await authedJsonFetch(`/api/inbox/${itemId}/triage`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTaskStatus(
  taskId: string,
  status: 'todo' | 'in_progress' | 'waiting' | 'done'
): Promise<void> {
  await authedJsonFetch(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function registerExpoPushToken(params: {
  expoPushToken: string;
  platform: 'ios' | 'android' | 'web';
  deviceName?: string;
}): Promise<void> {
  await authedJsonFetch('/api/push/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function unregisterExpoPushToken(expoPushToken: string): Promise<void> {
  await authedJsonFetch('/api/push/register', {
    method: 'DELETE',
    body: JSON.stringify({ expoPushToken }),
  });
}
