-- =============================================================================
-- Phase 9: Deadline reminders (push), sent at most once per task per stage
--  - due_reminder_sent_at:     "오늘/내일 마감" push sent (task due within 24h)
--  - overdue_reminder_sent_at: "마감이 지났어요" push sent
--  - Changing a task's due_at re-arms both reminders.
--  Used by POST /api/cron/maintenance?job=reminders
-- =============================================================================

alter table public.tasks
  add column if not exists due_reminder_sent_at timestamptz,
  add column if not exists overdue_reminder_sent_at timestamptz;

create index if not exists idx_tasks_due_reminder_pending
  on public.tasks (due_at)
  where due_reminder_sent_at is null and due_at is not null and status <> 'done';

create index if not exists idx_tasks_overdue_reminder_pending
  on public.tasks (due_at)
  where overdue_reminder_sent_at is null and due_at is not null and status <> 'done';

create or replace function public.reset_task_reminders_on_due_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.due_at is distinct from old.due_at then
    new.due_reminder_sent_at := null;
    new.overdue_reminder_sent_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_reset_reminders on public.tasks;
create trigger trg_tasks_reset_reminders
  before update of due_at on public.tasks
  for each row execute function public.reset_task_reminders_on_due_change();
