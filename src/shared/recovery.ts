import { z } from 'zod';

import {
  baseRevisionSchema,
  pageIdSchema,
  PAGE_TITLE_MAX_LENGTH,
  pageTitleSchema,
  tiptapDocumentSchema,
  type TiptapDocument,
} from './pages';

export const RECOVERY_DEFAULT_LIMIT = 50;
export const RECOVERY_MAX_LIMIT = 100;
export const RECOVERY_CURSOR_MAX_LENGTH = 512;

const timestampSchema = z.string().datetime({ offset: true });

export const recoveryCursorSchema = z.string().min(1).max(RECOVERY_CURSOR_MAX_LENGTH);

export const trashPageSchema = z
  .object({
    id: pageIdSchema,
    title: pageTitleSchema,
    parentId: pageIdSchema.nullable(),
    revision: baseRevisionSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema,
  })
  .strict();

export type TrashPage = z.infer<typeof trashPageSchema>;

export const trashListResponseSchema = z
  .object({
    pages: z.array(trashPageSchema).max(RECOVERY_MAX_LIMIT),
    nextCursor: recoveryCursorSchema.nullable(),
  })
  .strict();

export type TrashListResponse = z.infer<typeof trashListResponseSchema>;

export const revisionTriggerSchema = z.enum(['interval', 'delete', 'restore']);

export const pageRevisionSummarySchema = z
  .object({
    id: pageIdSchema,
    pageId: pageIdSchema,
    sourceRevision: baseRevisionSchema,
    title: pageTitleSchema,
    trigger: revisionTriggerSchema,
    createdAt: timestampSchema,
  })
  .strict();

export type PageRevisionSummary = z.infer<typeof pageRevisionSummarySchema>;

export const pageRevisionDetailSchema = pageRevisionSummarySchema.extend({
  content: tiptapDocumentSchema,
});

export type PageRevisionDetail = PageRevisionSummary & { content: TiptapDocument };

export const revisionsListResponseSchema = z
  .object({
    revisions: z.array(pageRevisionSummarySchema).max(RECOVERY_MAX_LIMIT),
    nextCursor: recoveryCursorSchema.nullable(),
  })
  .strict();

export type RevisionsListResponse = z.infer<typeof revisionsListResponseSchema>;

export const revisionResponseSchema = z.object({ revision: pageRevisionDetailSchema }).strict();

export type RevisionResponse = z.infer<typeof revisionResponseSchema>;

export const restorePageRequestSchema = z.object({ baseRevision: baseRevisionSchema }).strict();

export type RestorePageRequest = z.infer<typeof restorePageRequestSchema>;

export const permanentDeleteRequestSchema = z
  .object({
    baseRevision: baseRevisionSchema,
    confirmationTitle: z.string().min(1).max(PAGE_TITLE_MAX_LENGTH),
  })
  .strict();

export type PermanentDeleteRequest = z.infer<typeof permanentDeleteRequestSchema>;

export const permanentDeleteResponseSchema = z
  .object({
    deleted: z.literal(true),
    pageId: pageIdSchema,
  })
  .strict();

export type PermanentDeleteResponse = z.infer<typeof permanentDeleteResponseSchema>;
