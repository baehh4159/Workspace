/**
 * apps/mobile/src/lib/offline-queue.ts
 * Persistent offline capture queue backed by AsyncStorage + FileSystem.documentDirectory:
 *  - Preserves quick_capture, quick_voice (copies localUri out of volatile cache), and scanner_doc
 *  - Retries with the original idempotencyKey so foreground/network recovery never creates duplicates
 *  - Race-condition safe flush: re-reads the latest AsyncStorage queue after uploads complete and
 *    removes only the idempotencyKeys resolved during this flush so concurrent enqueues are never overwritten
 */
import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import {
  ApiHttpError,
  createQuickCapture,
  uploadAndIngestFile,
  type UploadableMimeType,
} from '@/lib/workspace-api';

const QUEUE_STORAGE_KEY = 'ws_offline_capture_queue_v1';
const OFFLINE_FILES_DIR = `${FileSystem.documentDirectory ?? ''}offline-queue/`;

export type OfflineQueueItem =
  | {
      kind: 'quick_capture';
      idempotencyKey: string;
      workspaceId: string;
      rawText?: string;
      tagIds: string[];
      visibility: 'private' | 'team';
      enqueuedAt: string;
    }
  | {
      kind: 'quick_voice';
      idempotencyKey: string;
      workspaceId: string;
      localUri: string;
      fileName: string;
      audioSeconds: number;
      visibility: 'private' | 'team';
      tagIds: string[];
      enqueuedAt: string;
    }
  | {
      kind: 'scanner_doc';
      idempotencyKey: string;
      workspaceId: string;
      localUri: string;
      fileName: string;
      contentType: UploadableMimeType;
      title?: string;
      pageCount: number;
      visibility: 'private' | 'team';
      tagIds: string[];
      enqueuedAt: string;
    };

/**
 * A queue item before it is stamped with enqueuedAt.
 * (Plain Omit<Union, K> would collapse the union to its shared fields and lose localUri/fileName/etc.)
 */
export type NewOfflineQueueItem = OfflineQueueItem extends infer T
  ? T extends OfflineQueueItem
    ? Omit<T, 'enqueuedAt'>
    : never
  : never;

type QueueListener = (count: number) => void;
const listeners = new Set<QueueListener>();
let flushing = false;

function notifyListeners(count: number) {
  listeners.forEach((fn) => fn(count));
}

async function readQueue(): Promise<OfflineQueueItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineQueueItem[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: OfflineQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
  notifyListeners(items.length);
}

async function persistLocalFile(srcUri: string, idempotencyKey: string, fileName: string): Promise<string> {
  if (!FileSystem.documentDirectory) return srcUri;
  await FileSystem.makeDirectoryAsync(OFFLINE_FILES_DIR, { intermediates: true }).catch(() => {});
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const destUri = `${OFFLINE_FILES_DIR}${idempotencyKey.replace(/[^a-zA-Z0-9_-]/g, '_')}-${safeName}`;
  if (srcUri === destUri) return destUri;
  await FileSystem.copyAsync({ from: srcUri, to: destUri });
  return destUri;
}

export async function enqueueOfflineItem(
  item: NewOfflineQueueItem
): Promise<void> {
  const queue = await readQueue();
  if (queue.some((q) => q.idempotencyKey === item.idempotencyKey)) {
    return;
  }

  let prepared: OfflineQueueItem;
  if (item.kind === 'quick_voice' || item.kind === 'scanner_doc') {
    const persistedUri = await persistLocalFile(item.localUri, item.idempotencyKey, item.fileName);
    prepared = {
      ...item,
      localUri: persistedUri,
      enqueuedAt: new Date().toISOString(),
    };
  } else {
    prepared = {
      ...item,
      enqueuedAt: new Date().toISOString(),
    };
  }

  queue.push(prepared);
  await writeQueue(queue);
}

export async function getOfflineQueueCount(): Promise<number> {
  const q = await readQueue();
  return q.length;
}

function isPermanentClientError(err: unknown): boolean {
  if (!(err instanceof ApiHttpError)) return false;
  return err.status === 400 || err.status === 403 || err.status === 404 || err.status === 410;
}

export async function flushOfflineQueue(): Promise<{ synced: number; remaining: number }> {
  if (flushing) {
    return { synced: 0, remaining: await getOfflineQueueCount() };
  }
  flushing = true;

  try {
    const snapshot = await readQueue();
    if (snapshot.length === 0) {
      notifyListeners(0);
      return { synced: 0, remaining: 0 };
    }

    const resolvedKeys = new Set<string>();
    let synced = 0;

    for (const item of snapshot) {
      try {
        if (item.kind === 'quick_capture') {
          await createQuickCapture({
            workspaceId: item.workspaceId,
            rawText: item.rawText,
            tagIds: item.tagIds,
            visibility: item.visibility,
            idempotencyKey: item.idempotencyKey,
          });
        } else if (item.kind === 'quick_voice') {
          await uploadAndIngestFile({
            workspaceId: item.workspaceId,
            localUri: item.localUri,
            fileName: item.fileName,
            contentType: 'audio/m4a',
            sourceType: 'quick_voice',
            visibility: item.visibility,
            title: `음성 메모 (${item.audioSeconds}초)`,
            audioSeconds: item.audioSeconds,
            tagIds: item.tagIds,
            idempotencyKey: item.idempotencyKey,
          });
          await FileSystem.deleteAsync(item.localUri, { idempotent: true }).catch(() => {});
        } else if (item.kind === 'scanner_doc') {
          await uploadAndIngestFile({
            workspaceId: item.workspaceId,
            localUri: item.localUri,
            fileName: item.fileName,
            contentType: item.contentType,
            sourceType: 'scanner_doc',
            visibility: item.visibility,
            title: item.title ?? item.fileName,
            pageCount: item.pageCount,
            tagIds: item.tagIds,
            idempotencyKey: item.idempotencyKey,
          });
          await FileSystem.deleteAsync(item.localUri, { idempotent: true }).catch(() => {});
        }
        resolvedKeys.add(item.idempotencyKey);
        synced += 1;
      } catch (err) {
        if (isPermanentClientError(err)) {
          if (item.kind === 'quick_voice' || item.kind === 'scanner_doc') {
            await FileSystem.deleteAsync(item.localUri, { idempotent: true }).catch(() => {});
          }
          resolvedKeys.add(item.idempotencyKey);
        }
      }
    }

    // Re-read latest queue before writing so items enqueued mid-flush are never overwritten
    const latestQueue = await readQueue();
    const nextQueue = latestQueue.filter((item) => !resolvedKeys.has(item.idempotencyKey));
    await writeQueue(nextQueue);
    return { synced, remaining: nextQueue.length };
  } finally {
    flushing = false;
  }
}

export function useOfflineQueueSync(enabled: boolean): number {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const listener: QueueListener = (count) => setPendingCount(count);
    listeners.add(listener);
    void getOfflineQueueCount().then(setPendingCount);

    if (enabled) {
      void flushOfflineQueue();
    }

    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active' && enabled) {
        void flushOfflineQueue();
      }
    });

    return () => {
      listeners.delete(listener);
      sub.remove();
    };
  }, [enabled]);

  return pendingCount;
}
