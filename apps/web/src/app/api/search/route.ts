/**
 * apps/web/src/app/api/search/route.ts
 * Single-RPC pg_trgm full-text search across inbox_items:
 *  - Calls search_inbox_items once (returns items + older_match_count + is_paywall_limited even on 0 hits)
 *  - Supports composite cursor (cursor + optional cursorId) for deterministic tie-breaking
 */
import { NextResponse } from 'next/server';
import {
  IsoDateTimeSchema,
  SearchQuerySchema,
  SearchResponseSchema,
  UuidSchema,
} from '@workspace/core/schemas';
import { assertActiveWorkspaceMember, getAuthenticatedContext } from '@/lib/supabase-server';

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

interface SearchRpcPayload {
  items: Array<{
    id: string;
    title: string | null;
    snippet: string;
    source_type: 'scanner_doc' | 'quick_tag' | 'quick_text' | 'quick_voice';
    created_at: string;
  }>;
  older_match_count: number;
  is_paywall_limited: boolean;
}

export async function GET(req: Request) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const rawLimit = searchParams.get('limit');
  const rawCursor = searchParams.get('cursor');
  const rawCursorId = searchParams.get('cursorId');

  const parsed = SearchQuerySchema.safeParse({
    workspaceId: searchParams.get('workspaceId'),
    q: searchParams.get('q'),
    limit: rawLimit !== null ? Number(rawLimit) : undefined,
    cursor: rawCursor ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const { workspaceId, q, limit, cursor } = parsed.data;
  if (cursor && !IsoDateTimeSchema.safeParse(cursor).success) {
    return NextResponse.json({ error: 'INVALID_CURSOR' }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (rawCursorId && !UuidSchema.safeParse(rawCursorId).success) {
    return NextResponse.json({ error: 'INVALID_CURSOR_ID' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const membership = await assertActiveWorkspaceMember(ctx.adminClient, workspaceId, ctx.user.id);
  if (!membership) {
    return NextResponse.json({ error: 'FORBIDDEN_WORKSPACE' }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const { data, error: searchErr } = await ctx.userClient.rpc('search_inbox_items', {
    p_workspace_id: workspaceId,
    p_query: q,
    p_limit: limit,
    p_cursor_created_at: cursor ?? null,
    p_cursor_id: rawCursorId ?? null,
  });

  if (searchErr || !data) {
    return NextResponse.json({ error: 'SEARCH_FAILED' }, { status: 500, headers: NO_STORE_HEADERS });
  }

  const rpcResult = data as SearchRpcPayload;
  const payload = SearchResponseSchema.parse({
    items: (rpcResult.items ?? []).map((r) => ({
      id: r.id,
      title: r.title ?? null,
      snippet: r.snippet ?? '',
      sourceType: r.source_type,
      createdAt: r.created_at,
    })),
    olderMatchCount: Number(rpcResult.older_match_count ?? 0),
    isPaywallLimited: Boolean(rpcResult.is_paywall_limited),
  });

  return NextResponse.json(payload, { status: 200, headers: NO_STORE_HEADERS });
}
