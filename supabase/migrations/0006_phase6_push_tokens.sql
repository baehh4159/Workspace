-- =============================================================================
-- Phase 6 Migration: Mobile Expo Push Tokens (strictly self-owned RLS)
-- =============================================================================
create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_name text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_user_push_tokens_user_seen
  on public.user_push_tokens (user_id, last_seen_at desc);

alter table public.user_push_tokens enable row level security;

create policy "push_tokens_self_select" on public.user_push_tokens
for select using (user_id = auth.uid());

create policy "push_tokens_self_insert" on public.user_push_tokens
for insert with check (user_id = auth.uid());

create policy "push_tokens_self_update" on public.user_push_tokens
for update using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "push_tokens_self_delete" on public.user_push_tokens
for delete using (user_id = auth.uid());
