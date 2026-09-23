import { z } from 'zod';

import {
  PAGE_TITLE_MAX_LENGTH,
  baseRevisionSchema,
  pageDetailSchema,
  pageIdSchema,
  pageTitleSchema,
  tiptapDocumentSchema,
  type TiptapDocument,
} from './pages';

export const TEMPLATE_TITLE_MAX_LENGTH = PAGE_TITLE_MAX_LENGTH;
export const TIME_ZONE_MAX_LENGTH = 100;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isValidLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, 'The date must use YYYY-MM-DD format.')
  .refine(isValidLocalDate, 'The date is not a valid calendar date.');

export function isValidIanaTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(TIME_ZONE_MAX_LENGTH)
  .refine(isValidIanaTimeZone, 'The time zone must be a valid IANA time zone.');

export function localDateForTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day) {
    throw new Error('Could not determine the local date.');
  }

  return `${year.padStart(4, '0')}-${month}-${day}`;
}

export function browserTimeZone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timeZone && isValidIanaTimeZone(timeZone) ? timeZone : 'UTC';
  } catch {
    return 'UTC';
  }
}

export const templateSummarySchema = z
  .object({
    id: pageIdSchema,
    title: pageTitleSchema,
    revision: baseRevisionSchema,
    isDailyNote: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const templateDetailSchema = templateSummarySchema.extend({
  content: tiptapDocumentSchema,
});

export const templatesListResponseSchema = z
  .object({ templates: z.array(templateSummarySchema).max(200) })
  .strict();

export const templateResponseSchema = z.object({ template: templateDetailSchema }).strict();

export const createTemplateRequestSchema = z
  .object({
    title: pageTitleSchema,
    content: tiptapDocumentSchema,
    isDailyNote: z.boolean().default(false),
  })
  .strict();

export const updateTemplateRequestSchema = z
  .object({
    baseRevision: baseRevisionSchema,
    title: pageTitleSchema.optional(),
    content: tiptapDocumentSchema.optional(),
    isDailyNote: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined || value.content !== undefined || value.isDailyNote !== undefined,
    {
      message: 'At least one template field is required.',
      path: ['title'],
    },
  );

export const deleteTemplateRequestSchema = z.object({ baseRevision: baseRevisionSchema }).strict();

export const createPageFromTemplateRequestSchema = z
  .object({
    templateId: pageIdSchema,
    title: pageTitleSchema.optional(),
    parentId: pageIdSchema.nullable().default(null),
  })
  .strict();

export const dailyNoteRequestSchema = z
  .object({
    localDate: localDateSchema.optional(),
    timeZone: timeZoneSchema,
  })
  .strict();

export const dailyNoteSummarySchema = z
  .object({
    id: pageIdSchema,
    localDate: localDateSchema,
    timeZone: timeZoneSchema,
    pageId: pageIdSchema,
    templateId: pageIdSchema.nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const dailyNoteResponseSchema = z
  .object({ dailyNote: dailyNoteSummarySchema, page: pageDetailSchema })
  .strict();

export const templateDeleteResponseSchema = z
  .object({ deleted: z.literal(true), templateId: pageIdSchema })
  .strict();

export type TemplateSummary = z.infer<typeof templateSummarySchema>;
export type TemplateDetail = z.infer<typeof templateDetailSchema>;
export type TemplatesListResponse = z.infer<typeof templatesListResponseSchema>;
export type CreateTemplateRequest = z.infer<typeof createTemplateRequestSchema>;
export type UpdateTemplateRequest = z.infer<typeof updateTemplateRequestSchema>;
export type DeleteTemplateRequest = z.infer<typeof deleteTemplateRequestSchema>;
export type CreatePageFromTemplateRequest = z.infer<typeof createPageFromTemplateRequestSchema>;
export type DailyNoteRequest = z.infer<typeof dailyNoteRequestSchema>;
export type DailyNoteSummary = z.infer<typeof dailyNoteSummarySchema>;
export type DailyNoteResponse = z.infer<typeof dailyNoteResponseSchema>;
export type TemplateDeleteResponse = z.infer<typeof templateDeleteResponseSchema>;

export function emptyTemplateDocument(): TiptapDocument {
  return { type: 'doc', content: [] };
}
