/**
 * apps/mobile/app/scan-ingest.tsx
 * Deep-link receiver for external scanner apps:
 *   universal-workspace://scan-ingest?uri=file:///...&fileName=doc.pdf&mimeType=application/pdf&pageCount=3&scanId=abc
 * Uploads immediately via ingestScannedDocument() and automatically falls back to offline queue on network failure.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useWorkspace } from '@/lib/workspace-context';
import { ingestScannedDocument, type ExistingScannerOutput } from '@/lib/scanner-bridge';
import { ApiHttpError } from '@/lib/workspace-api';
import { enqueueOfflineItem } from '@/lib/offline-queue';

const ALLOWED_SCAN_MIMES = new Set<ExistingScannerOutput['mimeType']>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

export default function ScanIngestDeepLinkScreen() {
  const router = useRouter();
  const { loading, isAuthenticated, activeWorkspace } = useWorkspace();
  const params = useLocalSearchParams<{
    uri?: string;
    fileName?: string;
    mimeType?: string;
    pageCount?: string;
    scanId?: string;
    title?: string;
    visibility?: string;
  }>();

  const [state, setState] = useState<'working' | 'done' | 'queued' | 'error'>('working');
  const [message, setMessage] = useState('스캔 문서를 입력함으로 전송하는 중...');

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated || !activeWorkspace) {
      setState('error');
      setMessage('로그인이 필요합니다. 먼저 로그인한 뒤 다시 스캔을 전송해 주세요.');
      return;
    }

    const localUri = typeof params.uri === 'string' ? params.uri : '';
    const fileName = typeof params.fileName === 'string' && params.fileName ? params.fileName : 'scan.pdf';
    const rawMime = typeof params.mimeType === 'string' ? params.mimeType : 'application/pdf';
    const mimeType = ALLOWED_SCAN_MIMES.has(rawMime as ExistingScannerOutput['mimeType'])
      ? (rawMime as ExistingScannerOutput['mimeType'])
      : 'application/pdf';
    const pageCount = Math.max(1, Number.parseInt(String(params.pageCount ?? '1'), 10) || 1);
    const scanId = typeof params.scanId === 'string' && params.scanId.length >= 4
      ? params.scanId
      : Crypto.randomUUID();
    const visibility = params.visibility === 'team' ? 'team' : 'private';
    const title = typeof params.title === 'string' && params.title.trim() ? params.title.trim() : fileName;

    if (!localUri.startsWith('file://')) {
      setState('error');
      setMessage('유효한 로컬 파일 URI(file://)가 전달되지 않았습니다.');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await ingestScannedDocument(
          { scanId, localUri, fileName, mimeType, pageCount, suggestedTitle: title },
          { workspaceId: activeWorkspace.id, visibility }
        );
        if (cancelled) return;
        setState('done');
        setMessage(`입력함에 저장 완료: ${res.item.title ?? fileName}`);
      } catch (err) {
        if (cancelled) return;
        const isTransient = !(err instanceof ApiHttpError) || err.status >= 500 || err.status === 429;
        if (isTransient) {
          await enqueueOfflineItem({
            kind: 'scanner_doc',
            idempotencyKey: `scanner:${scanId}`,
            workspaceId: activeWorkspace.id,
            localUri,
            fileName,
            contentType: mimeType,
            title,
            pageCount,
            visibility,
            tagIds: [],
          });
          setState('queued');
          setMessage('오프라인 상태여서 대기열에 임시 저장했습니다. 연결 복구 시 자동 전송됩니다.');
        } else {
          setState('error');
          setMessage('스캔 문서 업로드에 실패했습니다. 파일 크기나 권한을 확인해 주세요.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, isAuthenticated, activeWorkspace, params]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>
          {state === 'working' && '스캔 문서 수신 중'}
          {state === 'done' && '입력함 저장 완료'}
          {state === 'queued' && '오프라인 대기열 저장 완료'}
          {state === 'error' && '전송 실패'}
        </Text>
        <Text style={styles.body}>{message}</Text>

        {state !== 'working' && (
          <Pressable
            onPress={() => router.replace(isAuthenticated ? '/(tabs)/inbox' : '/login')}
            style={styles.btn}
          >
            <Text style={styles.btnText}>
              {isAuthenticated ? '입력함으로 이동' : '로그인 화면으로 이동'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 22,
    gap: 12,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  body: { fontSize: 13, color: '#475569', lineHeight: 19 },
  btn: {
    marginTop: 4,
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
});
