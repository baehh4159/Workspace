-- =============================================================================
-- Phase 4 Migration: Permanent Personal Workspace Auto-Init & Atomic Team Join
--  1. AFTER INSERT ON auth.users trigger creates 1 permanent personal workspace
--  2. join_team_workspace_atomic() uses FOR UPDATE on workspaces to strictly
--     enforce max_seats (<= 10) under concurrent 1-click guest OAuth joins
-- =============================================================================

-- 1) Automatically provision 1 permanent personal workspace on every new signup
create or replace function public.handle_new_user_personal_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws_id uuid;
begin
  -- Guard against duplicate personal workspace if trigger is ever re-run
  if exists (
    select 1
    from public.workspace_members wm
    join public.workspaces w on w.id = wm.workspace_id
    where wm.user_id = new.id and w.type = 'personal'
  ) then
    return new;
  end if;

  insert into public.workspaces (name, type, plan, max_seats)
  values ('내 워크스페이스', 'personal', 'free', 1)
  returning id into v_ws_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_ws_id, new.id, 'owner', 'active')
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_auth_user_create_personal_ws on auth.users;
create trigger trg_auth_user_create_personal_ws
after insert on auth.users
for each row execute function public.handle_new_user_personal_workspace();

-- 2) Atomic 1-click team join RPC (prevents > max_seats race conditions)
create or replace function public.join_team_workspace_atomic(
  p_workspace_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws public.workspaces%rowtype;
  v_existing_status text;
  v_active_count int;
begin
  if p_workspace_id is null or p_user_id is null then
    raise exception 'INVALID_PARAMS';
  end if;

  -- Serialize concurrent joins to the same team workspace
  select * into v_ws
  from public.workspaces
  where id = p_workspace_id
  for update;

  if not found or v_ws.type <> 'team' then
    return 'not_team_workspace';
  end if;

  select status into v_existing_status
  from public.workspace_members
  where workspace_id = p_workspace_id and user_id = p_user_id;

  if v_existing_status = 'active' then
    return 'already_member';
  end if;

  if v_existing_status = 'deactivated' then
    return 'member_deactivated';
  end if;

  select count(*)::int into v_active_count
  from public.workspace_members
  where workspace_id = p_workspace_id and status = 'active';

  if v_active_count >= v_ws.max_seats then
    return 'seat_limit_reached';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (p_workspace_id, p_user_id, 'member', 'active')
  on conflict (workspace_id, user_id) do nothing;

  return 'joined';
end;
$$;

revoke all on function public.join_team_workspace_atomic(uuid, uuid) from public;
grant execute on function public.join_team_workspace_atomic(uuid, uuid) to service_role;
