/**
 * apps/web/src/lib/reminder-job.ts
 * Server-side push jobs for the maintenance cron:
 *  - runDeadlineReminders(): "오늘/내일 마감" and "마감이 지났어요" pushes (once per task per stage)
 *  - pushToUser(): one-off push to every device of a user (used for original-file expiry warnings)
 *
 * Demo mode, or PUSH_DRY_RUN=1, logs the messages instead of calling Expo.
 * EXPO_ACCESS_TOKEN is sent when set (needed if "enhanced push security" is on in Expo).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEMO_MODE } from '@/lib/demo/mock-supabase';
import { sendExpoPush, type ExpoPushMessage, type ExpoPushResult } from '@/lib/push';
import {
  isQuietHourKst,
  planReminder,
  reminderWindows,
  type PlannedReminder,
  type ReminderStage,
} from '@/lib/reminders';

const SENT_COLUMN: Record<ReminderStage, 'due_reminder_sent_at' | 'overdue_reminder_sent_at'> = {
  due_soon: 'due_reminder_sent_at',
  overdue: 'overdue_reminder_sent_at',
};

async function deliver(messages: ExpoPushMessage[]): Promise<ExpoPushResult[]> {
  if (messages.length === 0) return [];
  if (DEMO_MODE || process.env.PUSH_DRY_RUN === '1') {
    console.info('[PUSH_DRY_RUN]', messages.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data })));
    return messages.map((m) => ({ to: m.to, ok: true }));
  }
  return sendExpoPush(messages, { accessToken: process.env.EXPO_ACCESS_TOKEN || undefined });
}

async function tokensByUser(
  adminClient: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string[]> | null> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await adminClient
    .from('user_push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', userIds);
  if (error) return null;
  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const token = row.expo_push_token as string | null;
    if (!token) continue;
    const list = map.get(row.user_id as string) ?? [];
    list.push(token);
    map.set(row.user_id as string, list);
  }
  return map;
}

async function removeDeadTokens(adminClient: SupabaseClient, results: ExpoPushResult[]): Promise<number> {
  const dead = [...new Set(results.filter((r) => r.error === 'DeviceNotRegistered').map((r) => r.to))];
  if (dead.length === 0) return 0;
  await adminClient.from('user_push_tokens').delete().in('expo_push_token', dead);
  return dead.length;
}

export async function pushToUser(
  adminClient: SupabaseClient,
  userId: string,
  content: { title: string; body: string; data: Record<string, string> }
): Promise<'sent' | 'no_device' | 'failed'> {
  const tokens = await tokensByUser(adminClient, [userId]);
  if (!tokens) return 'failed';
  const devices = tokens.get(userId) ?? [];
  if (devices.length === 0) return 'no_device';
  const results = await deliver(
    devices.map((to) => ({ to, ...content, sound: 'default' as const, channelId: 'default' }))
  );
  await removeDeadTokens(adminClient, results);
  return results.some((r) => r.ok) ? 'sent' : 'failed';
}

export interface ReminderJobReport {
  ok: boolean;
  skipped?: 'quiet_hours';
  error?: string;
  planned?: number;
  pushed?: number;
  noDevice?: number;
  retryLater?: number;
  removedTokens?: number;
}

export async function runDeadlineReminders(
  adminClient: SupabaseClient,
  now: Date = new Date()
): Promise<ReminderJobReport> {
  if (isQuietHourKst(now)) return { ok: true, skipped: 'quiet_hours' };

  const w = reminderWindows(now);
  const columns = 'id, title, due_at, assignee_user_id';
  const [soonRes, overdueRes] = await Promise.all([
    adminClient
      .from('tasks')
      .select(columns)
      .neq('status', 'done')
      .is('due_reminder_sent_at', null)
      .gt('due_at', w.dueSoonFromIso)
      .lte('due_at', w.dueSoonToIso)
      .order('due_at', { ascending: true })
      .limit(200),
    adminClient
      .from('tasks')
      .select(columns)
      .neq('status', 'done')
      .is('overdue_reminder_sent_at', null)
      .gt('due_at', w.overdueFromIso)
      .lte('due_at', w.overdueToIso)
      .order('due_at', { ascending: true })
      .limit(200),
  ]);
  if (soonRes.error || overdueRes.error) {
    return { ok: false, error: (soonRes.error ?? overdueRes.error)?.message ?? 'QUERY_FAILED' };
  }

  const toTask = (row: Record<string, unknown>) => ({
    id: row.id as string,
    title: row.title as string,
    dueAt: row.due_at as string,
    userId: row.assignee_user_id as string,
  });
  const planned: PlannedReminder[] = [
    ...(soonRes.data ?? []).map((row) => planReminder(toTask(row), 'due_soon', now)),
    ...(overdueRes.data ?? []).map((row) => planReminder(toTask(row), 'overdue', now)),
  ];
  if (planned.length === 0) return { ok: true, planned: 0, pushed: 0 };

  const tokens = await tokensByUser(adminClient, [...new Set(planned.map((p) => p.userId))]);
  if (!tokens) return { ok: false, error: 'TOKEN_QUERY_FAILED' };

  const outgoing: Array<{ reminder: PlannedReminder; message: ExpoPushMessage }> = planned.flatMap((reminder) =>
    (tokens.get(reminder.userId) ?? []).map((to) => ({
      reminder,
      message: {
        to,
        title: reminder.title,
        body: reminder.body,
        sound: 'default' as const,
        channelId: 'default',
        data: { type: 'task_reminder', taskId: reminder.taskId, stage: reminder.stage },
      },
    }))
  );
  const results = await deliver(outgoing.map((o) => o.message));
  const removedTokens = await removeDeadTokens(adminClient, results);

  // Mark a reminder as handled when it reached a device, when the user has no device,
  // or when every device turned out to be unregistered. Network/HTTP failures retry next run.
  const outcome = new Map<string, { ok: number; transientFail: number }>();
  outgoing.forEach((o, i) => {
    const key = `${o.reminder.taskId}:${o.reminder.stage}`;
    const entry = outcome.get(key) ?? { ok: 0, transientFail: 0 };
    const r = results[i];
    if (r?.ok) entry.ok += 1;
    else if (r?.error !== 'DeviceNotRegistered') entry.transientFail += 1;
    outcome.set(key, entry);
  });

  const handled: Record<ReminderStage, string[]> = { due_soon: [], overdue: [] };
  let pushed = 0;
  let noDevice = 0;
  let retryLater = 0;
  for (const reminder of planned) {
    const entry = outcome.get(`${reminder.taskId}:${reminder.stage}`);
    if (!entry) {
      noDevice += 1;
      handled[reminder.stage].push(reminder.taskId);
    } else if (entry.ok > 0) {
      pushed += 1;
      handled[reminder.stage].push(reminder.taskId);
    } else if (entry.transientFail > 0) {
      retryLater += 1;
    } else {
      noDevice += 1;
      handled[reminder.stage].push(reminder.taskId);
    }
  }

  const sentAt = now.toISOString();
  for (const stage of ['due_soon', 'overdue'] as const) {
    if (handled[stage].length === 0) continue;
    const { error } = await adminClient
      .from('tasks')
      .update({ [SENT_COLUMN[stage]]: sentAt })
      .in('id', handled[stage]);
    if (error) return { ok: false, error: error.message, planned: planned.length, pushed };
  }

  return { ok: retryLater === 0, planned: planned.length, pushed, noDevice, retryLater, removedTokens };
}
