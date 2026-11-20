/**
 * apps/mobile/src/components/quick-capture-bar.tsx
 * Native Mobile Quick Capture (3s Tag -> 10s Text -> 30s Voice):
 *  - Unified Teal (#F0FDFA / #115E59 / #99F6E4) team visibility badge matching Web
 *  - Full-width recording controls while recording (prevents cramped input on 375px screens)
 *  - Uses refs so 30s auto-stop never hits stale closures + offline queue fallback on network error
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Audio } from 'expo-av';
import * as Crypto from 'expo-crypto';
import {
  ApiHttpError,
  createQuickCapture,
  uploadAndIngestFile,
  type MobileTag,
} from '@/lib/workspace-api';
import { enqueueOfflineItem } from '@/lib/offline-queue';

const MAX_VOICE_SECONDS = 30;

function formatTimer(sec: number): string {
  return `00:${String(sec).padStart(2, '0')}`;
}

function shouldQueueOffline(err: unknown): boolean {
  if (!(err instanceof ApiHttpError)) return true;
  return err.status >= 500 || err.status === 429;
}

export function QuickCaptureBar({
  workspaceId,
  tags,
  onCaptured,
}: {
  workspaceId: string;
  tags: MobileTag[];
  onCaptured?: () => void;
}) {
  const [rawText, setRawText] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'private' | 'team'>('private');
  const [submitting, setSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [statusNotice, setStatusNotice] = useState<{ kind: 'error' | 'queued'; text: string } | null>(
    null
  );

  const workspaceIdRef = useRef(workspaceId);
  const selectedTagIdsRef = useRef(selectedTagIds);
  const visibilityRef = useRef(visibility);
  const onCapturedRef = useRef(onCaptured);
  workspaceIdRef.current = workspaceId;
  selectedTagIdsRef.current = selectedTagIds;
  visibilityRef.current = visibility;
  onCapturedRef.current = onCaptured;

  const recordingRef = useRef<Audio.Recording | null>(null);
  const elapsedRef = useRef(0);

  const stopAndUploadVoice = useCallback(async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    if (!rec) return;

    const currentWsId = workspaceIdRef.current;
    const currentTags = selectedTagIdsRef.current;
    const currentVisibility = visibilityRef.current;

    setSubmitting(true);
    setStatusNotice(null);
    let uri: string | null = null;
    const idempotencyKey = Crypto.randomUUID();
    const audioSeconds = Math.max(1, Math.min(MAX_VOICE_SECONDS, elapsedRef.current || 1));
    const fileName = `voice-${Date.now()}.m4a`;

    try {
      await rec.stopAndUnloadAsync();
      uri = rec.getURI();
      if (!uri) {
        setStatusNotice({ kind: 'error', text: '녹음 파일을 찾을 수 없습니다.' });
        return;
      }

      await uploadAndIngestFile({
        workspaceId: currentWsId,
        localUri: uri,
        fileName,
        contentType: 'audio/m4a',
        sourceType: 'quick_voice',
        visibility: currentVisibility,
        title: `음성 메모 (${audioSeconds}초)`,
        audioSeconds,
        tagIds: currentTags,
        idempotencyKey,
      });

      setSelectedTagIds([]);
      setElapsedSec(0);
      elapsedRef.current = 0;
      onCapturedRef.current?.();
    } catch (err) {
      if (uri && shouldQueueOffline(err)) {
        await enqueueOfflineItem({
          kind: 'quick_voice',
          idempotencyKey,
          workspaceId: currentWsId,
          localUri: uri,
          fileName,
          audioSeconds,
          visibility: currentVisibility,
          tagIds: currentTags,
        });
        setSelectedTagIds([]);
        setElapsedSec(0);
        elapsedRef.current = 0;
        setStatusNotice({
          kind: 'queued',
          text: '오프라인 대기열에 음성 메모를 임시 저장했습니다. 연결 복구 시 자동 전송됩니다.',
        });
      } else {
        setStatusNotice({
          kind: 'error',
          text: '음성 메모 업로드에 실패했습니다. 저장 용량 또는 권한을 확인해 주세요.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      setElapsedSec((prev) => {
        const next = prev + 1;
        elapsedRef.current = next;
        if (next >= MAX_VOICE_SECONDS) {
          void stopAndUploadVoice();
          return MAX_VOICE_SECONDS;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecording, stopAndUploadVoice]);

  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        void recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, []);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleStartVoice = async () => {
    setStatusNotice(null);
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setStatusNotice({
          kind: 'error',
          text: '음성 메모를 사용하려면 마이크 권한을 허용해 주세요.',
        });
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      elapsedRef.current = 0;
      setElapsedSec(0);
      setIsRecording(true);
    } catch {
      setStatusNotice({ kind: 'error', text: '녹음을 시작하지 못했습니다.' });
    }
  };

  const handleCancelVoice = async () => {
    const rec = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    setElapsedSec(0);
    elapsedRef.current = 0;
    if (rec) {
      await rec.stopAndUnloadAsync().catch(() => {});
    }
  };

  const handleSubmitText = async () => {
    if (submitting) return;
    const trimmed = rawText.trim();
    if (!trimmed && selectedTagIds.length === 0) return;

    const idempotencyKey = Crypto.randomUUID();
    setSubmitting(true);
    setStatusNotice(null);
    try {
      await createQuickCapture({
        workspaceId,
        rawText: trimmed,
        tagIds: selectedTagIds,
        visibility,
        idempotencyKey,
      });
      setRawText('');
      setSelectedTagIds([]);
      onCaptured?.();
    } catch (err) {
      if (shouldQueueOffline(err)) {
        await enqueueOfflineItem({
          kind: 'quick_capture',
          idempotencyKey,
          workspaceId,
          rawText: trimmed || undefined,
          tagIds: selectedTagIds,
          visibility,
        });
        setRawText('');
        setSelectedTagIds([]);
        setStatusNotice({
          kind: 'queued',
          text: '오프라인 대기열에 메모를 임시 저장했습니다. 연결 복구 시 자동 전송됩니다.',
        });
      } else {
        setStatusNotice({
          kind: 'error',
          text: '빠른 기록 저장에 실패했습니다. 입력 내용은 그대로 유지됩니다.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagRow}>
          {tags.map((tag) => {
            const selected = selectedTagIds.includes(tag.id);
            const isAction = tag.kind === 'action_trigger';
            return (
              <Pressable
                key={tag.id}
                onPress={() => toggleTag(tag.id)}
                style={[
                  styles.tagChip,
                  isAction ? styles.tagAction : styles.tagStatus,
                  selected && (isAction ? styles.tagActionSelected : styles.tagStatusSelected),
                ]}
              >
                <Text
                  style={[
                    styles.tagText,
                    isAction ? styles.tagActionText : styles.tagStatusText,
                    selected && styles.tagSelectedText,
                  ]}
                >
                  {isAction ? `⚡ ${tag.label}` : tag.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          onPress={() => setVisibility((v) => (v === 'private' ? 'team' : 'private'))}
          style={[
            styles.visBadge,
            visibility === 'team' ? styles.visTeam : styles.visPrivate,
          ]}
        >
          <Text
            style={[
              styles.visText,
              visibility === 'team' ? styles.visTeamText : styles.visPrivateText,
            ]}
          >
            {visibility === 'team' ? '👥 팀 공유' : '🔒 나만 보기'}
          </Text>
        </Pressable>
      </View>

      {isRecording ? (
        <View style={styles.voiceFullBar}>
          <View style={styles.recIndicator}>
            <View style={styles.recDot} />
            <Text style={styles.recTimerText}>녹음 중 {formatTimer(elapsedSec)} / 00:30</Text>
          </View>
          <View style={styles.voiceFullActions}>
            <Pressable onPress={() => void handleCancelVoice()} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>취소</Text>
            </Pressable>
            <Pressable onPress={() => void stopAndUploadVoice()} style={styles.recFinishBtn}>
              <Text style={styles.recFinishText}>완료·저장</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            value={rawText}
            onChangeText={setRawText}
            editable={!submitting}
            placeholder="한 줄 메모 또는 태그로 즉시 기록"
            placeholderTextColor="#94A3B8"
            style={styles.input}
            returnKeyType="done"
            onSubmitEditing={() => void handleSubmitText()}
          />

          <Pressable
            disabled={submitting}
            onPress={() => void handleStartVoice()}
            style={styles.voiceBtn}
          >
            <Text style={styles.voiceBtnText}>30초 음성</Text>
          </Pressable>

          <Pressable
            disabled={submitting}
            onPress={() => void handleSubmitText()}
            style={[styles.saveBtn, submitting && styles.disabledBtn]}
          >
            <Text style={styles.saveBtnText}>{submitting ? '...' : '저장'}</Text>
          </Pressable>
        </View>
      )}

      {statusNotice && (
        <Text style={statusNotice.kind === 'queued' ? styles.queuedText : styles.errorText}>
          {statusNotice.text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tagRow: { gap: 6, paddingRight: 8 },
  tagChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagStatus: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  tagAction: { backgroundColor: '#EFF6FF', borderColor: '#93C5FD' },
  tagStatusSelected: { backgroundColor: '#334155', borderColor: '#334155' },
  tagActionSelected: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  tagText: { fontSize: 12, fontWeight: '600' },
  tagStatusText: { color: '#475569' },
  tagActionText: { color: '#1D4ED8' },
  tagSelectedText: { color: '#FFFFFF' },
  visBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  visPrivate: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
  visTeam: { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' },
  visText: { fontSize: 11, fontWeight: '600' },
  visPrivateText: { color: '#475569' },
  visTeamText: { color: '#115E59' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    flex: 1,
    backgroundColor: '#F7F8FA',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
  },
  voiceBtn: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: '#FFFFFF',
  },
  voiceBtnText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  voiceFullBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 8,
  },
  recIndicator: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#DC2626' },
  recTimerText: { fontSize: 12, fontWeight: '700', color: '#B91C1C' },
  voiceFullActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  cancelText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  recFinishBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  recFinishText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  saveBtn: {
    backgroundColor: '#1D4ED8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  saveBtnText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  disabledBtn: { opacity: 0.55 },
  errorText: { fontSize: 12, color: '#DC2626' },
  queuedText: { fontSize: 12, color: '#1D4ED8' },
});
