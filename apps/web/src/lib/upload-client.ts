/**
 * apps/web/src/lib/upload-client.ts
 * Browser helpers for the existing 2-step upload contract (same as the mobile app):
 *   POST /api/inbox/upload-url → PUT bytes to the signed URL → POST /api/inbox/ingest
 * plus a wrapper for POST /api/inbox/[id]/ai-process.
 */

export type UploadSourceType = 'scanner_doc' | 'quick_voice';

export class InboxUploadError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number
  ) {
    super(code);
    this.name = 'InboxUploadError';
  }
}

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const DOC_TYPES_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

const ALLOWED_DOC_TYPES = new Set(Object.values(DOC_TYPES_BY_EXT));
const ALLOWED_AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/m4a', 'audio/mpeg', 'audio/wav']);

/** Accept attribute for <input type="file"> (documents only). */
export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic';

/** Returns the upload MIME type for a scanned document, or null when the file type is not supported. */
export function resolveDocumentMime(file: File): string | null {
  const declared = file.type.split(';')[0].trim().toLowerCase();
  if (ALLOWED_DOC_TYPES.has(declared)) return declared;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return DOC_TYPES_BY_EXT[ext] ?? null;
}

/** Normalizes MediaRecorder output ("audio/webm;codecs=opus") to an allowed upload MIME type. */
export function resolveAudioMime(blobType: string): string | null {
  const base = blobType.split(';')[0].trim().toLowerCase();
  return ALLOWED_AUDIO_TYPES.has(base) ? base : null;
}

export function titleFromFileName(fileName: string): string {
  const withoutExt = fileName.replace(/\.[^.]+$/, '').trim();
  return (withoutExt || '올린 문서').slice(0, 200);
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP_${res.status}`;
  } catch {
    return `HTTP_${res.status}`;
  }
}

export async function uploadAndIngest(params: {
  workspaceId: string;
  blob: Blob;
  fileName: string;
  contentType: string;
  sourceType: UploadSourceType;
  visibility?: 'private' | 'team';
  title?: string;
  audioSeconds?: number;
  tagIds?: string[];
}): Promise<{ itemId: string }> {
  if (params.blob.size <= 0) throw new InboxUploadError('EMPTY_FILE', 400);
  if (params.blob.size > MAX_UPLOAD_BYTES) throw new InboxUploadError('FILE_TOO_LARGE', 413);

  const urlRes = await fetch('/api/inbox/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      sourceType: params.sourceType,
      contentType: params.contentType,
      fileSizeBytes: params.blob.size,
      fileName: params.fileName.slice(0, 200),
    }),
  });
  if (!urlRes.ok) throw new InboxUploadError(await readError(urlRes), urlRes.status);
  const meta = (await urlRes.json()) as { uploadUrl: string; storagePath: string; expectedContentType: string };

  const putRes = await fetch(meta.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': meta.expectedContentType },
    body: params.blob,
  });
  if (!putRes.ok) throw new InboxUploadError(`STORAGE_PUT_FAILED`, putRes.status);

  const ingestRes = await fetch('/api/inbox/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: params.workspaceId,
      sourceType: params.sourceType,
      idempotencyKey: newIdempotencyKey(),
      visibility: params.visibility ?? 'private',
      storagePath: meta.storagePath,
      fileSizeBytes: params.blob.size,
      title: params.title,
      audioSeconds: params.audioSeconds,
      tagIds: params.tagIds ?? [],
    }),
  });
  if (!ingestRes.ok) throw new InboxUploadError(await readError(ingestRes), ingestRes.status);
  const data = (await ingestRes.json()) as { item: { id: string } };
  return { itemId: data.item.id };
}

export type AiRunResult =
  | { ok: true }
  | { ok: false; code: 'AI_QUOTA_EXCEEDED' | 'ORIGINAL_FILE_UNAVAILABLE' | 'AI_NOT_CONFIGURED' | 'FAILED' };

export async function runAiProcessing(itemId: string): Promise<AiRunResult> {
  try {
    const res = await fetch(`/api/inbox/${itemId}/ai-process`, { method: 'POST' });
    if (res.ok) return { ok: true };
    const code = await readError(res);
    if (res.status === 402 || code === 'AI_QUOTA_EXCEEDED') return { ok: false, code: 'AI_QUOTA_EXCEEDED' };
    if (code === 'ALREADY_PROCESSING_OR_SUCCEEDED') return { ok: true };
    if (code === 'ORIGINAL_FILE_UNAVAILABLE') return { ok: false, code: 'ORIGINAL_FILE_UNAVAILABLE' };
    if (code === 'AI_PROVIDER_NOT_CONFIGURED') return { ok: false, code: 'AI_NOT_CONFIGURED' };
    return { ok: false, code: 'FAILED' };
  } catch {
    return { ok: false, code: 'FAILED' };
  }
}

/** User-facing Korean message for upload/AI failures (null = handled by an upgrade prompt). */
export function describeUploadError(err: unknown): string {
  const code = err instanceof InboxUploadError ? err.code : 'UNKNOWN';
  switch (code) {
    case 'FREE_STORAGE_LIMIT_EXCEEDED':
      return '무료 저장 용량(500MB)이 가득 찼습니다.';
    case 'FILE_TOO_LARGE':
    case 'FILE_SIZE_MISMATCH_OR_EXCEEDED':
    case 'DEMO_FILE_TOO_LARGE':
      return '파일이 너무 큽니다. 50MB 이하 파일만 올릴 수 있습니다.';
    case 'UNSUPPORTED_TYPE':
      return 'PDF, JPG, PNG, WEBP, HEIC 파일만 올릴 수 있습니다.';
    case 'EMPTY_FILE':
      return '빈 파일은 올릴 수 없습니다.';
    default:
      return '파일을 올리지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

export function describeAiError(code: Exclude<AiRunResult, { ok: true }>['code']): string {
  switch (code) {
    case 'AI_QUOTA_EXCEEDED':
      return '이번 달 AI 한도를 모두 썼습니다.';
    case 'ORIGINAL_FILE_UNAVAILABLE':
      return '원본 파일이 없어 AI로 읽을 수 없습니다.';
    case 'AI_NOT_CONFIGURED':
      return 'AI 기능이 아직 설정되지 않았습니다. (관리자: AI_PROVIDER_ENDPOINT·AI_PROVIDER_API_KEY 설정 필요)';
    default:
      return 'AI가 문서를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
