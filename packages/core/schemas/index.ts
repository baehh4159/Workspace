/**
 * packages/core/schemas/index.ts
 * Shared TypeScript + Zod v3 contracts for Web (Next.js) & Mobile (Expo)
 * Supports Supabase PostgreSQL timestamptz (+00:00) via datetime({ offset: true }).
 */
import { z } from 'zod';

// -----------------------------------------------------------------------------
// Common Primitives & Constants
// -----------------------------------------------------------------------------
export const UuidSchema = z.string().uuid();
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const VisibilitySchema = z.enum(['private', 'team']);
export const WorkspaceTypeSchema = z.enum(['personal', 'team']);
export const WorkspacePlanSchema = z.enum(['free', 'pro', 'team']);
export const WorkspaceRoleSchema = z.enum(['owner', 'member']);
export const IdempotencyKeySchema = z.string().trim().min(8).max(128);

export const FREE_PLAN_LIMITS = {
  RETENTION_DAYS: 30,
  STORAGE_BYTES: 500 * 1024 * 1024, // 500 MB
  MAX_SINGLE_UPLOAD_BYTES: 50 * 1024 * 1024, // 50 MB per file
  AI_OCR_PAGES_PER_MONTH: 30,
  AI_STT_SECONDS_PER_MONTH: 15 * 60, // 15 min
  AI_TEXT_CLASSIFY_PER_MONTH: 100,
} as const;

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/webm',
  'audio/wav',
] as const;

// -----------------------------------------------------------------------------
// 1. Two-Step Presigned Upload & Scanner Ingest
// -----------------------------------------------------------------------------
export const RequestUploadUrlSchema = z.object({
  workspaceId: UuidSchema,
  sourceType: z.enum(['scanner_doc', 'quick_voice']),
  contentType: z.enum(ALLOWED_UPLOAD_MIME_TYPES),
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(FREE_PLAN_LIMITS.MAX_SINGLE_UPLOAD_BYTES),
  fileName: z.string().trim().min(1).max(200),
});

export const IngestInboxItemSchema = z
  .object({
    workspaceId: UuidSchema,
    sourceType: z.enum(['scanner_doc', 'quick_voice']),
    idempotencyKey: IdempotencyKeySchema,
    visibility: VisibilitySchema.default('private'),
    storagePath: z.string().trim().min(1).max(500),
    fileSizeBytes: z
      .number()
      .int()
      .positive()
      .max(FREE_PLAN_LIMITS.MAX_SINGLE_UPLOAD_BYTES),
    title: z.string().trim().max(200).optional(),
    pageCount: z.number().int().positive().max(500).optional(),
    audioSeconds: z.number().int().positive().max(3600).optional(),
    tagIds: z.array(UuidSchema).max(10).default([]),
  })
  .superRefine((data, ctx) => {
    const expectedPrefix = `${data.workspaceId}/`;
    if (
      !data.storagePath.startsWith(expectedPrefix) ||
      data.storagePath.includes('..') ||
      data.storagePath.includes('\\') ||
      data.storagePath.includes('\0')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['storagePath'],
        message: 'storagePath must start with "{workspaceId}/" and cannot contain path traversal.',
      });
    }

    if (data.sourceType === 'scanner_doc' && data.audioSeconds !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audioSeconds'],
        message: 'audioSeconds is not allowed when sourceType is scanner_doc.',
      });
    }
    if (data.sourceType === 'quick_voice' && data.pageCount !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pageCount'],
        message: 'pageCount is not allowed when sourceType is quick_voice.',
      });
    }
  });

// -----------------------------------------------------------------------------
// 2. Quick Capture (3s Tag -> 10s Text; AI-optional + offline idempotencyKey)
// -----------------------------------------------------------------------------
export const TagKindSchema = z.enum(['status', 'action_trigger']);

export const CreateTagSchema = z
  .object({
    workspaceId: UuidSchema,
    label: z.string().trim().min(1).max(40),
    kind: TagKindSchema,
    defaultDueOffsetDays: z.number().int().min(0).max(365).nullable().optional(),
  })
  .refine(
    (data) =>
      data.kind === 'action_trigger' || data.defaultDueOffsetDays == null,
    {
      message: 'Status tags must not define a defaultDueOffsetDays value.',
      path: ['defaultDueOffsetDays'],
    }
  );

export const QuickCaptureSchema = z
  .object({
    workspaceId: UuidSchema,
    sourceType: z.enum(['quick_tag', 'quick_text']),
    idempotencyKey: IdempotencyKeySchema.optional(),
    visibility: VisibilitySchema.default('private'),
    title: z.string().trim().max(200).optional(),
    rawText: z.string().trim().max(5000).optional(),
    tagIds: z.array(UuidSchema).max(10).default([]),
    projectId: UuidSchema.optional(),
  })
  .refine(
    (data) =>
      (data.rawText && data.rawText.length > 0) || data.tagIds.length > 0,
    {
      message: 'Quick capture requires either text or at least one tag.',
    }
  );

// -----------------------------------------------------------------------------
// 3. Inbox 2-Second Triage (Discriminated Union) & Full-Text Search
// -----------------------------------------------------------------------------
export const TriageInboxItemSchema = z.discriminatedUnion('action', [
  z.object({
    workspaceId: UuidSchema,
    action: z.literal('convert_to_task'),
    taskTitle: z.string().trim().min(1).max(200),
    taskDueAt: IsoDateTimeSchema.optional(),
    projectId: UuidSchema.optional(),
    idempotencyKey: IdempotencyKeySchema.optional(),
  }),
  z.object({
    workspaceId: UuidSchema,
    action: z.literal('link_to_project'),
    projectId: UuidSchema,
  }),
  z.object({
    workspaceId: UuidSchema,
    action: z.literal('link_to_event'),
    eventId: UuidSchema,
  }),
  z.object({
    workspaceId: UuidSchema,
    action: z.literal('archive'),
  }),
]);

export const SearchQuerySchema = z.object({
  workspaceId: UuidSchema,
  q: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export const SearchResponseSchema = z.object({
  items: z.array(
    z.object({
      id: UuidSchema,
      title: z.string().nullable(),
      snippet: z.string(),
      sourceType: z.enum(['scanner_doc', 'quick_tag', 'quick_text', 'quick_voice']),
      createdAt: IsoDateTimeSchema,
    })
  ),
  olderMatchCount: z.number().int().min(0),
  isPaywallLimited: z.boolean(),
});

// -----------------------------------------------------------------------------
// 4. Tasks, Native Events & Independent Records
// -----------------------------------------------------------------------------
export const CreateTaskSchema = z
  .object({
    workspaceId: UuidSchema,
    projectId: UuidSchema.nullable().optional(),
    sourceInboxItemId: UuidSchema.nullable().optional(),
    sourceTagId: UuidSchema.nullable().optional(),
    idempotencyKey: IdempotencyKeySchema.optional(),
    assigneeUserId: UuidSchema.optional(),
    visibility: VisibilitySchema.default('private'),
    title: z.string().trim().min(1).max(200),
    dueAt: IsoDateTimeSchema.nullable().optional(),
  })
  .refine(
    (data) => data.visibility === 'team' || data.assigneeUserId === undefined,
    {
      message: 'Private tasks cannot specify a custom assigneeUserId; the server assigns the current user.',
      path: ['assigneeUserId'],
    }
  );

export const CreateEventSchema = z
  .object({
    workspaceId: UuidSchema,
    projectId: UuidSchema.nullable().optional(),
    visibility: VisibilitySchema.default('private'),
    title: z.string().trim().min(1).max(200),
    isAllDay: z.boolean().default(false),
    timezone: z.string().trim().min(1).max(64).default('Asia/Seoul'),
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema,
    location: z.string().trim().max(250).nullable().optional(),
  })
  .refine((data) => new Date(data.endsAt) > new Date(data.startsAt), {
    message: 'Event end time must be after start time.',
    path: ['endsAt'],
  });

export const UpdateRecordVisibilitySchema = z.object({
  workspaceId: UuidSchema,
  recordId: UuidSchema,
  visibility: VisibilitySchema,
});

// -----------------------------------------------------------------------------
// 5. Guest Share Links (Create, Revoke, Whitelist View)
// -----------------------------------------------------------------------------
export const CreateShareTokenSchema = z.object({
  workspaceId: UuidSchema,
  entityType: z.enum(['inbox_item', 'project', 'task']),
  entityId: UuidSchema,
  scope: z.enum(['read_only', 'view_and_join']).default('view_and_join'),
  expiresInDays: z
    .union([z.literal(7), z.literal(14), z.literal(30)])
    .default(14),
});

export const RevokeShareTokenSchema = z.object({
  workspaceId: UuidSchema,
  shareId: UuidSchema,
});

export const GuestSharedViewSchema = z.object({
  entityType: z.enum(['inbox_item', 'project', 'task']),
  title: z.string(),
  summaryText: z.string().nullable(),
  signedFileUrl: z.string().url().nullable(),
  publicChecklist: z.array(
    z.object({
      id: UuidSchema,
      title: z.string(),
      status: z.enum(['todo', 'in_progress', 'waiting', 'done']),
      dueAt: IsoDateTimeSchema.nullable(),
    })
  ),
  expiresAt: IsoDateTimeSchema,
});

// -----------------------------------------------------------------------------
// 6. AI Quota Metering
// -----------------------------------------------------------------------------
export const AiUsageTypeSchema = z.enum([
  'text_classify',
  'doc_ocr_pages',
  'voice_stt_seconds',
]);

export const ReserveAiQuotaSchema = z.object({
  workspaceId: UuidSchema,
  userId: UuidSchema,
  periodYm: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM format'),
  usageType: AiUsageTypeSchema,
  units: z.number().positive(),
});

export type RequestUploadUrlInput = z.infer<typeof RequestUploadUrlSchema>;
export type IngestInboxItemInput = z.infer<typeof IngestInboxItemSchema>;
export type QuickCaptureInput = z.infer<typeof QuickCaptureSchema>;
export type TriageInboxItemInput = z.infer<typeof TriageInboxItemSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type CreateShareTokenInput = z.infer<typeof CreateShareTokenSchema>;
export type RevokeShareTokenInput = z.infer<typeof RevokeShareTokenSchema>;
export type ReserveAiQuotaInput = z.infer<typeof ReserveAiQuotaSchema>;