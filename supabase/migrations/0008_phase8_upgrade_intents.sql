-- =============================================================================
-- Phase 8 (pre-billing): Upgrade intent capture
--  - Every "업그레이드" click from the pricing page / paywall CTAs is recorded here
--    by POST /api/billing/checkout (service_role, after owner verification).
--  - Lets you measure real willingness to pay (by plan, cycle and source screen)
--    before integrating a payment provider.
--  - No client policies: rows are written and read only with the service_role key.
-- =============================================================================

create table if not exists public.billing_upgrade_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_plan text not null check (requested_plan in ('pro', 'team')),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'yearly')),
  source text check (source is null or char_length(source) <= 40),
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_upgrade_intents_created
  on public.billing_upgrade_intents (created_at desc);

create index if not exists idx_billing_upgrade_intents_workspace
  on public.billing_upgrade_intents (workspace_id, created_at desc);

alter table public.billing_upgrade_intents enable row level security;

-- Example: conversion intent by source screen in the last 30 days
--   select source, requested_plan, billing_cycle, count(distinct workspace_id)
--   from public.billing_upgrade_intents
--   where created_at > now() - interval '30 days'
--   group by 1, 2, 3 order by 4 desc;
