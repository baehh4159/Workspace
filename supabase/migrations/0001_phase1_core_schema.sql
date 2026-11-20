-- =============================================================================
-- Phase 1 Initial Migration: Universal Workspace Core (v2.1 + API Review Patches)
-- Target: Supabase / PostgreSQL 15+
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- -----------------------------------------------------------------------------
-- 1. Workspaces & Members
-- -----------------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  type text not null check (type in ('personal', 'team')),
  plan text not null default 'free' check (plan in ('free', 'pro', 'team')),
  max_seats int not null default 10 check (max_seats between 1 and 10),
  storage_used_bytes bigint not null default 0 check (storage_used_bytes >= 0),
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'deactivated')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index idx_workspace_members_user_active
  on public.workspace_members (user_id, workspace_id)
  where status = 'active';

create or replace function public.is_active_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

revoke all on function public.is_active_workspace_member(uuid) from public;
grant execute on function public.is_active_workspace_member(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Projects
-- -----------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  title text not null check (char_length(trim(title)) > 0),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_projects_workspace on public.projects (workspace_id, status);

-- -----------------------------------------------------------------------------
-- 3. Inbox Items (Existing Scanner Ingest + Quick Capture + OCR Search)
-- -----------------------------------------------------------------------------
create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  source_type text not null check (source_type in ('scanner_doc', 'quick_tag', 'quick_text', 'quick_voice')),
  idempotency_key text,
  title text,
  raw_text text,
  extracted_text text,
  summary_text text,
  ocr_completed_at timestamptz,
  storage_path text,
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  page_count int check (page_count is null or page_count > 0),
  audio_seconds int check (audio_seconds is null or audio_seconds > 0),
  processing_status text not null default 'ready'
    check (processing_status in ('ready', 'processing', 'succeeded', 'failed')),
  user_confirmed_at timestamptz,
  original_expires_at timestamptz,
  original_purged_at timestamptz,
  triage_status text not null default 'unprocessed'
    check (triage_status in ('unprocessed', 'triaged', 'auto_folded', 'archived')),
  created_at timestamptz not null default now()
);

create unique index uq_inbox_idempotency
  on public.inbox_items (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- Prevent replaying the same Private Storage object across multiple inbox_items
create unique index uq_inbox_storage_path
  on public.inbox_items (storage_path)
  where storage_path is not null;

create index idx_inbox_workspace_triage
  on public.inbox_items (workspace_id, triage_status, created_at desc);

create index idx_inbox_original_expiry
  on public.inbox_items (original_expires_at)
  where storage_path is not null and original_purged_at is null and processing_status <> 'failed';

create index idx_inbox_title_trgm on public.inbox_items using gin (title gin_trgm_ops);
create index idx_inbox_raw_text_trgm on public.inbox_items using gin (raw_text gin_trgm_ops);
create index idx_inbox_extracted_text_trgm on public.inbox_items using gin (extracted_text gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- 4. Tags (status vs action_trigger) & Entity-Tag Mapping
-- -----------------------------------------------------------------------------
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  label text not null check (char_length(trim(label)) > 0),
  kind text not null check (kind in ('status', 'action_trigger')),
  default_due_offset_days int check (default_due_offset_days is null or default_due_offset_days >= 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, label)
);

create table public.entity_tags (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  entity_type text not null check (entity_type in ('inbox_item', 'task', 'event', 'project', 'record')),
  entity_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (workspace_id, tag_id, entity_type, entity_id)
);

create index idx_entity_tags_lookup on public.entity_tags (workspace_id, entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- 5. Tasks (Standard UNIQUE on (workspace_id, source_inbox_item_id, source_tag_id))
-- -----------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  source_inbox_item_id uuid references public.inbox_items(id) on delete set null,
  source_tag_id uuid references public.tags(id) on delete set null,
  idempotency_key text,
  owner_user_id uuid not null references auth.users(id),
  assignee_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  title text not null check (char_length(trim(title)) > 0),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'waiting', 'done')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (visibility = 'team' or assignee_user_id = owner_user_id),
  -- Non-partial UNIQUE constraint so PostgREST/Supabase upsert ON CONFLICT works without 42P10
  -- (PostgreSQL treats NULLs as distinct, so manual tasks with NULL source_* are unaffected)
  constraint uq_tasks_inbox_action_tag unique (workspace_id, source_inbox_item_id, source_tag_id)
);

create index idx_tasks_workspace_due on public.tasks (workspace_id, status, due_at);

create unique index uq_tasks_idempotency
  on public.tasks (workspace_id, idempotency_key)
  where idempotency_key is not null;

-- -----------------------------------------------------------------------------
-- 6. Native Events (All-day + Timezone support)
-- -----------------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  owner_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  title text not null check (char_length(trim(title)) > 0),
  is_all_day boolean not null default false,
  timezone text not null default 'Asia/Seoul',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index idx_events_workspace_range on public.events (workspace_id, starts_at, ends_at);

-- -----------------------------------------------------------------------------
-- 7. Records (Independent per-record visibility)
-- -----------------------------------------------------------------------------
create table public.records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  author_user_id uuid not null references auth.users(id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  content_markdown text not null,
  source_inbox_item_id uuid references public.inbox_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_records_workspace_created on public.records (workspace_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 8. Entity Links (Direct SELECT denied; accessed via security RPC only)
-- -----------------------------------------------------------------------------
create table public.entity_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_type text not null check (from_type in ('inbox_item', 'task', 'event', 'project', 'record', 'plugin_entity')),
  from_id uuid not null,
  to_type text not null check (to_type in ('inbox_item', 'task', 'event', 'project', 'record', 'plugin_entity')),
  to_id uuid not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, from_type, from_id, to_type, to_id)
);

create index idx_entity_links_from on public.entity_links (workspace_id, from_type, from_id);
create index idx_entity_links_to on public.entity_links (workspace_id, to_type, to_id);

-- -----------------------------------------------------------------------------
-- 9. Guest Share Tokens (Default 14d, 7/14/30d selectable, instant revoke)
-- -----------------------------------------------------------------------------
create table public.share_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token_hash text unique not null,
  entity_type text not null check (entity_type in ('inbox_item', 'project', 'task')),
  entity_id uuid not null,
  scope text not null default 'view_and_join' check (scope in ('read_only', 'view_and_join')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '14 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_share_tokens_entity on public.share_tokens (workspace_id, entity_type, entity_id);

-- -----------------------------------------------------------------------------
-- 10. AI Monthly Quotas (Reserve -> Commit / Release) & Usage Ledger
-- -----------------------------------------------------------------------------
create table public.workspace_ai_quotas (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period_ym text not null check (period_ym ~ '^\d{4}-\d{2}$'),
  usage_type text not null check (usage_type in ('text_classify', 'doc_ocr_pages', 'voice_stt_seconds')),
  limit_units numeric not null check (limit_units >= 0),
  reserved_units numeric not null default 0 check (reserved_units >= 0),
  used_units numeric not null default 0 check (used_units >= 0),
  primary key (workspace_id, period_ym, usage_type),
  check ((reserved_units + used_units) <= limit_units)
);

create table public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  period_ym text not null check (period_ym ~ '^\d{4}-\d{2}$'),
  usage_type text not null check (usage_type in ('text_classify', 'doc_ocr_pages', 'voice_stt_seconds')),
  units numeric not null check (units > 0),
  status text not null check (status in ('reserved', 'committed', 'released')),
  estimated_cost_usd numeric(10, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_ai_ledger_workspace_period on public.ai_usage_ledger (workspace_id, period_ym, usage_type);

-- =============================================================================
-- Integrity Triggers: updated_at & Immutable Owner/Workspace + Visibility Guard
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_projects_updated_at        before update on public.projects        for each row execute function public.set_updated_at();
create trigger trg_tasks_updated_at           before update on public.tasks           for each row execute function public.set_updated_at();
create trigger trg_records_updated_at         before update on public.records         for each row execute function public.set_updated_at();
create trigger trg_ai_usage_ledger_updated_at before update on public.ai_usage_ledger for each row execute function public.set_updated_at();

create or replace function public.guard_owner_immutable_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'IMMUTABLE_WORKSPACE_ID';
    end if;
    if new.owner_user_id is distinct from old.owner_user_id then
      raise exception 'IMMUTABLE_OWNER_USER_ID';
    end if;
    if new.visibility is distinct from old.visibility and old.owner_user_id <> auth.uid() then
      raise exception 'ONLY_OWNER_CAN_CHANGE_VISIBILITY';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_record_immutable_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    if new.workspace_id is distinct from old.workspace_id then
      raise exception 'IMMUTABLE_WORKSPACE_ID';
    end if;
    if new.author_user_id is distinct from old.author_user_id then
      raise exception 'IMMUTABLE_AUTHOR_USER_ID';
    end if;
    if new.visibility is distinct from old.visibility and old.author_user_id <> auth.uid() then
      raise exception 'ONLY_AUTHOR_CAN_CHANGE_VISIBILITY';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_guard_projects    before update on public.projects    for each row execute function public.guard_owner_immutable_fields();
create trigger trg_guard_inbox_items before update on public.inbox_items for each row execute function public.guard_owner_immutable_fields();
create trigger trg_guard_tasks       before update on public.tasks       for each row execute function public.guard_owner_immutable_fields();
create trigger trg_guard_events      before update on public.events      for each row execute function public.guard_owner_immutable_fields();
create trigger trg_guard_records     before update on public.records     for each row execute function public.guard_record_immutable_fields();

-- =============================================================================
-- Row Level Security (RLS): Active-Member Check + Explicit WITH CHECK + DELETE
-- =============================================================================
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.inbox_items enable row level security;
alter table public.tags enable row level security;
alter table public.entity_tags enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.records enable row level security;
alter table public.entity_links enable row level security;
alter table public.share_tokens enable row level security;
alter table public.workspace_ai_quotas enable row level security;
alter table public.ai_usage_ledger enable row level security;

create policy "workspaces_active_select" on public.workspaces
for select using (public.is_active_workspace_member(id));

create policy "workspace_members_active_select" on public.workspace_members
for select using (public.is_active_workspace_member(workspace_id));

-- Projects
create policy "projects_active_select" on public.projects
for select using (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
);

create policy "projects_active_insert" on public.projects
for insert with check (
  public.is_active_workspace_member(workspace_id)
  and owner_user_id = auth.uid()
);

create policy "projects_active_update" on public.projects
for update using (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
) with check (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
);

create policy "projects_owner_delete" on public.projects
for delete using (
  public.is_active_workspace_member(workspace_id)
  and owner_user_id = auth.uid()
);

-- Inbox Items
create policy "inbox_items_active_select" on public.inbox_items
for select using (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
);

create policy "inbox_items_active_insert" on public.inbox_items
for insert with check (
  public.is_active_workspace_member(workspace_id)
  and owner_user_id = auth.uid()
);

create policy "inbox_items_active_update" on public.inbox_items
for update using (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
) with check (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
);

create policy "inbox_items_owner_delete" on public.inbox_items
for delete using (
  public.is_active_workspace_member(workspace_id)
  and owner_user_id = auth.uid()
);

-- Tags & Entity Tags
create policy "tags_active_all" on public.tags
for all using (public.is_active_workspace_member(workspace_id))
with check (public.is_active_workspace_member(workspace_id));

create policy "entity_tags_deny_direct_select" on public.entity_tags
for select using (false);

create policy "entity_tags_active_insert" on public.entity_tags
for insert with check (
  public.is_active_workspace_member(workspace_id)
  and created_by = auth.uid()
);

create policy "entity_tags_creator_delete" on public.entity_tags
for delete using (
  public.is_active_workspace_member(workspace_id)
  and created_by = auth.uid()
);

-- Tasks
create policy "tasks_active_select" on public.tasks
for select using (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
);

create policy "tasks_active_insert" on public.tasks
for insert with check (
  public.is_active_workspace_member(workspace_id)
  and owner_user_id = auth.uid()
  and (visibility = 'team' or assignee_user_id = auth.uid())
);

create policy "tasks_active_update" on public.tasks
for update using (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
) with check (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
  and (visibility = 'team' or assignee_user_id = owner_user_id)
);

create policy "tasks_owner_delete" on public.tasks
for delete using (
  public.is_active_workspace_member(workspace_id)
  and owner_user_id = auth.uid()
);

-- Events
create policy "events_active_select" on public.events
for select using (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
);

create policy "events_active_insert" on public.events
for insert with check (
  public.is_active_workspace_member(workspace_id)
  and owner_user_id = auth.uid()
);

create policy "events_active_update" on public.events
for update using (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
) with check (
  public.is_active_workspace_member(workspace_id)
  and (owner_user_id = auth.uid() or visibility = 'team')
);

create policy "events_owner_delete" on public.events
for delete using (
  public.is_active_workspace_member(workspace_id)
  and owner_user_id = auth.uid()
);

-- Records
create policy "records_active_select" on public.records
for select using (
  public.is_active_workspace_member(workspace_id)
  and (author_user_id = auth.uid() or visibility = 'team')
);

create policy "records_active_insert" on public.records
for insert with check (
  public.is_active_workspace_member(workspace_id)
  and author_user_id = auth.uid()
);

create policy "records_author_update" on public.records
for update using (
  public.is_active_workspace_member(workspace_id)
  and author_user_id = auth.uid()
) with check (
  public.is_active_workspace_member(workspace_id)
  and author_user_id = auth.uid()
);

create policy "records_author_delete" on public.records
for delete using (
  public.is_active_workspace_member(workspace_id)
  and author_user_id = auth.uid()
);

-- Entity Links
create policy "entity_links_deny_direct_select" on public.entity_links
for select using (false);

create policy "entity_links_active_insert" on public.entity_links
for insert with check (
  public.is_active_workspace_member(workspace_id)
  and created_by = auth.uid()
);

create policy "entity_links_creator_delete" on public.entity_links
for delete using (
  public.is_active_workspace_member(workspace_id)
  and created_by = auth.uid()
);

-- Share Tokens & AI Quotas
create policy "share_tokens_active_select" on public.share_tokens
for select using (public.is_active_workspace_member(workspace_id));

create policy "ai_quotas_active_select" on public.workspace_ai_quotas
for select using (public.is_active_workspace_member(workspace_id));

create policy "ai_ledger_active_select" on public.ai_usage_ledger
for select using (public.is_active_workspace_member(workspace_id));

-- =============================================================================
-- Hardened RPCs
-- =============================================================================
create or replace function public.default_ai_limit(p_plan text, p_usage_type text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_plan = 'free' and p_usage_type = 'doc_ocr_pages'     then 30
    when p_plan = 'free' and p_usage_type = 'voice_stt_seconds' then 900
    when p_plan = 'free' and p_usage_type = 'text_classify'     then 100
    when p_plan = 'pro'  and p_usage_type = 'doc_ocr_pages'     then 500
    when p_plan = 'pro'  and p_usage_type = 'voice_stt_seconds' then 18000
    when p_plan = 'pro'  and p_usage_type = 'text_classify'     then 2000
    when p_plan = 'team' and p_usage_type = 'doc_ocr_pages'     then 1500
    when p_plan = 'team' and p_usage_type = 'voice_stt_seconds' then 54000
    when p_plan = 'team' and p_usage_type = 'text_classify'     then 5000
    else 0
  end;
$$;

-- 1) Reserve AI Quota: strictly service_role-only
create or replace function public.reserve_ai_quota(
  p_workspace_id uuid,
  p_user_id uuid,
  p_period_ym text,
  p_usage_type text,
  p_units numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_quota public.workspace_ai_quotas%rowtype;
  v_ledger_id uuid;
begin
  if p_user_id is null then
    raise exception 'USER_ID_REQUIRED';
  end if;

  if p_units is null or p_units <= 0 then
    raise exception 'INVALID_AI_UNITS';
  end if;

  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.status = 'active'
  ) then
    raise exception 'UNAUTHORIZED_WORKSPACE_ACCESS';
  end if;

  select plan into v_plan
  from public.workspaces
  where id = p_workspace_id;

  if v_plan is null then
    raise exception 'WORKSPACE_NOT_FOUND';
  end if;

  insert into public.workspace_ai_quotas (workspace_id, period_ym, usage_type, limit_units)
  values (p_workspace_id, p_period_ym, p_usage_type, public.default_ai_limit(v_plan, p_usage_type))
  on conflict (workspace_id, period_ym, usage_type) do nothing;

  select * into v_quota
  from public.workspace_ai_quotas
  where workspace_id = p_workspace_id
    and period_ym = p_period_ym
    and usage_type = p_usage_type
  for update;

  if (v_quota.used_units + v_quota.reserved_units + p_units) > v_quota.limit_units then
    raise exception 'AI_QUOTA_EXCEEDED';
  end if;

  update public.workspace_ai_quotas
  set reserved_units = reserved_units + p_units
  where workspace_id = p_workspace_id
    and period_ym = p_period_ym
    and usage_type = p_usage_type;

  insert into public.ai_usage_ledger (workspace_id, user_id, period_ym, usage_type, units, status)
  values (p_workspace_id, p_user_id, p_period_ym, p_usage_type, p_units, 'reserved')
  returning id into v_ledger_id;

  return v_ledger_id;
end;
$$;

-- 2) Finalize Reserved AI Quota: strictly service_role-only
create or replace function public.finalize_ai_quota(
  p_ledger_id uuid,
  p_outcome text,
  p_estimated_cost_usd numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ai_usage_ledger%rowtype;
begin
  if p_outcome not in ('committed', 'released') then
    raise exception 'INVALID_OUTCOME';
  end if;

  select * into v_row
  from public.ai_usage_ledger
  where id = p_ledger_id
  for update;

  if not found or v_row.status <> 'reserved' then
    return;
  end if;

  if p_outcome = 'committed' then
    update public.workspace_ai_quotas
    set reserved_units = greatest(0, reserved_units - v_row.units),
        used_units = used_units + v_row.units
    where workspace_id = v_row.workspace_id
      and period_ym = v_row.period_ym
      and usage_type = v_row.usage_type;
  else
    update public.workspace_ai_quotas
    set reserved_units = greatest(0, reserved_units - v_row.units)
    where workspace_id = v_row.workspace_id
      and period_ym = v_row.period_ym
      and usage_type = v_row.usage_type;
  end if;

  update public.ai_usage_ledger
  set status = p_outcome,
      estimated_cost_usd = coalesce(p_estimated_cost_usd, estimated_cost_usd),
      updated_at = now()
  where id = p_ledger_id;
end;
$$;

revoke all on function public.reserve_ai_quota(uuid, uuid, text, text, numeric) from public;
grant execute on function public.reserve_ai_quota(uuid, uuid, text, text, numeric) to service_role;

revoke all on function public.finalize_ai_quota(uuid, text, numeric) from public;
grant execute on function public.finalize_ai_quota(uuid, text, numeric) to service_role;

-- 3) Atomic Storage Quota Increment, Rollback Decrement & Purge Sync
create or replace function public.add_workspace_storage_bytes(
  p_workspace_id uuid,
  p_delta_bytes bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws public.workspaces%rowtype;
  v_free_cap bigint := 524288000; -- 500 MB
  v_new_total bigint;
begin
  if p_delta_bytes is null or p_delta_bytes < 0 then
    raise exception 'INVALID_STORAGE_BYTES';
  end if;

  select * into v_ws
  from public.workspaces
  where id = p_workspace_id
  for update;

  if not found then
    raise exception 'WORKSPACE_NOT_FOUND';
  end if;

  if v_ws.plan = 'free' and (v_ws.storage_used_bytes + p_delta_bytes) > v_free_cap then
    raise exception 'FREE_STORAGE_LIMIT_EXCEEDED';
  end if;

  update public.workspaces
  set storage_used_bytes = storage_used_bytes + p_delta_bytes
  where id = p_workspace_id
  returning storage_used_bytes into v_new_total;

  return v_new_total;
end;
$$;

create or replace function public.release_workspace_storage_bytes(
  p_workspace_id uuid,
  p_delta_bytes bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_total bigint;
begin
  if p_delta_bytes is null or p_delta_bytes < 0 then
    raise exception 'INVALID_STORAGE_BYTES';
  end if;

  perform 1 from public.workspaces where id = p_workspace_id for update;

  update public.workspaces
  set storage_used_bytes = greatest(0, storage_used_bytes - p_delta_bytes)
  where id = p_workspace_id
  returning storage_used_bytes into v_new_total;

  return coalesce(v_new_total, 0);
end;
$$;

create or replace function public.mark_original_purged(
  p_inbox_item_id uuid,
  p_force boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inbox_items%rowtype;
begin
  select * into v_item
  from public.inbox_items
  where id = p_inbox_item_id
  for update;

  if not found or v_item.original_purged_at is not null then
    return;
  end if;

  -- Scheduled auto-purge skips failed items; explicit user DELETE passes p_force = true
  if not p_force and v_item.processing_status = 'failed' then
    return;
  end if;

  update public.inbox_items
  set storage_path = null,
      original_purged_at = now()
  where id = p_inbox_item_id;

  perform public.release_workspace_storage_bytes(v_item.workspace_id, v_item.file_size_bytes);
end;
$$;

revoke all on function public.add_workspace_storage_bytes(uuid, bigint) from public;
grant execute on function public.add_workspace_storage_bytes(uuid, bigint) to service_role;

revoke all on function public.release_workspace_storage_bytes(uuid, bigint) from public;
grant execute on function public.release_workspace_storage_bytes(uuid, bigint) to service_role;

revoke all on function public.mark_original_purged(uuid, boolean) from public;
grant execute on function public.mark_original_purged(uuid, boolean) to service_role;

-- 4) Base Entity Access Guard
create or replace function public.can_access_entity(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_workspace_member(p_workspace_id) then
    return false;
  end if;

  return case p_entity_type
    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_entity_id and t.workspace_id = p_workspace_id
        and (t.owner_user_id = auth.uid() or t.visibility = 'team')
    )
    when 'event' then exists (
      select 1 from public.events e
      where e.id = p_entity_id and e.workspace_id = p_workspace_id
        and (e.owner_user_id = auth.uid() or e.visibility = 'team')
    )
    when 'project' then exists (
      select 1 from public.projects p
      where p.id = p_entity_id and p.workspace_id = p_workspace_id
        and (p.owner_user_id = auth.uid() or p.visibility = 'team')
    )
    when 'inbox_item' then exists (
      select 1 from public.inbox_items i
      where i.id = p_entity_id and i.workspace_id = p_workspace_id
        and (i.owner_user_id = auth.uid() or i.visibility = 'team')
    )
    when 'record' then exists (
      select 1 from public.records r
      where r.id = p_entity_id and r.workspace_id = p_workspace_id
        and (r.author_user_id = auth.uid() or r.visibility = 'team')
    )
    else false
  end;
end;
$$;

revoke all on function public.can_access_entity(uuid, text, uuid) from public;
grant execute on function public.can_access_entity(uuid, text, uuid) to authenticated;

-- 5) Safe Linked Entities RPC
create or replace function public.get_linked_entities(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns table (
  linked_type text,
  linked_id uuid,
  linked_title text,
  linked_visibility text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_access_entity(p_workspace_id, p_entity_type, p_entity_id) then
    return;
  end if;

  return query
  with raw_links as (
    select to_type as target_type, to_id as target_id
    from public.entity_links
    where workspace_id = p_workspace_id and from_type = p_entity_type and from_id = p_entity_id
    union
    select from_type as target_type, from_id as target_id
    from public.entity_links
    where workspace_id = p_workspace_id and to_type = p_entity_type and to_id = p_entity_id
  )
  select 'task'::text, t.id, t.title, t.visibility
  from raw_links rl
  join public.tasks t on rl.target_type = 'task' and rl.target_id = t.id
  where t.workspace_id = p_workspace_id and (t.owner_user_id = auth.uid() or t.visibility = 'team')
  union all
  select 'event'::text, e.id, e.title, e.visibility
  from raw_links rl
  join public.events e on rl.target_type = 'event' and rl.target_id = e.id
  where e.workspace_id = p_workspace_id and (e.owner_user_id = auth.uid() or e.visibility = 'team')
  union all
  select 'project'::text, p.id, p.title, p.visibility
  from raw_links rl
  join public.projects p on rl.target_type = 'project' and rl.target_id = p.id
  where p.workspace_id = p_workspace_id and (p.owner_user_id = auth.uid() or p.visibility = 'team')
  union all
  select 'inbox_item'::text, i.id, coalesce(i.title, left(i.raw_text, 60), 'Untitled'), i.visibility
  from raw_links rl
  join public.inbox_items i on rl.target_type = 'inbox_item' and rl.target_id = i.id
  where i.workspace_id = p_workspace_id and (i.owner_user_id = auth.uid() or i.visibility = 'team')
  union all
  select 'record'::text, r.id, left(r.content_markdown, 80), r.visibility
  from raw_links rl
  join public.records r on rl.target_type = 'record' and rl.target_id = r.id
  where r.workspace_id = p_workspace_id and (r.author_user_id = auth.uid() or r.visibility = 'team');
end;
$$;

revoke all on function public.get_linked_entities(uuid, text, uuid) from public;
grant execute on function public.get_linked_entities(uuid, text, uuid) to authenticated;

-- 6) Safe Entity Tags RPC
create or replace function public.get_entity_tags(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns table (
  tag_id uuid,
  label text,
  kind text,
  default_due_offset_days int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_access_entity(p_workspace_id, p_entity_type, p_entity_id) then
    return;
  end if;

  return query
  select t.id, t.label, t.kind, t.default_due_offset_days
  from public.entity_tags et
  join public.tags t on t.id = et.tag_id
  where et.workspace_id = p_workspace_id
    and et.entity_type = p_entity_type
    and et.entity_id = p_entity_id;
end;
$$;

revoke all on function public.get_entity_tags(uuid, text, uuid) from public;
grant execute on function public.get_entity_tags(uuid, text, uuid) to authenticated;

-- 7) Orphan Cleanup Trigger (entity_links + entity_tags)
create or replace function public.cleanup_polymorphic_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.entity_links
  where workspace_id = old.workspace_id
    and ((from_type = tg_argv[0] and from_id = old.id)
      or (to_type = tg_argv[0] and to_id = old.id));

  delete from public.entity_tags
  where workspace_id = old.workspace_id
    and entity_type = tg_argv[0]
    and entity_id = old.id;

  return old;
end;
$$;

create trigger trg_cleanup_refs_inbox   after delete on public.inbox_items for each row execute function public.cleanup_polymorphic_references('inbox_item');
create trigger trg_cleanup_refs_task    after delete on public.tasks       for each row execute function public.cleanup_polymorphic_references('task');
create trigger trg_cleanup_refs_event   after delete on public.events      for each row execute function public.cleanup_polymorphic_references('event');
create trigger trg_cleanup_refs_project after delete on public.projects    for each row execute function public.cleanup_polymorphic_references('project');
create trigger trg_cleanup_refs_record  after delete on public.records     for each row execute function public.cleanup_polymorphic_references('record');
