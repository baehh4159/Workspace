/**
 * apps/web/src/app/api/billing/checkout/route.ts
 * Upgrade entry point used by every paywall CTA (pricing page, search, settings, inbox).
 *
 *  - Demo mode: applies the plan immediately (simulated payment) so the paid experience can be tried.
 *  - Real mode, no payment provider yet: records the request in billing_upgrade_intents
 *    (migration 0008) and answers { status: 'waitlisted' }. This measures willingness to pay
 *    before the payment integration (토스페이먼츠 / Stripe / RevenueCat) is built.
 *    When a provider is added, create its checkout session here and call applyPlanChange()
 *    from the provider's webhook.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertActiveWorkspaceMember, getAuthenticatedContext } from '@/lib/supabase-server';
import { applyPlanChange } from '@/lib/billing';
import { DEMO_MODE } from '@/lib/demo/mock-supabase';
import { PLANS } from '@/lib/plans';

const CheckoutSchema = z.object({
  workspaceId: z.string().uuid(),
  plan: z.enum(['free', 'pro', 'team']),
  cycle: z.enum(['monthly', 'yearly']).default('monthly'),
  source: z.string().trim().max(40).optional(),
});

export async function POST(req: Request) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { workspaceId, plan, cycle, source } = parsed.data;

  const membership = await assertActiveWorkspaceMember(ctx.adminClient, workspaceId, ctx.user.id);
  if (!membership) {
    return NextResponse.json({ error: 'FORBIDDEN_WORKSPACE' }, { status: 403 });
  }
  if (membership.role !== 'owner') {
    return NextResponse.json({ error: 'OWNER_ONLY' }, { status: 403 });
  }

  const { data: ws } = await ctx.adminClient
    .from('workspaces')
    .select('id, type, plan')
    .eq('id', workspaceId)
    .maybeSingle();
  if (!ws) {
    return NextResponse.json({ error: 'WORKSPACE_NOT_FOUND' }, { status: 404 });
  }

  const workspaceType = ws.type as 'personal' | 'team';
  const target = PLANS[plan];
  if (plan !== 'free' && target.workspaceType !== workspaceType) {
    return NextResponse.json({ error: 'PLAN_WORKSPACE_MISMATCH' }, { status: 400 });
  }
  if (ws.plan === plan) {
    return NextResponse.json({ status: 'unchanged', plan }, { status: 200 });
  }

  if (DEMO_MODE) {
    const applied = await applyPlanChange(ctx.adminClient, workspaceId, workspaceType, plan);
    if (!applied.ok) {
      return NextResponse.json({ error: 'PLAN_APPLY_FAILED', step: applied.step }, { status: 500 });
    }
    return NextResponse.json({ status: 'activated', plan, simulated: true }, { status: 200 });
  }

  // Downgrades / cancellations belong to the payment provider's customer portal.
  if (plan === 'free') {
    return NextResponse.json({ error: 'DOWNGRADE_NOT_AVAILABLE' }, { status: 400 });
  }

  const { error: intentErr } = await ctx.adminClient.from('billing_upgrade_intents').insert({
    workspace_id: workspaceId,
    user_id: ctx.user.id,
    requested_plan: plan,
    billing_cycle: cycle,
    source: source ?? null,
  });
  if (intentErr) {
    return NextResponse.json({ error: 'UPGRADE_INTENT_SAVE_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ status: 'waitlisted', plan }, { status: 202 });
}
