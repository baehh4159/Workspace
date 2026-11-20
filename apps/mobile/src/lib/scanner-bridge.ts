/**
 * apps/mobile/src/lib/scanner-bridge.ts
 * Plug-in adapter connecting the pre-existing native document scanner module
 * directly to the standard 2-step upload + /api/inbox/ingest pipeline.
 */
import { uploadAndIngestFile, type UploadableMimeType } from '@/lib/workspace-api';

export interface ExistingScannerOutput {
  /** External scanner unique scan ID (used directly as idempotencyKey to prevent duplicate ingests) */
  scanId: string;
  /** Local file:// URI produced by the existing scanner */
  localUri: string;
  /** Original filename (e.g. "2026-11-19-contract.pdf") */
  fileName: string;
  mimeType: Extract<
    UploadableMimeType,
    'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'
  >;
  pageCount: number;
  suggestedTitle?: string;
}

export interface ScannerIngestOptions {
  workspaceId: string;
  visibility?: 'private' | 'team';
  tagIds?: string[];
}

/**
 * Single-call bridge invoked by the existing scanner right after PDF/image export completes.
 */
export async function ingestScannedDocument(
  scan: ExistingScannerOutput,
  options: ScannerIngestOptions
) {
  return uploadAndIngestFile({
    workspaceId: options.workspaceId,
    localUri: scan.localUri,
    fileName: scan.fileName,
    contentType: scan.mimeType,
    sourceType: 'scanner_doc',
    visibility: options.visibility ?? 'private',
    title: scan.suggestedTitle ?? scan.fileName,
    pageCount: Math.max(1, scan.pageCount),
    tagIds: options.tagIds ?? [],
    idempotencyKey: `scanner:${scan.scanId}`,
  });
}
