'use client';

/**
 * apps/web/src/components/inbox-upload-zone.tsx
 * Web upload for scanned documents (PDF / images): click or drag & drop anywhere on the page.
 * Each file goes through the same 2-step upload as the mobile scanner, then AI reading starts
 * automatically so the summary and detected deadline appear on the card.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DOCUMENT_ACCEPT,
  InboxUploadError,
  describeAiError,
  describeUploadError,
  resolveDocumentMime,
  runAiProcessing,
  titleFromFileName,
  uploadAndIngest,
} from '@/lib/upload-client';

type UploadState = 'uploading' | 'reading' | 'done' | 'error';

interface UploadEntry {
  key: string;
  name: string;
  state: UploadState;
  note?: string;
}

export function InboxUploadZone({
  workspaceId,
  onUploaded,
  onUpsell,
}: {
  workspaceId: string;
  onUploaded: () => void;
  onUpsell: (reason: 'ai_quota' | 'storage') => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const update = (key: string, patch: Partial<UploadEntry>) =>
    setEntries((cur) => cur.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const processFiles = useCallback(
    async (files: File[]) => {
      const queued = files.map((file, i) => ({
        file,
        key: `${Date.now()}-${i}-${file.name}`,
      }));
      setEntries((cur) => [
        ...cur.filter((e) => e.state === 'uploading' || e.state === 'reading'),
        ...queued.map(({ file, key }) => ({ key, name: file.name, state: 'uploading' as const })),
      ]);

      for (const { file, key } of queued) {
        try {
          const contentType = resolveDocumentMime(file);
          if (!contentType) throw new InboxUploadError('UNSUPPORTED_TYPE', 415);

          const { itemId } = await uploadAndIngest({
            workspaceId,
            blob: file,
            fileName: file.name,
            contentType,
            sourceType: 'scanner_doc',
            title: titleFromFileName(file.name),
          });
          update(key, { state: 'reading' });
          onUploaded();

          const ai = await runAiProcessing(itemId);
          if (ai.ok) {
            update(key, { state: 'done', note: 'AI가 읽었습니다' });
          } else {
            if (ai.code === 'AI_QUOTA_EXCEEDED') onUpsell('ai_quota');
            update(key, { state: 'done', note: `올렸지만 ${describeAiError(ai.code)}` });
          }
          onUploaded();
        } catch (err) {
          if (err instanceof InboxUploadError && err.code === 'FREE_STORAGE_LIMIT_EXCEEDED') {
            onUpsell('storage');
          }
          update(key, { state: 'error', note: describeUploadError(err) });
        }
      }
    },
    [onUploaded, onUpsell, workspaceId]
  );

  // Page-wide drag & drop
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) void processFiles(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [processFiles]);

  const busy = entries.some((e) => e.state === 'uploading' || e.state === 'reading');

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3">
        <p className="text-xs text-slate-600">
          <span className="font-semibold text-slate-800">PDF·사진을 끌어다 놓으세요.</span> AI가 읽고 마감일과 금액을 찾아 줍니다.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          {busy ? '올리는 중…' : '파일 올리기'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={DOCUMENT_ACCEPT}
          className="hidden"
          aria-label="입력함에 올릴 문서 선택"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) void processFiles(files);
          }}
        />
      </div>

      {entries.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-live="polite">
          {entries.map((entry) => (
            <li
              key={entry.key}
              className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200"
            >
              <span className="truncate text-slate-700">{entry.name}</span>
              <span
                className={`shrink-0 font-medium ${
                  entry.state === 'error'
                    ? 'text-red-700'
                    : entry.state === 'done'
                      ? 'text-emerald-700'
                      : 'text-blue-700'
                }`}
              >
                {entry.state === 'uploading'
                  ? '올리는 중…'
                  : entry.state === 'reading'
                    ? 'AI가 읽는 중…'
                    : entry.note}
              </span>
            </li>
          ))}
          {!busy && (
            <li>
              <button
                type="button"
                onClick={() => setEntries([])}
                className="text-[11px] text-slate-400 hover:text-slate-600"
              >
                목록 지우기
              </button>
            </li>
          )}
        </ul>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-blue-700/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-blue-600 bg-white px-8 py-6 text-center shadow-xl">
            <p className="text-sm font-semibold text-slate-900">여기에 놓으면 입력함에 추가됩니다</p>
            <p className="mt-1 text-xs text-slate-500">PDF · JPG · PNG · WEBP · HEIC, 파일당 50MB까지</p>
          </div>
        </div>
      )}
    </div>
  );
}
