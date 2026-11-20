/**
 * apps/web/src/app/(main)/settings/page.tsx
 * Server Component loading workspace storage, seats, KST monthly AI quotas, active share links (with entityId),
 * and transferable personal projects/inbox items.
 */
import React from 'react';
import { redirect } from 'next/navigation';
import { getServerWorkspaceSession } from '@/lib/supabase-server';
import {
  SettingsView,
  type ActiveShareItem,
  type AiQuotaRow,
  type TransferableItem,
} from '@/components/settings-view';
import { aiQuotaLimit } from '@/lib/plans';

export const dynamic = 'force-dynamic';

function getCurrentKstYm(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

const AI_QUOTA_META: Record<AiQuotaRow['usageType'], { label: string; unitLabel: string }> = {
  doc_ocr_pages: { label: 'AI 문서 읽기', unitLabel: '쪽' },
  voice_stt_seconds: { label: '음성 받아쓰기', unitLabel: '초' },
  text_classify: { label: '메모 자동 분류', unitLabel: '회' },
};

export default async function SettingsPage() {
  const session = await getServerWorkspaceSession();
  if (!session) {
    redirect('/login');
  }

  const wsId = session.activeWorkspace.id;
  const periodYm = getCurrentKstYm();
  const nowIso = new Date().toISOString();
  const teamWorkspaces = session.workspaces
    .filter((w) => w.type === 'team')
    .map((w) => ({ id: w.id, name: w.name }));
  const shouldLoadTransferables =
    session.activeWorkspace.type === 'personal' && teamWorkspaces.length > 0;

  const [wsRes, membersRes, quotasRes, sharesRes, projRes, inboxRes] = await Promise.all([
    session.userClient
      .from('workspaces')
      .select('id, name, type, plan, max_seats, storage_used_bytes')
      .eq('id', wsId)
      .single(),
    session.userClient
      .from('workspace_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('workspace_id', wsId)
      .eq('status', 'active'),
    session.userClient
      .from('workspace_ai_quotas')
      .select('usage_type, used_units, reserved_units, limit_units')
      .eq('workspace_id', wsId)
      .eq('period_ym', periodYm),
    session.userClient
      .from('share_tokens')
      .select('id, entity_type, entity_id, scope, created_by, expires_at, created_at')
      .eq('workspace_id', wsId)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(30),
    shouldLoadTransferables
      ? session.userClient
          .from('projects')
          .select('id, title')
          .eq('workspace_id', wsId)
          .eq('status', 'active')
          .order('updated_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
    shouldLoadTransferables
      ? session.userClient
          .from('inbox_items')
          .select('id, title, raw_text')
          .eq('workspace_id', wsId)
          .order('created_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
  ]);

  const wsRow = wsRes.data;
  const activePlan = (wsRow?.plan as 'free' | 'pro' | 'team') ?? session.activeWorkspace.plan;

  const quotaMap = new Map(
    (quotasRes.data ?? []).map((q) => [
      q.usage_type as AiQuotaRow['usageType'],
      {
        used: Number(q.used_units ?? 0),
        reserved: Number(q.reserved_units ?? 0),
        limit: Number(q.limit_units ?? 0),
      },
    ])
  );

  const aiQuotas: AiQuotaRow[] = (
    ['doc_ocr_pages', 'voice_stt_seconds', 'text_classify'] as const
  ).map((usageType) => {
    const meta = AI_QUOTA_META[usageType];
    const row = quotaMap.get(usageType);
    return {
      usageType,
      label: meta.label,
      usedUnits: row?.used ?? 0,
      reservedUnits: row?.reserved ?? 0,
      limitUnits: row?.limit ?? aiQuotaLimit(activePlan, usageType),
      unitLabel: meta.unitLabel,
    };
  });

  const isOwner = session.activeWorkspace.role === 'owner';
  const initialShares: ActiveShareItem[] = (sharesRes.data ?? []).map((s) => ({
    id: s.id as string,
    entityType: s.entity_type as ActiveShareItem['entityType'],
    entityId: s.entity_id as string,
    scope: s.scope as ActiveShareItem['scope'],
    expiresAt: s.expires_at as string,
    createdAt: s.created_at as string,
    canRevoke: isOwner || s.created_by === session.user.id,
  }));

  const transferableItems: TransferableItem[] = [
    ...(projRes.data ?? []).map((p) => ({
      id: p.id as string,
      title: p.title as string,
      kind: 'project' as const,
    })),
    ...(inboxRes.data ?? []).map((i) => ({
      id: i.id as string,
      title:
        (i.title as string | null) ??
        ((i.raw_text as string | null)?.slice(0, 50) || '제목 없는 항목'),
      kind: 'inbox_item' as const,
    })),
  ];

  return (
    <SettingsView
      key={wsId}
      workspace={{
        id: wsId,
        name: (wsRow?.name as string) ?? session.activeWorkspace.name,
        type: (wsRow?.type as 'personal' | 'team') ?? session.activeWorkspace.type,
        plan: activePlan,
        maxSeats: Number(wsRow?.max_seats ?? 1),
        storageUsedBytes: Number(wsRow?.storage_used_bytes ?? 0),
      }}
      activeMemberCount={membersRes.count ?? 1}
      periodYm={periodYm}
      aiQuotas={aiQuotas}
      initialShares={initialShares}
      teamWorkspaces={teamWorkspaces}
      transferableItems={transferableItems}
    />
  );
}
