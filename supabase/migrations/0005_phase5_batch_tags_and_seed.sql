-- =============================================================================
-- Phase 5 Migration:
--  1. get_entity_tags_batch(): eliminates N+1 RPC calls on Inbox list load while
--     preserving strict active-member + per-entity can_access_entity() isolation
--  2. Update handle_new_user_personal_workspace() to seed 4 default tags
--     (2 status + 2 action_trigger) so new users immediately see 3s Tag chips
-- =============================================================================

-- 1) Batch Entity Tags RPC (single round-trip for up to N entities)
create or replace function public.get_entity_tags_batch(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_ids uuid[]
)
returns table (
  entity_id uuid,
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
  if p_workspace_id is null
     or p_entity_type is null
     or p_entity_ids is null
     or cardinality(p_entity_ids) = 0 then
    return;
  end if;

  if not public.is_active_workspace_member(p_workspace_id) then
    return;
  end if;

  return query
  with accessible_entities as (
    select distinct id as target_id
    from unnest(p_entity_ids) as t(id)
    where public.can_access_entity(p_workspace_id, p_entity_type, id)
  )
  select
    et.entity_id,
    tg.id as tag_id,
    tg.label,
    tg.kind,
    tg.default_due_offset_days
  from accessible_entities ae
  join public.entity_tags et
    on et.workspace_id = p_workspace_id
   and et.entity_type = p_entity_type
   and et.entity_id = ae.target_id
  join public.tags tg
    on tg.id = et.tag_id
   and tg.workspace_id = p_workspace_id
  order by et.entity_id, tg.kind asc, tg.label asc;
end;
$$;

revoke all on function public.get_entity_tags_batch(uuid, text, uuid[]) from public;
grant execute on function public.get_entity_tags_batch(uuid, text, uuid[]) to authenticated;

-- 2) Provision permanent personal workspace + seed 4 default tags on signup
create or replace function public.handle_new_user_personal_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws_id uuid;
begin
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

  -- Seed default 3-second tags (2 status + 2 action_trigger) for immediate onboarding value
  insert into public.tags (workspace_id, label, kind, default_due_offset_days)
  values
    (v_ws_id, '회신 대기', 'status', null),
    (v_ws_id, '완료', 'status', null),
    (v_ws_id, '내일 확인', 'action_trigger', 1),
    (v_ws_id, '2주 뒤 재연락', 'action_trigger', 14)
  on conflict (workspace_id, label) do nothing;

  return new;
end;
$$;
