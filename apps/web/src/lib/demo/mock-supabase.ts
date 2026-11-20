/**
 * apps/web/src/lib/demo/mock-supabase.ts
 * DEMO MODE ONLY: in-memory stand-in for the Supabase client so the UI can be clicked through
 * without login, a Supabase project, or any network access. Data lives in server memory and
 * resets when the dev server restarts.
 */
import crypto from 'node:crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { DEMO_USER_ID, createSeed, type Row, type Store } from './seed';
import { PLANS, aiQuotaLimit, type PlanId } from '@/lib/plans';

/**
 * On in development when no Supabase project is configured, or anywhere with NEXT_PUBLIC_DEMO_MODE=1.
 * Production builds never fall back to demo mode by themselves, so a deploy with missing
 * Supabase settings fails loudly instead of serving a login-free fake app.
 */
export const DEMO_MODE =
  process.env.NEXT_PUBLIC_DEMO_MODE === '1' ||
  (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NODE_ENV !== 'production');

const g = globalThis as unknown as {
  __demoStore?: Store;
  __demoObjects?: Map<string, { bytes: Uint8Array; contentType: string }>;
};
function store(): Store {
  if (!g.__demoStore) g.__demoStore = createSeed();
  return g.__demoStore;
}

export const DEMO_USER = {
  id: DEMO_USER_ID,
  email: 'demo@example.com',
  aud: 'authenticated',
  role: 'authenticated',
  app_metadata: { provider: 'demo' },
  user_metadata: { full_name: '데모 사용자', name: '데모 사용자' },
  created_at: new Date().toISOString(),
} as unknown as User;

type Filter = (r: Row) => boolean;
type Result = { data: unknown; error: null | { message: string; code?: string }; count?: number | null };

const UPDATED_AT_TABLES = new Set(['projects', 'tasks', 'records', 'ai_usage_ledger']);
/** Column defaults from supabase/migrations (subset relevant to the UI). */
const DEFAULTS: Record<string, Row> = {
  inbox_items: { visibility: 'private', triage_status: 'unprocessed', processing_status: 'ready', file_size_bytes: 0 },
  tasks: { visibility: 'private', status: 'todo', due_at: null, project_id: null },
  events: { visibility: 'private', is_all_day: false, timezone: 'Asia/Seoul', location: null, project_id: null },
  projects: { visibility: 'private', status: 'active' },
  records: { visibility: 'private' },
  workspace_members: { status: 'active' },
  workspaces: { plan: 'free', max_seats: 10, storage_used_bytes: 0 },
  share_tokens: { scope: 'view_and_join', revoked_at: null },
};

const PK: Record<string, string[]> = {
  workspace_members: ['workspace_id', 'user_id'],
  entity_tags: ['workspace_id', 'tag_id', 'entity_type', 'entity_id'],
  workspace_ai_quotas: ['workspace_id', 'period_ym', 'usage_type'],
};

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
}

function parseValue(v: string): unknown {
  if (v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

/** Splits "a, b, rel!inner(x, y)" at top-level commas. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function project(table: string, row: Row, columns: string): Row | null {
  if (!columns || columns.trim() === '*') return { ...row };
  const out: Row = {};
  for (const part of splitTop(columns)) {
    const m = part.match(/^(\w+)(!inner)?\((.*)\)$/s);
    if (m) {
      const rel = m[1];
      const fk = rel.replace(/s$/, '') + '_id';
      const target = (store()[rel] ?? []).find((r) => r.id === row[fk]);
      if (!target && m[2]) return null;
      out[rel] = target ? project(rel, target, m[3]) : null;
    } else if (part === '*') {
      Object.assign(out, row);
    } else {
      const bits = part.split(':').map((x) => x.trim());
      const alias = bits[0];
      const col = bits[bits.length - 1];
      out[alias] = row[col];
    }
  }
  void table;
  return out;
}

class Query implements PromiseLike<Result> {
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean; nullsFirst?: boolean }[] = [];
  private limitN: number | null = null;
  private rangeFrom = 0;
  private mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private columns = '*';
  private returning = false;
  private payload: Row[] = [];
  private patch: Row = {};
  private singleMode: 'single' | 'maybe' | null = null;
  private countMode = false;
  private head = false;
  private onConflict: string[] | null = null;
  private ignoreDuplicates = false;

  constructor(private table: string) {}

  select(columns = '*', opts?: { count?: string; head?: boolean }) {
    if (this.mode === 'select') {
      this.columns = columns;
      this.countMode = Boolean(opts?.count);
      this.head = Boolean(opts?.head);
    } else {
      this.returning = true;
      this.columns = columns;
    }
    return this;
  }
  insert(values: Row | Row[]) {
    this.mode = 'insert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.mode = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    this.onConflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null;
    this.ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
    return this;
  }
  update(values: Row) {
    this.mode = 'update';
    this.patch = values;
    return this;
  }
  delete() {
    this.mode = 'delete';
    return this;
  }

  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v || String(r[c]) === String(v)); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  gt(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) > 0); return this; }
  gte(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this; }
  lt(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return this; }
  lte(c: string, v: unknown) { this.filters.push((r) => r[c] != null && cmp(r[c], v) <= 0); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  like(c: string, p: string) { return this.ilike(c, p); }
  ilike(c: string, p: string) {
    const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');
    this.filters.push((r) => re.test(String(r[c] ?? '')));
    return this;
  }
  contains(c: string, v: unknown) {
    this.filters.push((r) => {
      const cur = r[c];
      if (Array.isArray(cur) && Array.isArray(v)) return v.every((x) => cur.includes(x));
      return true;
    });
    return this;
  }
  not(c: string, op: string, v: unknown) {
    const val = typeof v === 'string' ? parseValue(v) : v;
    this.filters.push((r) => {
      if (op === 'is') return val === null ? r[c] != null : r[c] !== val;
      if (op === 'eq') return r[c] !== val;
      if (op === 'in') {
        const list = String(v).replace(/[()]/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
        return !list.includes(String(r[c]));
      }
      return true;
    });
    return this;
  }
  filter(c: string, op: string, v: unknown) {
    const map: Record<string, (c: string, v: unknown) => this> = {
      eq: this.eq.bind(this), neq: this.neq.bind(this), gt: this.gt.bind(this), gte: this.gte.bind(this),
      lt: this.lt.bind(this), lte: this.lte.bind(this), is: this.is.bind(this),
    };
    return map[op] ? map[op](c, typeof v === 'string' ? parseValue(v) : v) : this;
  }
  or(expr: string) {
    const parts = expr.split(',').map((p) => p.trim().split('.'));
    this.filters.push((r) =>
      parts.some(([c, op, ...rest]) => {
        const v = parseValue(rest.join('.'));
        if (op === 'eq') return String(r[c]) === String(v);
        if (op === 'is') return v === null ? r[c] == null : r[c] === v;
        if (op === 'ilike') return String(r[c] ?? '').toLowerCase().includes(String(v).replace(/[%*]/g, '').toLowerCase());
        return false;
      })
    );
    return this;
  }
  match(obj: Row) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.limitN = to - from + 1; return this; }
  single() { this.singleMode = 'single'; return this; }
  maybeSingle() { this.singleMode = 'maybe'; return this; }
  abortSignal() { return this; }

  private rows(): Row[] {
    const s = store();
    if (!s[this.table]) s[this.table] = [];
    return s[this.table];
  }
  private matches(r: Row) { return this.filters.every((f) => f(r)); }
  private keyOf(r: Row): string[] {
    return this.onConflict ?? PK[this.table] ?? ['id'];
  }

  private exec(): Result {
    const all = this.rows();
    let out: Row[] = [];
    const now = new Date().toISOString();

    if (this.mode === 'insert' || this.mode === 'upsert') {
      for (const p of this.payload) {
        const row: Row = { ...(DEFAULTS[this.table] ?? {}), ...p };
        if (!PK[this.table] && row.id === undefined) row.id = crypto.randomUUID();
        if (row.created_at === undefined) row.created_at = now;
        if (this.table === 'share_tokens' && row.expires_at === undefined) row.expires_at = new Date(Date.now() + 14 * 86_400_000).toISOString();
        if (UPDATED_AT_TABLES.has(this.table) && row.updated_at === undefined) row.updated_at = now;
        const keys = this.keyOf(row);
        const existing = this.mode === 'upsert' ? all.find((r) => keys.every((k) => r[k] === row[k])) : undefined;
        if (existing) {
          if (!this.ignoreDuplicates) Object.assign(existing, p, UPDATED_AT_TABLES.has(this.table) ? { updated_at: now } : {});
          out.push(existing);
        } else {
          all.push(row);
          out.push(row);
        }
      }
    } else if (this.mode === 'update') {
      for (const r of all) {
        if (this.matches(r)) {
          Object.assign(r, this.patch);
          if (UPDATED_AT_TABLES.has(this.table)) r.updated_at = now;
          out.push(r);
        }
      }
    } else if (this.mode === 'delete') {
      const keep: Row[] = [];
      for (const r of all) (this.matches(r) ? out : keep).push(r);
      store()[this.table] = keep;
    } else {
      out = all.filter((r) => this.matches(r));
      for (const o of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const an = a[o.col] == null, bn = b[o.col] == null;
          if (an || bn) {
            if (an && bn) return 0;
            const nullsFirst = o.nullsFirst ?? !o.asc;
            return an ? (nullsFirst ? -1 : 1) : nullsFirst ? 1 : -1;
          }
          const c = cmp(a[o.col], b[o.col]);
          return o.asc ? c : -c;
        });
      }
    }

    const total = out.length;
    if (this.mode === 'select') {
      out = out.slice(this.rangeFrom, this.limitN !== null ? this.rangeFrom + this.limitN : undefined);
    }

    const wantRows = this.mode === 'select' || this.returning;
    const projected = wantRows
      ? out.map((r) => project(this.table, r, this.columns)).filter((r): r is Row => r !== null)
      : null;

    if (this.head) return { data: null, error: null, count: total };
    if (this.singleMode) {
      const first = projected?.[0] ?? null;
      if (!first && this.singleMode === 'single') {
        return { data: null, error: { message: 'No rows found', code: 'PGRST116' } };
      }
      return { data: first, error: null };
    }
    return { data: projected, error: null, count: this.countMode ? total : null };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null
  ): PromiseLike<T1 | T2> {
    let res: Result;
    try {
      res = this.exec();
    } catch (e) {
      res = { data: null, error: { message: String(e) } };
    }
    return Promise.resolve(res).then(onfulfilled, onrejected);
  }
}

// ---------- RPC emulation ----------
const TITLE_FIELD: Record<string, string> = {
  inbox_item: 'inbox_items', task: 'tasks', event: 'events', project: 'projects', record: 'records',
};

function entityTitle(type: string, id: string): { title: string; visibility: string } | null {
  const table = TITLE_FIELD[type];
  const row = (store()[table] ?? []).find((r) => r.id === id);
  if (!row) return null;
  const title = (row.title as string) ?? String(row.content_markdown ?? '').slice(0, 40) ?? '(제목 없음)';
  return { title: title || '(제목 없음)', visibility: String(row.visibility ?? 'private') };
}

function rpc(fn: string, args: Record<string, unknown> = {}): Result {
  const s = store();
  switch (fn) {
    case 'get_entity_tags_batch':
    case 'get_entity_tags': {
      const ids = (args.p_entity_ids as string[]) ?? [args.p_entity_id as string];
      const rows = (s.entity_tags ?? [])
        .filter((et) => et.workspace_id === args.p_workspace_id && et.entity_type === args.p_entity_type && ids.includes(et.entity_id as string))
        .map((et) => {
          const tag = (s.tags ?? []).find((t) => t.id === et.tag_id);
          return tag
            ? { entity_id: et.entity_id, tag_id: tag.id, label: tag.label, kind: tag.kind, default_due_offset_days: tag.default_due_offset_days ?? null }
            : null;
        })
        .filter(Boolean);
      return { data: rows, error: null };
    }
    case 'get_linked_entities': {
      const out: Row[] = [];
      for (const l of s.entity_links ?? []) {
        if (l.workspace_id !== args.p_workspace_id) continue;
        let type: string | null = null, id: string | null = null;
        if (l.from_type === args.p_entity_type && l.from_id === args.p_entity_id) { type = l.to_type as string; id = l.to_id as string; }
        else if (l.to_type === args.p_entity_type && l.to_id === args.p_entity_id) { type = l.from_type as string; id = l.from_id as string; }
        if (!type || !id) continue;
        const info = entityTitle(type, id);
        if (info) out.push({ link_id: l.id, linked_type: type, linked_id: id, linked_title: info.title, linked_visibility: info.visibility, created_at: l.created_at });
      }
      return { data: out, error: null };
    }
    case 'search_inbox_items': {
      // Mirrors 0002_phase2_search_rpc.sql: free plans search the last 30 days and get a count of older hits.
      const q = String(args.p_query ?? '').trim().toLowerCase();
      const ws = (s.workspaces ?? []).find((w) => w.id === args.p_workspace_id);
      if (!q || !ws) return { data: { items: [], older_match_count: 0, is_paywall_limited: false }, error: null };
      const historyDays = PLANS[(ws.plan as PlanId) ?? 'free'].limits.searchHistoryDays;
      const cutoff = historyDays === null ? null : new Date(Date.now() - historyDays * 86_400_000).toISOString();
      const matches = (s.inbox_items ?? [])
        .filter((i) => i.workspace_id === args.p_workspace_id)
        .filter((i) => i.owner_user_id === DEMO_USER_ID || i.visibility === 'team')
        .filter((i) => [i.title, i.raw_text, i.extracted_text, i.summary_text].some((t) => String(t ?? '').toLowerCase().includes(q)));
      const recent = cutoff ? matches.filter((i) => String(i.created_at) >= cutoff) : matches;
      const items = recent
        .sort((a, b) => cmp(b.created_at, a.created_at))
        .slice(0, Number(args.p_limit ?? 20))
        .map((i) => {
          const snippet = String(i.summary_text ?? i.extracted_text ?? i.raw_text ?? i.title ?? '').slice(0, 180);
          return { id: i.id, title: i.title, snippet, source_type: i.source_type, created_at: i.created_at };
        });
      return {
        data: { items, older_match_count: matches.length - recent.length, is_paywall_limited: cutoff !== null },
        error: null,
      };
    }
    case 'can_access_entity':
      return { data: true, error: null };
    case 'reserve_ai_quota': {
      // Mirrors 0001 reserve_ai_quota: creates the month row with the plan default, then reserves.
      const ws = (s.workspaces ?? []).find((w) => w.id === args.p_workspace_id);
      if (!ws) return { data: null, error: { message: 'WORKSPACE_NOT_FOUND' } };
      const usageType = args.p_usage_type as 'doc_ocr_pages' | 'voice_stt_seconds' | 'text_classify';
      const units = Number(args.p_units ?? 0);
      let quota = (s.workspace_ai_quotas ?? []).find(
        (q) => q.workspace_id === ws.id && q.period_ym === args.p_period_ym && q.usage_type === usageType
      );
      if (!quota) {
        quota = {
          workspace_id: ws.id,
          period_ym: args.p_period_ym,
          usage_type: usageType,
          limit_units: aiQuotaLimit((ws.plan as PlanId) ?? 'free', usageType),
          reserved_units: 0,
          used_units: 0,
        };
        (s.workspace_ai_quotas ??= []).push(quota);
      }
      if (Number(quota.used_units) + Number(quota.reserved_units) + units > Number(quota.limit_units)) {
        return { data: null, error: { message: 'AI_QUOTA_EXCEEDED' } };
      }
      quota.reserved_units = Number(quota.reserved_units) + units;
      const ledgerId = crypto.randomUUID();
      (s.ai_usage_ledger ??= []).push({
        id: ledgerId,
        workspace_id: ws.id,
        user_id: args.p_user_id ?? DEMO_USER_ID,
        period_ym: args.p_period_ym,
        usage_type: usageType,
        units,
        status: 'reserved',
        created_at: new Date().toISOString(),
      });
      return { data: ledgerId, error: null };
    }
    case 'finalize_ai_quota': {
      const ledger = (s.ai_usage_ledger ?? []).find((l) => l.id === args.p_ledger_id);
      if (!ledger || ledger.status !== 'reserved') return { data: null, error: null };
      const quota = (s.workspace_ai_quotas ?? []).find(
        (q) => q.workspace_id === ledger.workspace_id && q.period_ym === ledger.period_ym && q.usage_type === ledger.usage_type
      );
      const units = Number(ledger.units);
      if (quota) {
        quota.reserved_units = Math.max(0, Number(quota.reserved_units) - units);
        if (args.p_outcome === 'committed') quota.used_units = Number(quota.used_units) + units;
      }
      ledger.status = args.p_outcome === 'committed' ? 'committed' : 'released';
      return { data: true, error: null };
    }
    case 'add_workspace_storage_bytes': {
      const ws = (s.workspaces ?? []).find((w) => w.id === args.p_workspace_id);
      if (!ws) return { data: null, error: { message: 'WORKSPACE_NOT_FOUND' } };
      const next = Number(ws.storage_used_bytes ?? 0) + Number(args.p_delta_bytes ?? 0);
      const cap = PLANS[(ws.plan as PlanId) ?? 'free'].limits.storageBytes;
      if (cap !== null && next > cap) return { data: null, error: { message: 'FREE_STORAGE_LIMIT_EXCEEDED' } };
      ws.storage_used_bytes = next;
      return { data: next, error: null };
    }
    case 'release_workspace_storage_bytes': {
      const ws = (s.workspaces ?? []).find((w) => w.id === args.p_workspace_id);
      if (ws) ws.storage_used_bytes = Math.max(0, Number(ws.storage_used_bytes ?? 0) - Number(args.p_delta_bytes ?? 0));
      return { data: ws?.storage_used_bytes ?? 0, error: null };
    }
    case 'create_team_workspace_atomic': {
      const id = crypto.randomUUID();
      const name = String(args.p_name ?? '새 팀');
      s.workspaces.push({ id, name, type: 'team', plan: 'free', max_seats: 10, storage_used_bytes: 0, created_at: new Date().toISOString() });
      s.workspace_members.push({ workspace_id: id, user_id: DEMO_USER_ID, role: 'owner', status: 'active', joined_at: new Date().toISOString() });
      return { data: [{ id, name, type: 'team', plan: 'free', max_seats: 10 }], error: null };
    }
    case 'transfer_personal_items_to_team':
      return { data: { transferred_count: 0 }, error: null };
    default:
      return { data: null, error: null };
  }
}

// ---------- Storage emulation ----------
// Uploaded files are kept in server memory (newest 30, max 20 MB each) and served by /api/demo-upload.
const MAX_DEMO_OBJECT_BYTES = 20 * 1024 * 1024;
const MAX_DEMO_OBJECTS = 30;

function demoObjects() {
  if (!g.__demoObjects) g.__demoObjects = new Map();
  return g.__demoObjects;
}

export function demoObjectUrl(path: string): string {
  return `/api/demo-upload?path=${encodeURIComponent(path)}`;
}

export function putDemoObject(path: string, bytes: Uint8Array, contentType: string): 'ok' | 'too_large' {
  if (bytes.byteLength > MAX_DEMO_OBJECT_BYTES) return 'too_large';
  const objects = demoObjects();
  objects.delete(path);
  objects.set(path, { bytes, contentType });
  while (objects.size > MAX_DEMO_OBJECTS) {
    const oldest = objects.keys().next().value;
    if (oldest === undefined) break;
    objects.delete(oldest);
  }
  return 'ok';
}

export function getDemoObject(path: string): { bytes: Uint8Array; contentType: string } | null {
  return demoObjects().get(path) ?? null;
}

function storageBucket() {
  return {
    createSignedUrl: async (path: string) => ({ data: { signedUrl: demoObjectUrl(path) }, error: null }),
    createSignedUrls: async (paths: string[]) => ({
      data: paths.map((p) => ({ path: p, signedUrl: demoObjectUrl(p) })),
      error: null,
    }),
    createSignedUploadUrl: async (path: string) => ({
      data: { signedUrl: demoObjectUrl(path), token: 'demo', path },
      error: null,
    }),
    list: async (folder: string, opts?: { search?: string }) => {
      const prefix = `${folder}/`;
      const data = [...demoObjects().entries()]
        .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(([p, obj]) => ({ name: p.slice(prefix.length), metadata: { size: obj.bytes.byteLength, mimetype: obj.contentType } }))
        .filter((o) => !opts?.search || o.name.includes(opts.search));
      return { data, error: null };
    },
    upload: async (path: string) => ({ data: { path }, error: null }),
    uploadToSignedUrl: async (path: string) => ({ data: { path }, error: null }),
    remove: async (paths: string[]) => {
      for (const p of paths ?? []) demoObjects().delete(p);
      return { data: [], error: null };
    },
    download: async (path: string) => {
      const obj = getDemoObject(path);
      return { data: obj ? new Blob([obj.bytes as BlobPart], { type: obj.contentType }) : null, error: obj ? null : { message: 'Object not found' } };
    },
  };
}

export function createMockSupabaseClient(): SupabaseClient {
  const client = {
    from: (table: string) => new Query(table),
    rpc: (fn: string, args?: Record<string, unknown>) => Promise.resolve(rpc(fn, args)),
    storage: { from: () => storageBucket() },
    auth: {
      getUser: async () => ({ data: { user: DEMO_USER }, error: null }),
      getSession: async () => ({ data: { session: { user: DEMO_USER, access_token: 'demo' } }, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: DEMO_USER, session: null }, error: null }),
      signInWithOAuth: async () => ({ data: { url: '/today', provider: 'demo' }, error: null }),
      signOut: async () => ({ error: null }),
      admin: {
        getUserById: async () => ({ data: { user: DEMO_USER }, error: null }),
      },
    },
  };
  return client as unknown as SupabaseClient;
}
