-- =============================================================================
-- Phase 2 Migration: Single-Roundtrip Parameterized pg_trgm Search RPC (JSONB)
--  - Returns { items, older_match_count, is_paywall_limited } in ONE call even when 0 recent hits
--  - Computes older_match_count ONLY on page 1 (p_cursor_created_at IS NULL)
--  - Deterministic ordering (created_at DESC, id DESC) with optional composite cursor
-- =============================================================================

drop function if exists public.count_older_inbox_matches(uuid, text);
drop function if exists public.search_inbox_items(uuid, text, int, timestamptz);

create or replace function public.search_inbox_items(
  p_workspace_id uuid,
  p_query text,
  p_limit int default 20,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_cutoff timestamptz;
  v_escaped text;
  v_pattern text;
  v_limit int;
  v_older_count int := 0;
  v_paywall boolean := false;
  v_items jsonb := '[]'::jsonb;
begin
  if not public.is_active_workspace_member(p_workspace_id) then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'older_match_count', 0,
      'is_paywall_limited', false
    );
  end if;

  if p_query is null or char_length(trim(p_query)) = 0 then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'older_match_count', 0,
      'is_paywall_limited', false
    );
  end if;

  select w.plan into v_plan
  from public.workspaces w
  where w.id = p_workspace_id;

  if v_plan is null then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'older_match_count', 0,
      'is_paywall_limited', false
    );
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_escaped := replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_');
  v_pattern := '%' || v_escaped || '%';

  if v_plan = 'free' then
    v_cutoff := now() - interval '30 days';
    v_paywall := true;

    -- Compute older_match_count ONLY on the first page to avoid repeated scans during pagination
    if p_cursor_created_at is null then
      select count(*)::int into v_older_count
      from public.inbox_items i
      where i.workspace_id = p_workspace_id
        and (i.owner_user_id = auth.uid() or i.visibility = 'team')
        and i.created_at < v_cutoff
        and (
          i.title ilike v_pattern escape '\'
          or i.raw_text ilike v_pattern escape '\'
          or i.extracted_text ilike v_pattern escape '\'
        );
    end if;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sub.id,
        'title', sub.title,
        'snippet', sub.snippet,
        'source_type', sub.source_type,
        'created_at', sub.created_at
      )
      order by sub.created_at desc, sub.id desc
    ),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      i.id,
      i.title,
      left(coalesce(i.summary_text, i.extracted_text, i.raw_text, i.title, ''), 180) as snippet,
      i.source_type,
      i.created_at
    from public.inbox_items i
    where i.workspace_id = p_workspace_id
      and (i.owner_user_id = auth.uid() or i.visibility = 'team')
      and (not v_paywall or i.created_at >= v_cutoff)
      and (
        p_cursor_created_at is null
        or (
          p_cursor_id is not null
          and (i.created_at, i.id) < (p_cursor_created_at, p_cursor_id)
        )
        or (
          p_cursor_id is null
          and i.created_at < p_cursor_created_at
        )
      )
      and (
        i.title ilike v_pattern escape '\'
        or i.raw_text ilike v_pattern escape '\'
        or i.extracted_text ilike v_pattern escape '\'
      )
    order by i.created_at desc, i.id desc
    limit v_limit
  ) sub;

  return jsonb_build_object(
    'items', v_items,
    'older_match_count', v_older_count,
    'is_paywall_limited', v_paywall
  );
end;
$$;

revoke all on function public.search_inbox_items(uuid, text, int, timestamptz, uuid) from public;
grant execute on function public.search_inbox_items(uuid, text, int, timestamptz, uuid) to authenticated;
