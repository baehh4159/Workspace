/**
 * apps/web/src/lib/billing.ts
 * Server-side helpers for plan changes.
 *
 * applyPlanChange() is what a real payment webhook should call after a successful payment
 * (see NEXT_STEPS_GUIDE.md "3단계"). In demo mode the checkout route calls it directly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { FREE_TEAM_MAX_SEATS, PLANS, aiQuotaLimit, type PlanId } from '@/lib/plans';

export { FREE_TEAM_MAX_SEATS };

export function currentKstPeriodYm(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

/**
 * Applies a plan to a workspace:
 *  1. workspaces.plan (+ seat count for team workspaces)
 *  2. paid plans: cancels the free-plan 30-day expiry of originals that still exist
 *  3. paid plans: raises this month's AI quota rows so an upgrade takes effect immediately
 *     (reserve_ai_quota only creates rows with the plan default when none exist yet)
 */
export async function applyPlanChange(
  adminClient: SupabaseClient,
  workspaceId: string,
  workspaceType: 'personal' | 'team',
  plan: PlanId
): Promise<{ ok: true } | { ok: false; step: string }> {
  const seats =
    workspaceType === 'personal'
      ? 1
      : plan === 'free'
        ? FREE_TEAM_MAX_SEATS
        : PLANS[plan].limits.maxSeats;

  const { error: wsErr } = await adminClient
    .from('workspaces')
    .update({ plan, max_seats: seats })
    .eq('id', workspaceId);
  if (wsErr) return { ok: false, step: 'workspace' };

  if (plan !== 'free') {
    const { error: expiryErr } = await adminClient
      .from('inbox_items')
      .update({ original_expires_at: null })
      .eq('workspace_id', workspaceId)
      .is('original_purged_at', null);
    if (expiryErr) return { ok: false, step: 'retention' };
  }

  // Downgrades keep this month's quota (a lower limit could violate the used <= limit check);
  // the free limits apply from next month when reserve_ai_quota creates new rows.
  if (plan === 'free') return { ok: true };

  const periodYm = currentKstPeriodYm();
  for (const usageType of ['doc_ocr_pages', 'voice_stt_seconds', 'text_classify'] as const) {
    const { error: quotaErr } = await adminClient
      .from('workspace_ai_quotas')
      .update({ limit_units: aiQuotaLimit(plan, usageType) })
      .eq('workspace_id', workspaceId)
      .eq('period_ym', periodYm)
      .eq('usage_type', usageType);
    if (quotaErr) return { ok: false, step: 'ai_quota' };
  }

  return { ok: true };
}
