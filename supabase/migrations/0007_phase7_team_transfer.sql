-- =============================================================================
-- Phase 7 Migration:
--  1. create_team_workspace_atomic(): creates a team workspace (max 10 seats),
--     assigns creator as active owner, and seeds default 4 tags
--  2. transfer_personal_items_to_team(): atomically moves user-selected
--     projects / inbox_items / tasks from a personal workspace to a team
--     workspace while enforcing membership, ownership, and 500MB free storage cap
-- =============================================================================

-- Allow transaction-scoped workspace_id migration ONLY inside audited transfer RPC
-- while strictly preserving owner-only visibility protection from 0001
create or replace function public.guard_owner_immutable_fields()
returns trigger
language plpgsql
as $$
begin
  if new.owner_user_id is distinct from old.owner_user_id then
    raise exception 'IMMUTABLE_OWNER_FIELD';
  end if;

  if new.workspace_id is distinct from old.workspace_id
     and current_setting('app.allow_workspace_transfer', true) is distinct from 'true' then
    raise exception 'IMMUTABLE_WORKSPACE_FIELD';
  end if;

  if auth.uid() is not null
     and new.visibility is distinct from old.visibility
     and old.owner_user_id <> auth.uid() then
    raise exception 'ONLY_OWNER_CAN_CHANGE_VISIBILITY';
  end if;

  return new;
end;
$$;

-- 1) Create Team Workspace + Owner Membership + Default Tags
create or replace function public.create_team_workspace_atomic(
  p_name text,
  p_user_id uuid
)
returns table (
  id uuid,
  name text,
  type text,
  plan text,
  max_seats int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean_name text := trim(coalesce(p_name, ''));
  v_ws_id uuid;
begin
  if p_user_id is null or char_length(v_clean_name) = 0 or char_length(v_clean_name) > 80 then
    raise exception 'INVALID_TEAM_NAME';
  end if;

  insert into public.workspaces (name, type, plan, max_seats)
  values (v_clean_name, 'team', 'free', 10)
  returning workspaces.id into v_ws_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_ws_id, p_user_id, 'owner', 'active');

  insert into public.tags (workspace_id, label, kind, default_due_offset_days)
  values
    (v_ws_id, '회신 대기', 'status', null),
    (v_ws_id, '완료', 'status', null),
    (v_ws_id, '내일 확인', 'action_trigger', 1),
    (v_ws_id, '2주 뒤 재연락', 'action_trigger', 14)
  on conflict (workspace_id, label) do nothing;

  return query
  select w.id, w.name, w.type, w.plan, w.max_seats
  from public.workspaces w
  where w.id = v_ws_id;
end;
$$;

revoke all on function public.create_team_workspace_atomic(text, uuid) from public;
grant execute on function public.create_team_workspace_atomic(text, uuid) to service_role;

-- 2) Selective Personal -> Team Item Transfer (Preserves visibility = 'private' safety)
create or replace function public.transfer_personal_items_to_team(
  p_source_workspace_id uuid,
  p_target_workspace_id uuid,
  p_user_id uuid,
  p_project_ids uuid[] default '{}',
  p_inbox_item_ids uuid[] default '{}',
  p_task_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.workspaces%rowtype;
  v_dst public.workspaces%rowtype;
  v_moved_bytes bigint := 0;
  v_moved_projects int := 0;
  v_moved_inbox int := 0;
  v_moved_tasks int := 0;
  v_free_limit_bytes constant bigint := 524288000; -- 500 MB
begin
  if p_source_workspace_id is null
     or p_target_workspace_id is null
     or p_user_id is null
     or p_source_workspace_id = p_target_workspace_id then
    raise exception 'INVALID_TRANSFER_PARAMS';
  end if;

  -- Lock both workspaces in deterministic order to prevent deadlocks
  perform 1
  from public.workspaces
  where id in (p_source_workspace_id, p_target_workspace_id)
  order by id
  for update;

  select * into v_src from public.workspaces where id = p_source_workspace_id;
  select * into v_dst from public.workspaces where id = p_target_workspace_id;

  if not found or v_src.id is null or v_dst.id is null then
    raise exception 'WORKSPACE_NOT_FOUND';
  end if;

  if v_src.type <> 'personal' or v_dst.type <> 'team' then
    raise exception 'TRANSFER_REQUIRES_PERSONAL_TO_TEAM';
  end if;

  -- Verify active membership in both source and target workspaces
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_source_workspace_id and user_id = p_user_id and status = 'active'
  ) or not exists (
    select 1 from public.workspace_members
    where workspace_id = p_target_workspace_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'FORBIDDEN_WORKSPACE';
  end if;

  -- Calculate active storage bytes for selected inbox items before moving
  if coalesce(cardinality(p_inbox_item_ids), 0) > 0 then
    select coalesce(sum(file_size_bytes), 0)
      into v_moved_bytes
    from public.inbox_items
    where workspace_id = p_source_workspace_id
      and owner_user_id = p_user_id
      and id = any(p_inbox_item_ids)
      and storage_path is not null
      and original_purged_at is null;
  end if;

  if v_dst.plan = 'free' and (v_dst.storage_used_bytes + v_moved_bytes) > v_free_limit_bytes then
    raise exception 'TARGET_STORAGE_LIMIT_EXCEEDED';
  end if;

  -- Enable transaction-local workspace_id mutation for immutable-field trigger
  perform set_config('app.allow_workspace_transfer', 'true', true);

  if coalesce(cardinality(p_project_ids), 0) > 0 then
    update public.projects
    set workspace_id = p_target_workspace_id
    where workspace_id = p_source_workspace_id
      and owner_user_id = p_user_id
      and id = any(p_project_ids);
    get diagnostics v_moved_projects = row_count;
  end if;

  if coalesce(cardinality(p_inbox_item_ids), 0) > 0 then
    update public.inbox_items
    set workspace_id = p_target_workspace_id
    where workspace_id = p_source_workspace_id
      and owner_user_id = p_user_id
      and id = any(p_inbox_item_ids);
    get diagnostics v_moved_inbox = row_count;
  end if;

  if coalesce(cardinality(p_task_ids), 0) > 0 then
    update public.tasks
    set workspace_id = p_target_workspace_id,
        project_id = case
          when project_id is not null and project_id = any(coalesce(p_project_ids, '{}')) then project_id
          else null
        end
    where workspace_id = p_source_workspace_id
      and owner_user_id = p_user_id
      and id = any(p_task_ids);
    get diagnostics v_moved_tasks = row_count;
  end if;

  -- Detach cross-workspace project references on remaining tasks in source workspace
  if v_moved_projects > 0 then
    update public.tasks
    set project_id = null
    where workspace_id = p_source_workspace_id
      and project_id = any(p_project_ids);
  end if;

  if v_moved_bytes > 0 then
    update public.workspaces
    set storage_used_bytes = greatest(0, storage_used_bytes - v_moved_bytes)
    where id = p_source_workspace_id;

    update public.workspaces
    set storage_used_bytes = storage_used_bytes + v_moved_bytes
    where id = p_target_workspace_id;
  end if;

  return jsonb_build_object(
    'movedProjects', v_moved_projects,
    'movedInboxItems', v_moved_inbox,
    'movedTasks', v_moved_tasks,
    'movedBytes', v_moved_bytes
  );
end;
$$;

revoke all on function public.transfer_personal_items_to_team(uuid, uuid, uuid, uuid[], uuid[], uuid[]) from public;
grant execute on function public.transfer_personal_items_to_team(uuid, uuid, uuid, uuid[], uuid[], uuid[]) to service_role;
