/**
 * apps/web/src/app/api/inbox/[id]/ai-process/route.ts
 * Hardened Reserve -> Execute -> Commit / Release AI processing endpoint:
 *  - Records processing_started_at on atomic claim for 5-minute zombie-lock recovery
 *  - Checks { error } on both committed & released finalize_ai_quota calls
 *  - Separates saved = true state so post-save errors never overwrite succeeded -> failed
 */
import { NextResponse } from 'next/server';
import { UuidSchema } from '@workspace/core/schemas';
import { processInboxItemWithAi, resolveAiMetering } from '@workspace/ai/worker';
import {
  assertActiveWorkspaceMember,
  getAuthenticatedContext,
  PRIVATE_STORAGE_BUCKET,
} from '@/lib/supabase-server';

function getCurrentPeriodYmKst(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id } = await context.params;
  if (!UuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'INVALID_UUID' }, { status: 400 });
  }

  const { data: item } = await ctx.adminClient
    .from('inbox_items')
    .select(
      'id, workspace_id, owner_user_id, visibility, source_type, raw_text, storage_path, original_purged_at, page_count, audio_seconds, processing_status'
    )
    .eq('id', id)
    .maybeSingle();

  if (!item) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  const membership = await assertActiveWorkspaceMember(ctx.adminClient, item.workspace_id, ctx.user.id);
  if (!membership || (item.owner_user_id !== ctx.user.id && item.visibility !== 'team')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  if (
    (item.source_type === 'scanner_doc' || item.source_type === 'quick_voice') &&
    (!item.storage_path || item.original_purged_at)
  ) {
    return NextResponse.json({ error: 'ORIGINAL_FILE_UNAVAILABLE' }, { status: 409 });
  }

  if ((item.source_type === 'quick_text' || item.source_type === 'quick_tag') && !item.raw_text?.trim()) {
    return NextResponse.json({ error: 'EMPTY_TEXT_INPUT' }, { status: 400 });
  }

  // 1) Atomically claim processing lock and record processing_started_at for zombie sweeper
  const { data: claimed } = await ctx.adminClient
    .from('inbox_items')
    .update({
      processing_status: 'processing',
      processing_started_at: new Date().toISOString(),
    })
    .eq('id', item.id)
    .in('processing_status', ['ready', 'failed'])
    .select('id')
    .maybeSingle();

  if (!claimed) {
    return NextResponse.json({ error: 'ALREADY_PROCESSING_OR_SUCCEEDED' }, { status: 409 });
  }

  // 2) Reserve AI quota atomically via service_role RPC
  const { usageType, units } = resolveAiMetering({
    sourceType: item.source_type,
    pageCount: item.page_count,
    audioSeconds: item.audio_seconds,
  });
  const periodYm = getCurrentPeriodYmKst();

  const { data: ledgerId, error: reserveErr } = await ctx.adminClient.rpc('reserve_ai_quota', {
    p_workspace_id: item.workspace_id,
    p_user_id: ctx.user.id,
    p_period_ym: periodYm,
    p_usage_type: usageType,
    p_units: units,
  });

  if (reserveErr || !ledgerId) {
    await ctx.adminClient
      .from('inbox_items')
      .update({
        processing_status: item.processing_status,
        processing_started_at: null,
      })
      .eq('id', item.id);

    const isExceeded = reserveErr?.message.includes('AI_QUOTA_EXCEEDED');
    return NextResponse.json(
      { error: isExceeded ? 'AI_QUOTA_EXCEEDED' : 'AI_RESERVE_FAILED', usageType, units },
      { status: isExceeded ? 402 : 500 }
    );
  }

  // 3) Execute AI worker with saved-state guard & strict finalize_ai_quota error checking
  let saved = false;
  try {
    let signedFileUrl: string | null = null;
    if (item.storage_path) {
      const { data: signed, error: signErr } = await ctx.adminClient.storage
        .from(PRIVATE_STORAGE_BUCKET)
        .createSignedUrl(item.storage_path, 120);

      if (signErr || !signed?.signedUrl) {
        throw new Error('SIGNED_URL_ISSUE_FAILED');
      }
      signedFileUrl = signed.signedUrl;
    }

    const result = await processInboxItemWithAi({
      itemId: item.id,
      sourceType: item.source_type,
      signedFileUrl,
      rawText: item.raw_text,
      pageCount: item.page_count,
      audioSeconds: item.audio_seconds,
    });

    if (result.actualUnits > units) {
      console.warn('[AI_METERING_DISCREPANCY]', {
        workspaceId: item.workspace_id,
        itemId: item.id,
        usageType,
        declaredUnits: units,
        actualUnits: result.actualUnits,
      });
    }

    const { data: updated, error: saveErr } = await ctx.adminClient
      .from('inbox_items')
      .update({
        extracted_text: result.extractedText,
        summary_text: result.summaryText,
        ocr_completed_at: new Date().toISOString(),
        processing_status: 'succeeded',
        processing_started_at: null,
      })
      .eq('id', item.id)
      .select('id, extracted_text, summary_text, ocr_completed_at, processing_status')
      .single();

    if (saveErr || !updated) {
      throw new Error('AI_RESULT_SAVE_FAILED');
    }

    saved = true;

    const { error: commitErr } = await ctx.adminClient.rpc('finalize_ai_quota', {
      p_ledger_id: ledgerId,
      p_outcome: 'committed',
      p_estimated_cost_usd: result.estimatedCostUsd,
    });

    if (commitErr) {
      console.error('[AI_QUOTA_COMMIT_FAILED]', {
        ledgerId,
        itemId: item.id,
        error: commitErr.message,
      });
    }

    return NextResponse.json(
      { item: updated, usageType, units: result.actualUnits, quotaCommitPending: Boolean(commitErr) },
      { status: 200 }
    );
  } catch (err) {
    if (!saved) {
      const { error: releaseErr } = await ctx.adminClient.rpc('finalize_ai_quota', {
        p_ledger_id: ledgerId,
        p_outcome: 'released',
      });

      if (releaseErr) {
        console.error('[AI_QUOTA_RELEASE_FAILED]', {
          ledgerId,
          itemId: item.id,
          error: releaseErr.message,
        });
      }

      await ctx.adminClient
        .from('inbox_items')
        .update({
          processing_status: 'failed',
          processing_started_at: null,
        })
        .eq('id', item.id);
    }

    const message = err instanceof Error ? err.message : 'AI_PROCESSING_FAILED';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
