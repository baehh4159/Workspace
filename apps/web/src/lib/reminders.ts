/**
 * apps/web/src/lib/reminders.ts
 * Decides which deadline reminders to send. Pure functions so the cron job stays thin and testable.
 *
 *  - due_soon: open task due within the next 24 hours → "오늘 마감" / "내일 마감"
 *  - overdue:  open task whose due time passed (within the last 7 days) → "마감이 지났어요"
 * Each stage is sent at most once per task (tasks.due_reminder_sent_at / overdue_reminder_sent_at).
 * Nothing is sent during quiet hours (22:00–08:00 KST); those reminders go out at 08:00.
 */

export type ReminderStage = 'due_soon' | 'overdue';

export interface ReminderTask {
  id: string;
  title: string;
  dueAt: string;
  userId: string;
}

export interface PlannedReminder {
  taskId: string;
  stage: ReminderStage;
  userId: string;
  title: string;
  body: string;
}

const KST_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const DUE_SOON_WINDOW_MS = DAY_MS;
export const OVERDUE_LOOKBACK_MS = 7 * DAY_MS;

export function isQuietHourKst(now: Date): boolean {
  const hour = new Date(now.getTime() + KST_OFFSET_MS).getUTCHours();
  return hour >= 22 || hour < 8;
}

function kstDayNumber(date: Date): number {
  return Math.floor((date.getTime() + KST_OFFSET_MS) / DAY_MS);
}

function formatDue(due: Date): string {
  const k = new Date(due.getTime() + KST_OFFSET_MS);
  const hh = String(k.getUTCHours()).padStart(2, '0');
  const mm = String(k.getUTCMinutes()).padStart(2, '0');
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} (${WEEKDAYS[k.getUTCDay()]}) ${hh}:${mm}`;
}

export function planReminder(task: ReminderTask, stage: ReminderStage, now: Date): PlannedReminder {
  const due = new Date(task.dueAt);
  if (stage === 'overdue') {
    return {
      taskId: task.id,
      stage,
      userId: task.userId,
      title: '마감이 지났어요',
      body: `${task.title} · ${formatDue(due)} 마감`,
    };
  }
  const dayDiff = kstDayNumber(due) - kstDayNumber(now);
  return {
    taskId: task.id,
    stage,
    userId: task.userId,
    title: dayDiff <= 0 ? '오늘 마감' : '내일 마감',
    body: `${task.title} · ${formatDue(due)}`,
  };
}

/** Time windows for the two cron queries. */
export function reminderWindows(now: Date): {
  dueSoonFromIso: string;
  dueSoonToIso: string;
  overdueFromIso: string;
  overdueToIso: string;
} {
  const t = now.getTime();
  return {
    dueSoonFromIso: new Date(t).toISOString(),
    dueSoonToIso: new Date(t + DUE_SOON_WINDOW_MS).toISOString(),
    overdueFromIso: new Date(t - OVERDUE_LOOKBACK_MS).toISOString(),
    overdueToIso: new Date(t).toISOString(),
  };
}
