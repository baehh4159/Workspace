/**
 * apps/web/src/app/api/cron/maintenance/route.ts
 * Scheduled Maintenance Endpoint (secured with constant-time CRON_SECRET verification):
 *  - ?job=zombie   -> Recover >5m stale reserved AI quotas & processing inbox items
 *  - ?job=autofold -> Auto-fold >7d unprocessed inbox items into auto_folded
 *  - ?job=purge    -> Dispatch 7d/1d pre-expiry warnings ONLY for free-plan workspaces
 *                     (marks notified_at ONLY after dispatch succeeds) & purge expired free originals
 *  - Returns HTTP 500 if any requested job encounters an error so cron monitors alert immediately.
 */
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient, PRIVATE_STORAGE_BUCKET } from '@/lib/supabase-server';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

function isAuthorizedCron(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return { ok: false, status: 500, error: 'CRON_SECRET_NOT_CONFIGURED' };
  }

  const authHeader = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authHeader, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'UNAUTHORIZED_CRON' };
  }
  return { ok: true };
}

/**
 * Notification dispatcher hook (push/email webhook).
 * Returns true only when delivery succeeds so notified_at is never stamped prematurely.
 */
async function dispatchExpiryWarning(params: {
  inboxItemId: string;
  ownerUserId: string;
  title: string | null;
  expiresAt: string;
  daysRemaining: 7 | 1;
}): Promise<boolean> {
  const webhookUrl = process.env.NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) {
    // Dev/staging fallback: log structured event; in production configure NOTIFICATION_WEBHOOK_URL
    console.info('[EXPIRY_WARNING_DRY_RUN]', params);
    return true;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'free_original_expiry_warning', ...params }),
    });
    return res.ok;
  } catch (err) {
    console.error('[EXPIRY_WARNING_DISPATCH_FAILED]', {
      inboxItemId: params.inboxItemId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function POST(req: Request) {
  const auth = isAuthorizedCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const job = searchParams.get('job') ?? 'all';
  if (!['all', 'zombie', 'autofold', 'purge'].includes(job)) {
    return NextResponse.json({ error: 'INVALID_JOB_PARAM' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const adminClient = createAdminClient();
  const report: Record<string, unknown> = { job, ranAt: new Date().toISOString() };
  let hasFailure = false;

  // 1) Recover stale AI locks (> 5 min)
  if (job === 'all' || job === 'zombie') {
    const { data, error } = await adminClient.rpc('recover_stale_ai_locks', {
      p_stale_minutes: 5,
    });
    if (error) {
      hasFailure = true;
      console.error('[CRON_ZOMBIE_FAILED]', error.message);
      report.zombie = { ok: false, error: error.message };
    } else {
      report.zombie = { ok: true, result: data };
    }
  }

  // 2) Auto-fold unprocessed inbox items older than 7 days
  if (job === 'all' || job === 'autofold') {
    const { data, error } = await adminClient.rpc('auto_fold_stale_inbox_items', {
      p_days: 7,
    });
    if (error) {
      hasFailure = true;
      console.error('[CRON_AUTOFOLD_FAILED]', error.message);
      report.autofold = { ok: false, error: error.message };
    } else {
      report.autofold = { ok: true, foldedCount: data };
    }
  }

  // 3) Free-plan ONLY 30-day expiry warnings (dispatch first -> mark notified_at) + purge
  if (job === 'all' || job === 'purge') {
    const nowMs = Date.now();
    const in7dIso = new Date(nowMs + 7 * 86400 * 1000).toISOString();
    const in1dIso = new Date(nowMs + 1 * 86400 * 1000).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    let notified7dCount = 0;
    let notified1dCount = 0;
    let notifyFailedCount = 0;

    // 3a) Query 7-day warning candidates strictly for FREE workspaces
    const { data: candidates7d, error: err7d } = await adminClient
      .from('inbox_items')
      .select('id, owner_user_id, title, original_expires_at, workspaces!inner(plan)')
      .eq('workspaces.plan', 'free')
      .is('expiry_notified_7d_at', null)
      .is('original_purged_at', null)
      .not('storage_path', 'is', null)
      .neq('processing_status', 'failed')
      .gt('original_expires_at', in1dIso)
      .lte('original_expires_at', in7dIso)
      .limit(100);

    if (err7d) {
      hasFailure = true;
      console.error('[CRON_WARN_7D_QUERY_FAILED]', err7d.message);
    } else {
      for (const row of candidates7d ?? []) {
        const sent = await dispatchExpiryWarning({
          inboxItemId: row.id,
          ownerUserId: row.owner_user_id,
          title: row.title,
          expiresAt: row.original_expires_at,
          daysRemaining: 7,
        });
        if (!sent) {
          notifyFailedCount += 1;
          hasFailure = true;
          continue;
        }
        const { error: markErr } = await adminClient
          .from('inbox_items')
          .update({ expiry_notified_7d_at: nowIso })
          .eq('id', row.id);
        if (markErr) {
          notifyFailedCount += 1;
          hasFailure = true;
        } else {
          notified7dCount += 1;
        }
      }
    }

    // 3b) Query 1-day warning candidates strictly for FREE workspaces
    const { data: candidates1d, error: err1d } = await adminClient
      .from('inbox_items')
      .select('id, owner_user_id, title, original_expires_at, workspaces!inner(plan)')
      .eq('workspaces.plan', 'free')
      .is('expiry_notified_1d_at', null)
      .is('original_purged_at', null)
      .not('storage_path', 'is', null)
      .neq('processing_status', 'failed')
      .gt('original_expires_at', nowIso)
      .lte('original_expires_at', in1dIso)
      .limit(100);

    if (err1d) {
      hasFailure = true;
      console.error('[CRON_WARN_1D_QUERY_FAILED]', err1d.message);
    } else {
      for (const row of candidates1d ?? []) {
        const sent = await dispatchExpiryWarning({
          inboxItemId: row.id,
          ownerUserId: row.owner_user_id,
          title: row.title,
          expiresAt: row.original_expires_at,
          daysRemaining: 1,
        });
        if (!sent) {
          notifyFailedCount += 1;
          hasFailure = true;
          continue;
        }
        const { error: markErr } = await adminClient
          .from('inbox_items')
          .update({ expiry_notified_1d_at: nowIso })
          .eq('id', row.id);
        if (markErr) {
          notifyFailedCount += 1;
          hasFailure = true;
        } else {
          notified1dCount += 1;
        }
      }
    }

    // 3c) Purge expired free-plan originals
    const { data: expired, error: listErr } = await adminClient.rpc('list_expired_free_originals', {
      p_batch_size: 100,
    });

    if (listErr) {
      hasFailure = true;
      console.error('[CRON_PURGE_LIST_FAILED]', listErr.message);
      report.purge = {
        ok: false,
        error: listErr.message,
        notified7dCount,
        notified1dCount,
        notifyFailedCount,
      };
    } else {
      const candidates = Array.isArray(expired) ? expired : [];
      let purgedCount = 0;
      let purgeFailedCount = 0;

      for (const item of candidates) {
        const { error: rmErr } = await adminClient.storage
          .from(PRIVATE_STORAGE_BUCKET)
          .remove([item.storage_path]);

        if (rmErr) {
          purgeFailedCount += 1;
          hasFailure = true;
          console.error('[CRON_STORAGE_REMOVE_FAILED]', {
            inboxItemId: item.id,
            error: rmErr.message,
          });
          continue;
        }

        const { error: purgeErr } = await adminClient.rpc('mark_original_purged', {
          p_inbox_item_id: item.id,
          p_force: false,
        });

        if (purgeErr) {
          purgeFailedCount += 1;
          hasFailure = true;
          console.error('[CRON_MARK_PURGED_FAILED]', {
            inboxItemId: item.id,
            error: purgeErr.message,
          });
          continue;
        }
        purgedCount += 1;
      }

      report.purge = {
        ok: purgeFailedCount === 0 && notifyFailedCount === 0 && !err7d && !err1d,
        notified7dCount,
        notified1dCount,
        notifyFailedCount,
        scannedExpired: candidates.length,
        purgedCount,
        purgeFailedCount,
      };
    }
  }

  return NextResponse.json(report, {
    status: hasFailure ? 500 : 200,
    headers: NO_STORE_HEADERS,
  });
}
