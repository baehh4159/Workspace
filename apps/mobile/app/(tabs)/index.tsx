/**
 * apps/mobile/app/(tabs)/index.tsx
 * Mobile Today Screen:
 *  - Unprocessed inbox banner + Offline pending sync pill
 *  - Quick Capture Bar (3s Tag -> 10s Text -> 30s Voice)
 *  - KST Today Native Events section
 *  - Active Tasks checklist with optimistic toggle + rollback
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabaseMobile } from '@/lib/supabase-mobile';
import { useWorkspace } from '@/lib/workspace-context';
import { updateTaskStatus, type MobileTag } from '@/lib/workspace-api';
import { flushOfflineQueue, useOfflineQueueSync } from '@/lib/offline-queue';
import { QuickCaptureBar } from '@/components/quick-capture-bar';

interface MobileEvent {
  id: string;
  title: string;
  isAllDay: boolean;
  timezone: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  visibility: 'private' | 'team';
}

interface MobileTask {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'waiting' | 'done';
  visibility: 'private' | 'team';
}

function getKstDayBounds(now = new Date()): { startIso: string; endIso: string } {
  const kstDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const start = new Date(`${kstDate}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 86_400_000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export default function MobileTodayScreen() {
  const router = useRouter();
  const { loading, isAuthenticated, activeWorkspace } = useWorkspace();
  const pendingOfflineCount = useOfflineQueueSync(isAuthenticated);

  const [refreshing, setRefreshing] = useState(false);
  const [unprocessedCount, setUnprocessedCount] = useState(0);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [tasks, setTasks] = useState<MobileTask[]>([]);
  const [tags, setTags] = useState<MobileTag[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    setRefreshing(true);
    setErrorMsg(null);
    try {
      const wsId = activeWorkspace.id;
      const { startIso, endIso } = getKstDayBounds();

      const [countRes, eventsRes, tasksRes, tagsRes] = await Promise.all([
        supabaseMobile
          .from('inbox_items')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', wsId)
          .eq('triage_status', 'unprocessed'),
        supabaseMobile
          .from('events')
          .select('id, title, is_all_day, timezone, starts_at, ends_at, location, visibility')
          .eq('workspace_id', wsId)
          .lt('starts_at', endIso)
          .gt('ends_at', startIso)
          .order('starts_at', { ascending: true })
          .limit(20),
        supabaseMobile
          .from('tasks')
          .select('id, title, status, visibility')
          .eq('workspace_id', wsId)
          .in('status', ['todo', 'in_progress', 'waiting'])
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(30),
        supabaseMobile
          .from('tags')
          .select('id, label, kind, default_due_offset_days')
          .eq('workspace_id', wsId)
          .order('kind', { ascending: true })
          .order('label', { ascending: true }),
      ]);

      setUnprocessedCount(countRes.count ?? 0);
      setEvents(
        (eventsRes.data ?? []).map((e) => ({
          id: e.id as string,
          title: e.title as string,
          isAllDay: Boolean(e.is_all_day),
          timezone: (e.timezone as string | null) ?? 'Asia/Seoul',
          startsAt: e.starts_at as string,
          endsAt: e.ends_at as string,
          location: (e.location as string | null) ?? null,
          visibility: e.visibility as 'private' | 'team',
        }))
      );
      setTasks(
        (tasksRes.data ?? []).map((t) => ({
          id: t.id as string,
          title: t.title as string,
          status: t.status as MobileTask['status'],
          visibility: t.visibility as 'private' | 'team',
        }))
      );
      setTags(
        (tagsRes.data ?? []).map((tg) => ({
          id: tg.id as string,
          label: tg.label as string,
          kind: tg.kind as MobileTag['kind'],
          defaultDueOffsetDays: (tg.default_due_offset_days as number | null) ?? null,
        }))
      );
    } catch {
      setErrorMsg('데이터를 불러오지 못했습니다.');
    } finally {
      setRefreshing(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleManualSync = async () => {
    await flushOfflineQueue();
    await loadData();
  };

  const handleToggleTask = async (taskId: string) => {
    const target = tasks.find((t) => t.id === taskId);
    if (!target) return;
    const prevStatus = target.status;
    const nextStatus: MobileTask['status'] = prevStatus === 'done' ? 'todo' : 'done';

    setErrorMsg(null);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t)));
    try {
      await updateTaskStatus(taskId, nextStatus);
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: prevStatus } : t)));
      setErrorMsg('할 일 상태 변경에 실패해 원래 상태로 복구했습니다.');
    }
  };

  if (loading || !isAuthenticated || !activeWorkspace) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>워크스페이스 불러오는 중...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData()} />}
    >
      {pendingOfflineCount > 0 && (
        <Pressable onPress={() => void handleManualSync()} style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            오프라인 대기 항목 {pendingOfflineCount}건 · 탭하여 지금 동기화
          </Text>
        </Pressable>
      )}

      {unprocessedCount > 0 && (
        <Pressable onPress={() => router.push('/(tabs)/inbox')} style={styles.banner}>
          <Text style={styles.bannerText}>
            새 스캔·메모 <Text style={styles.bannerAccent}>{unprocessedCount}건</Text> 정리하기
          </Text>
          <Text style={styles.bannerLink}>입력함 →</Text>
        </Pressable>
      )}

      <QuickCaptureBar
        workspaceId={activeWorkspace.id}
        tags={tags}
        onCaptured={() => void loadData()}
      />

      {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

      {/* Native Today Events */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>오늘 일정</Text>
        {events.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.muted}>등록된 오늘 일정이 없습니다.</Text>
          </View>
        ) : (
          events.map((evt) => {
            const tz = evt.timezone || 'Asia/Seoul';
            const timeText = evt.isAllDay
              ? '종일'
              : `${new Date(evt.startsAt).toLocaleTimeString('ko-KR', {
                  timeZone: tz,
                  hour: '2-digit',
                  minute: '2-digit',
                })} – ${new Date(evt.endsAt).toLocaleTimeString('ko-KR', {
                  timeZone: tz,
                  hour: '2-digit',
                  minute: '2-digit',
                })}`;
            return (
              <View key={evt.id} style={styles.eventCard}>
                <View style={styles.eventBody}>
                  <Text style={styles.eventTitle}>{evt.title}</Text>
                  <Text style={styles.eventMeta}>
                    {timeText}
                    {evt.location ? ` · ${evt.location}` : ''}
                  </Text>
                </View>
                <Text style={styles.visPill}>{evt.visibility === 'team' ? '👥 팀' : '🔒 나만'}</Text>
              </View>
            );
          })
        )}
      </View>

      {/* Active Due Tasks */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>오늘 할 일</Text>
        {tasks.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.muted}>오늘 마감할 일이 없습니다.</Text>
          </View>
        ) : (
          tasks.map((task) => {
            const done = task.status === 'done';
            return (
              <Pressable
                key={task.id}
                onPress={() => void handleToggleTask(task.id)}
                style={styles.taskCard}
              >
                <View style={styles.taskLeft}>
                  <View style={[styles.checkbox, done && styles.checkboxDone]}>
                    {done && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.taskTitle, done && styles.taskTitleDone]}>{task.title}</Text>
                </View>
                <Text style={styles.visPill}>{task.visibility === 'team' ? '👥 팀' : '🔒 나만'}</Text>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F8FA' },
  content: { padding: 16, gap: 14, paddingBottom: 28 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F7F8FA' },
  muted: { fontSize: 13, color: '#64748B', textAlign: 'center' },
  offlineBanner: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  offlineText: { fontSize: 12, fontWeight: '600', color: '#1D4ED8', textAlign: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerText: { fontSize: 13, color: '#334155' },
  bannerAccent: { fontWeight: '700', color: '#1D4ED8' },
  bannerLink: { fontSize: 12, fontWeight: '600', color: '#1D4ED8' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#334155' },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  eventBody: { flex: 1, gap: 2 },
  eventTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  eventMeta: { fontSize: 12, color: '#64748B' },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  taskLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: '#1D4ED8', borderColor: '#1D4ED8' },
  checkmark: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  taskTitle: { fontSize: 14, color: '#0F172A', flexShrink: 1 },
  taskTitleDone: { color: '#94A3B8', textDecorationLine: 'line-through' },
  visPill: { fontSize: 11, color: '#64748B', fontWeight: '600' },
  errorText: { fontSize: 12, color: '#DC2626' },
});
