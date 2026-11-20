/**
 * apps/mobile/app/(tabs)/scan.tsx
 * Existing Scanner Integration Screen:
 *  - Unified Teal (#F0FDFA / #115E59 / #99F6E4) team visibility badge matching Web
 *  - Invokes ingestScannedDocument() with automatic offline-queue fallback on network failure
 *  - Documents the universal-workspace://scan-ingest external deep-link contract
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useWorkspace } from '@/lib/workspace-context';
import {
  ingestScannedDocument,
  type ExistingScannerOutput,
} from '@/lib/scanner-bridge';
import { ApiHttpError } from '@/lib/workspace-api';
import { enqueueOfflineItem } from '@/lib/offline-queue';

async function launchExistingScannerModule(): Promise<ExistingScannerOutput | null> {
  return null;
}

export default function MobileScanScreen() {
  const { activeWorkspace } = useWorkspace();
  const [visibility, setVisibility] = useState<'private' | 'team'>('private');
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleLaunchScanner = async () => {
    if (!activeWorkspace || uploading) return;
    setUploading(true);
    setStatus(null);
    let scanResult: ExistingScannerOutput | null = null;
    try {
      scanResult = await launchExistingScannerModule();
      if (!scanResult) {
        setStatus(
          '기존 스캐너 모듈(launchExistingScannerModule) 또는 universal-workspace://scan-ingest 딥링크로 연동할 수 있습니다.'
        );
        return;
      }

      const res = await ingestScannedDocument(scanResult, {
        workspaceId: activeWorkspace.id,
        visibility,
      });
      setStatus(`입력함에 저장 완료: ${res.item.title ?? res.item.id}`);
    } catch (err) {
      const isTransient = !(err instanceof ApiHttpError) || err.status >= 500 || err.status === 429;
      if (scanResult && isTransient) {
        await enqueueOfflineItem({
          kind: 'scanner_doc',
          idempotencyKey: `scanner:${scanResult.scanId}`,
          workspaceId: activeWorkspace.id,
          localUri: scanResult.localUri,
          fileName: scanResult.fileName,
          contentType: scanResult.mimeType,
          title: scanResult.suggestedTitle ?? scanResult.fileName,
          pageCount: Math.max(1, scanResult.pageCount),
          visibility,
          tagIds: [],
        });
        setStatus('오프라인 상태여서 대기열에 임시 저장했습니다. 연결 복구 시 자동 업로드됩니다.');
      } else {
        setStatus('스캔 문서 업로드에 실패했습니다. 네트워크 상태나 저장 용량을 확인해 주세요.');
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>기존 스캐너 연동</Text>
        <Text style={styles.desc}>
          스캔 완료 시 Presigned PUT 업로드 후 입력함(/api/inbox/ingest)에 멱등 저장되며, 오프라인 시 자동 대기열에 보관됩니다.
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>저장 공개 범위</Text>
          <Pressable
            onPress={() => setVisibility((v) => (v === 'private' ? 'team' : 'private'))}
            style={[styles.pill, visibility === 'team' ? styles.pillTeam : styles.pillPrivate]}
          >
            <Text style={[styles.pillText, visibility === 'team' ? styles.pillTeamText : styles.pillPrivateText]}>
              {visibility === 'team' ? '👥 팀 공유' : '🔒 나만 보기 (기본)'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          disabled={uploading || !activeWorkspace}
          onPress={() => void handleLaunchScanner()}
          style={[styles.ctaBtn, (uploading || !activeWorkspace) && styles.disabled]}
        >
          <Text style={styles.ctaText}>
            {uploading ? '업로드 중...' : '스캐너 실행 후 입력함에 저장'}
          </Text>
        </Pressable>

        {status && <Text style={styles.statusText}>{status}</Text>}

        <View style={styles.deepLinkBox}>
          <Text style={styles.deepLinkLabel}>외부 스캐너 앱 딥링크 규격</Text>
          <Text style={styles.deepLinkCode}>
            universal-workspace://scan-ingest?uri=file:///...&amp;fileName=doc.pdf&amp;mimeType=application/pdf&amp;pageCount=1&amp;scanId=unique_id
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA', padding: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    gap: 14,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  desc: { fontSize: 13, color: '#475569', lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '600', color: '#334155' },
  pill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  pillPrivate: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
  pillTeam: { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' },
  pillText: { fontSize: 12, fontWeight: '600' },
  pillPrivateText: { color: '#475569' },
  pillTeamText: { color: '#115E59' },
  ctaBtn: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ctaText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  disabled: { opacity: 0.55 },
  statusText: { fontSize: 12, color: '#334155', lineHeight: 18 },
  deepLinkBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 4,
  },
  deepLinkLabel: { fontSize: 11, fontWeight: '700', color: '#475569' },
  deepLinkCode: { fontSize: 11, color: '#64748B', lineHeight: 16 },
});
