-- =============================================================================
-- Phase 3 Migration: Scheduled Maintenance Jobs
--  1. processing_started_at for accurate 5-minute zombie-lock recovery
--  2. expiry_notified_7d_at / 1d_at for idempotent free-plan expiry warnings
--  3. service_role-only RPCs:
--     - recover_stale_ai_locks(p_stale_minutes)
--     - auto_fold_stale_inbox_items(p_days)
--     - list_expired_free_originals(p_batch_size)
-- =============================================================================

alter table public.inbox_items
  add column if not exists processing_started_at timestamptz,
  add column if not exists expiry_notified_7d_at timestamptz,
  add column if not exists expiry_notified_1d_at timestamptz;

create index if not exists idx_inbox_processing_stale
  on public.inbox_items (processing_started_at)
  where processing_status = 'processing';

create index if not exists idx_inbox_unprocessed_autofold
  on public.inbox_items (created_at)
  where triage_status = 'unprocessed';

-- -----------------------------------------------------------------------------
-- 1) Recover Stale AI Locks (> 5 min reserved ledger & > 5 min processing inbox)
-- -----------------------------------------------------------------------------
create or replace function public.recover_stale_ai_locks(p_stale_minutes int default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz;
  v_ledger_row record;
  v_released_count int := 0;
  v_recovered_inbox_count int := 0;
begin
  if p_stale_minutes is null or p_stale_minutes < 1 then
    raise exception 'INVALID_STALE_MINUTES';
  end if;

  v_cutoff := now() - make_interval(mins => p_stale_minutes);

  -- Release stale reserved quota ledger rows safely with SKIP LOCKED
  for v_ledger_row in
    select id
    from public.ai_usage_ledger
    where status = 'reserved'
      and created_at < v_cutoff
    order by created_at asc
    limit 200
    for update skip locked
  loop
    perform public.finalize_ai_quota(v_ledger_row.id, 'released', null);
    v_released_count := v_released_count + 1;
  end loop;

  -- Flip zombie processing inbox_items to failed (original file remains protected)
  with updated as (
    update public.inbox_items
    set processing_status = 'failed',
        processing_started_at = null
    where processing_status = 'processing'
      and coalesce(processing_started_at, created_at) < v_cutoff
    returning id
  )
  select count(*)::int into v_recovered_inbox_count from updated;

  return jsonb_build_object(
    'released_ledger_count', v_released_count,
    'recovered_inbox_count', v_recovered_inbox_count
  );
end;
$$;

revoke all on function public.recover_stale_ai_locks(int) from public;
grant execute on function public.recover_stale_ai_locks(int) to service_role;

-- -----------------------------------------------------------------------------
-- 2) Auto-Fold Unprocessed Inbox Items Older Than 7 Days (Inbox Zero UX)
-- -----------------------------------------------------------------------------
create or replace function public.auto_fold_stale_inbox_items(p_days int default 7)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folded_count int := 0;
begin
  if p_days is null or p_days < 1 then
    raise exception 'INVALID_DAYS';
  end if;

  with folded as (
    update public.inbox_items
    set triage_status = 'auto_folded'
    where triage_status = 'unprocessed'
      and created_at < (now() - make_interval(days => p_days))
    returning id
  )
  select count(*)::int into v_folded_count from folded;

  return v_folded_count;
end;
$$;

revoke all on function public.auto_fold_stale_inbox_items(int) from public;
grant execute on function public.auto_fold_stale_inbox_items(int) to service_role;

-- -----------------------------------------------------------------------------
-- 3) List Expired Free-Plan Originals Eligible for Purge (Skips failed items)
-- -----------------------------------------------------------------------------
create or replace function public.list_expired_free_originals(p_batch_size int default 100)
returns table (
  id uuid,
  workspace_id uuid,
  storage_path text,
  file_size_bytes bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int;
begin
  v_limit := greatest(1, least(coalesce(p_batch_size, 100), 500));

  return query
  select i.id, i.workspace_id, i.storage_path, i.file_size_bytes
  from public.inbox_items i
  join public.workspaces w on w.id = i.workspace_id
  where w.plan = 'free'
    and i.storage_path is not null
    and i.original_purged_at is null
    and i.processing_status <> 'failed'
    and i.original_expires_at is not null
    and i.original_expires_at <= now()
  order by i.original_expires_at asc
  limit v_limit;
end;
$$;

revoke all on function public.list_expired_free_originals(int) from public;
grant execute on function public.list_expired_free_originals(int) to service_role;
