/**
 * apps/mobile/app/(tabs)/inbox.tsx
 * Mobile 2-Second One-Touch Triage Inbox with Long-Press / ⋯ 3-Zone Action Sheet parity:
 *  - Delete error rollback safely restores only the failed item without clobbering concurrent state updates
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getAccessToken, supabaseMobile } from '@/lib/supabase-mobile';
import { useWorkspace } from '@/lib/workspace-context';
import { triageInboxItem } from '@/lib/workspace-api';
import { ActionSheetModal, type MobileActionItem } from '@/components/action-sheet-modal';

interface MobileInboxItem {
  id: string;
  sourceType: 'scanner_doc' | 'quick_tag' | 'quick_text' | 'quick_voice';
  title: string | null;
  summaryText: string | null;
  rawText: string | null;
  visibility: 'private' | 'team';
  triageStatus: 'unprocessed' | 'auto_folded';
  isOwner: boolean;
}

interface MobileProjectOption {
  id: string;
  title: string;
  visibility: 'private' | 'team';
}

type PendingTriagePayload =
  | { action: 'convert_to_task'; taskTitle: string }
  | { action: 'link_to_project'; projectId: string }
  | { action: 'archive' };

interface PendingCommit {
  item: MobileInboxItem;
  payload: PendingTriagePayload;
  label: string;
}

const SOURCE_ICON: Record<MobileInboxItem['sourceType'], { emoji: string; bg: string }> = {
  scanner_doc: { emoji: '📄', bg: '#EFF6FF' },
  quick_voice: { emoji: '🎙️', bg: '#FEF2F2' },
  quick_tag: { emoji: '🏷️', bg: '#F1F5F9' },
  quick_text: { emoji: '📝', bg: '#F8FAFC' },
};

export default function MobileInboxScreen() {
  const { activeWorkspace } = useWorkspace();
  const [items, setItems] = useState<MobileInboxItem[]>([]);
  const [projects, setProjects] = useState<MobileProjectOption[]>([]);
  const [showAutoFolded, setShowAutoFolded] = useState(false);
  const [projectPickerItem, setProjectPickerItem] = useState<MobileInboxItem | null>(null);
  const [sheetItem, setSheetItem] = useState<MobileInboxItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pendingRef = useRef<PendingCommit | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsIdRef = useRef<string | null>(activeWorkspace?.id ?? null);
  wsIdRef.current = activeWorkspace?.id ?? null;

  const unprocessed = useMemo(
    () => items.filter((i) => i.triageStatus === 'unprocessed'),
    [items]
  );
  const autoFolded = useMemo(
    () => items.filter((i) => i.triageStatus === 'auto_folded'),
    [items]
  );

  const loadInbox = useCallback(async () => {
    if (!activeWorkspace) return;
    setRefreshing(true);
    try {
      const wsId = activeWorkspace.id;
      const [userRes, inboxRes, projRes] = await Promise.all([
        supabaseMobile.auth.getUser(),
        supabaseMobile
          .from('inbox_items')
          .select('id, owner_user_id, source_type, title, summary_text, raw_text, visibility, triage_status')
          .eq('workspace_id', wsId)
          .in('triage_status', ['unprocessed', 'auto_folded'])
          .order('created_at', { ascending: false })
          .limit(50),
        supabaseMobile
          .from('projects')
          .select('id, title, visibility')
          .eq('workspace_id', wsId)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(30),
      ]);

      const currentUserId = userRes.data.user?.id ?? '';
      setItems(
        (inboxRes.data ?? []).map((row) => ({
          id: row.id as string,
          sourceType: row.source_type as MobileInboxItem['sourceType'],
          title: (row.title as string | null) ?? null,
          summaryText: (row.summary_text as string | null) ?? null,
          rawText: (row.raw_text as string | null) ?? null,
          visibility: row.visibility as 'private' | 'team',
          triageStatus: row.triage_status as 'unprocessed' | 'auto_folded',
          isOwner: row.owner_user_id === currentUserId,
        }))
      );
      setProjects(
        (projRes.data ?? []).map((p) => ({
          id: p.id as string,
          title: p.title as string,
          visibility: p.visibility as 'private' | 'team',
        }))
      );
    } finally {
      setRefreshing(false);
    }
  }, [activeWorkspace]);

  const flushPending = useCallback((isUnmounting = false) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    const wsId = wsIdRef.current;
    if (!pending || !wsId) return;
    pendingRef.current = null;

    if (!isUnmounting) setUndoLabel(null);

    void triageInboxItem(pending.item.id, {
      workspaceId: wsId,
      ...pending.payload,
    }).catch(() => {
      if (!isUnmounting) {
        setItems((cur) => (cur.some((i) => i.id === pending.item.id) ? cur : [pending.item, ...cur]));
        setErrorMsg('처리에 실패해 항목을 원래 상태로 복구했습니다.');
      }
    });
  }, []);

  useEffect(() => {
    void loadInbox();
    return () => {
      flushPending(true);
    };
  }, [loadInbox, flushPending]);

  const queueTriage = (item: MobileInboxItem, payload: PendingTriagePayload, label: string) => {
    flushPending(false);
    setErrorMsg(null);
    setItems((prev) => prev.filter((i) => i.id !== item.id));

    pendingRef.current = { item, payload, label };
    setUndoLabel(label);

    timerRef.current = setTimeout(() => {
      flushPending(false);
    }, 5000);
  };

  const handleUndo = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    setUndoLabel(null);
    if (pending) {
      setItems((cur) => (cur.some((i) => i.id === pending.item.id) ? cur : [pending.item, ...cur]));
    }
  };

  const handleToggleVisibility = async (item: MobileInboxItem) => {
    const prevVis = item.visibility;
    const nextVis: 'private' | 'team' = prevVis === 'private' ? 'team' : 'private';
    setErrorMsg(null);
    setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, visibility: nextVis } : i)));
    try {
      const token = await getAccessToken();
      const base = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ?? '';
      const res = await fetch(`${base}/api/inbox/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ visibility: nextVis }),
      });
      if (!res.ok) throw new Error('FAILED');
    } catch {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, visibility: prevVis } : i)));
      setErrorMsg('공개 범위 변경에 실패해 원래 상태로 복구했습니다.');
    }
  };

  const confirmDelete = (item: MobileInboxItem) => {
    Alert.alert('항목 삭제', '이 항목과 원본 파일을 영구 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          flushPending(false);
          setErrorMsg(null);
          setItems((cur) => cur.filter((i) => i.id !== item.id));
          void (async () => {
            try {
              const token = await getAccessToken();
              const base = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ?? '';
              const res = await fetch(`${base}/api/inbox/${item.id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              });
              if (!res.ok) throw new Error('FAILED');
            } catch {
              // Restore only the failed item without clobbering concurrent state updates
              setItems((cur) => (cur.some((i) => i.id === item.id) ? cur : [item, ...cur]));
              setErrorMsg('항목 삭제에 실패해 원래 상태로 복구했습니다.');
            }
          })();
        },
      },
    ]);
  };

  const buildSheetItems = (item: MobileInboxItem): MobileActionItem[] => {
    const actions: MobileActionItem[] = [
      {
        id: 'to-task',
        label: '할 일로 전환',
        group: 1,
        onSelect: () =>
          queueTriage(
            item,
            {
              action: 'convert_to_task',
              taskTitle: item.title || item.rawText?.slice(0, 80) || '새 할 일',
            },
            '할 일로 전환했습니다'
          ),
      },
    ];
    if (projects.length > 0) {
      actions.push({
        id: 'link-project',
        label: '프로젝트에 연결',
        group: 1,
        onSelect: () => setProjectPickerItem(item),
      });
    }
    if (item.isOwner) {
      actions.push({
        id: 'toggle-vis',
        label: item.visibility === 'private' ? '팀 공유로 전환' : '나만 보기로 전환',
        group: 2,
        tone: 'owner',
        onSelect: () => void handleToggleVisibility(item),
      });
    }
    actions.push({
      id: 'archive',
      label: '보관함으로 이동',
      group: 3,
      onSelect: () => queueTriage(item, { action: 'archive' }, '보관함으로 이동했습니다'),
    });
    if (item.isOwner) {
      actions.push({
        id: 'delete',
        label: '항목 삭제',
        group: 3,
        tone: 'danger',
        onSelect: () => confirmDelete(item),
      });
    }
    return actions;
  };

  const renderCard = (item: MobileInboxItem) => {
    const iconMeta = SOURCE_ICON[item.sourceType] ?? SOURCE_ICON.quick_text;
    return (
      <Pressable
        key={item.id}
        delayLongPress={350}
        onLongPress={() => setSheetItem(item)}
        style={styles.card}
      >
        <View style={styles.cardTopRow}>
          <View style={[styles.sourceIconBox, { backgroundColor: iconMeta.bg }]}>
            <Text style={styles.sourceIconText}>{iconMeta.emoji}</Text>
          </View>

          <View style={styles.cardTextCol}>
            <View style={styles.cardHeader}>
              <Text numberOfLines={1} style={styles.cardTitle}>
                {item.title || item.rawText?.slice(0, 60) || '제목 없는 항목'}
              </Text>
              <View style={styles.headerRight}>
                <View
                  style={[
                    styles.visBadge,
                    item.visibility === 'team' ? styles.visTeam : styles.visPrivate,
                  ]}
                >
                  <Text
                    style={[
                      styles.visText,
                      item.visibility === 'team' ? styles.visTeamText : styles.visPrivateText,
                    ]}
                  >
                    {item.visibility === 'team' ? '👥 팀 공유' : '🔒 나만 보기'}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setSheetItem(item)}
                  hitSlop={8}
                  style={styles.moreBtn}
                >
                  <Text style={styles.moreBtnText}>⋯</Text>
                </Pressable>
              </View>
            </View>

            {(item.summaryText || item.rawText) && (
              <Text numberOfLines={2} style={styles.cardBody}>
                {item.summaryText || item.rawText}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={() =>
              queueTriage(
                item,
                {
                  action: 'convert_to_task',
                  taskTitle: item.title || item.rawText?.slice(0, 80) || '새 할 일',
                },
                '할 일로 전환했습니다'
              )
            }
            style={styles.primaryBtn}
          >
            <Text style={styles.primaryBtnText}>할 일로</Text>
          </Pressable>

          {projects.length > 0 && (
            <Pressable onPress={() => setProjectPickerItem(item)} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>프로젝트</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => queueTriage(item, { action: 'archive' }, '보관함으로 이동했습니다')}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryBtnText}>보관</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.wrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadInbox()} />}
      >
        {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

        {unprocessed.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>미처리 항목이 없습니다</Text>
            <Text style={styles.muted}>
              스캔 문서나 빠른 기록이 들어오면 여기에서 2초 만에 정리할 수 있습니다.
            </Text>
          </View>
        ) : (
          unprocessed.map(renderCard)
        )}

        {autoFolded.length > 0 && (
          <View style={styles.foldedSection}>
            <Pressable
              onPress={() => setShowAutoFolded((v) => !v)}
              style={styles.foldedHeader}
            >
              <Text style={styles.foldedTitle}>
                7일 이상 지난 자동 접힘 항목 ({autoFolded.length}건)
              </Text>
              <Text style={styles.foldedToggle}>{showAutoFolded ? '접기 ▲' : '펼치기 ▼'}</Text>
            </Pressable>
            {showAutoFolded && <View style={styles.foldedList}>{autoFolded.map(renderCard)}</View>}
          </View>
        )}
      </ScrollView>

      {sheetItem && (
        <ActionSheetModal
          visible
          title={sheetItem.title || sheetItem.rawText?.slice(0, 40) || '입력함 항목'}
          items={buildSheetItems(sheetItem)}
          onClose={() => setSheetItem(null)}
        />
      )}

      <Modal
        visible={projectPickerItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setProjectPickerItem(null)}
      >
        <Pressable style={styles.backdrop} onPress={() => setProjectPickerItem(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>연결할 프로젝트 선택</Text>
            <View style={styles.projList}>
              {projects.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    const target = projectPickerItem;
                    setProjectPickerItem(null);
                    if (target) {
                      queueTriage(
                        target,
                        { action: 'link_to_project', projectId: p.id },
                        `'${p.title}'에 연결했습니다`
                      );
                    }
                  }}
                  style={styles.projItem}
                >
                  <Text style={styles.projTitle}>{p.title}</Text>
                  <Text style={styles.projVis}>{p.visibility === 'team' ? '팀' : '나만'}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {undoLabel && (
        <View style={styles.undoBar}>
          <Text style={styles.undoText}>{undoLabel}</Text>
          <Pressable onPress={handleUndo}>
            <Text style={styles.undoAction}>실행 취소</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: '#F7F8FA' },
  container: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 84 },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  muted: { fontSize: 12, color: '#64748B', textAlign: 'center' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    gap: 10,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sourceIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceIconText: { fontSize: 18 },
  cardTextCol: { flex: 1, gap: 4 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' },
  visBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  visPrivate: { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
  visTeam: { backgroundColor: '#F0FDFA', borderColor: '#99F6E4' },
  visText: { fontSize: 11, fontWeight: '600' },
  visPrivateText: { color: '#475569' },
  visTeamText: { color: '#115E59' },
  moreBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  moreBtnText: { fontSize: 16, fontWeight: '700', color: '#94A3B8' },
  cardBody: { fontSize: 13, color: '#475569', lineHeight: 18 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#1D4ED8',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  primaryBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  foldedSection: { marginTop: 8, gap: 10 },
  foldedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  foldedTitle: { fontSize: 12, fontWeight: '600', color: '#475569' },
  foldedToggle: { fontSize: 12, fontWeight: '600', color: '#1D4ED8' },
  foldedList: { gap: 10 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, gap: 12 },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  projList: { gap: 8 },
  projItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  projTitle: { fontSize: 13, fontWeight: '600', color: '#0F172A' },
  projVis: { fontSize: 11, color: '#64748B' },
  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  undoText: { fontSize: 13, color: '#FFFFFF' },
  undoAction: { fontSize: 13, fontWeight: '700', color: '#93C5FD' },
  errorText: { fontSize: 12, color: '#DC2626' },
});
