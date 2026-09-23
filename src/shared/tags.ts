import { z } from 'zod';

export const TAG_NAME_MAX_LENGTH = 50;
export const MAX_PAGE_TAGS = 50;
export const TAG_DEFAULT_LIMIT = 100;
export const TAG_MAX_LIMIT = 200;

export const tagIdSchema = z.string().uuid();

function hasUnsafeControlCharacters(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function characterLength(value: string) {
  return [...value].length;
}

export function normalizeTagName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function normalizeTagNameForComparison(value: string) {
  return normalizeTagName(value).toLocaleLowerCase('en-US');
}

export const tagNameInputSchema = z.string().transform((value, context) => {
  const normalized = normalizeTagName(value);
  if (
    normalized.length === 0 ||
    characterLength(normalized) > TAG_NAME_MAX_LENGTH ||
    hasUnsafeControlCharacters(value)
  ) {
    context.addIssue({ code: 'custom', message: 'Tag names must be 1–50 safe characters.' });
    return z.NEVER;
  }
  return normalized;
});

export const tagNameSchema = z
  .string()
  .min(1)
  .max(TAG_NAME_MAX_LENGTH)
  .refine((value) => characterLength(value) <= TAG_NAME_MAX_LENGTH)
  .refine((value) => !hasUnsafeControlCharacters(value));

export const tagSummarySchema = z
  .object({
    id: tagIdSchema,
    name: tagNameSchema,
  })
  .strict();

export type TagSummary = z.infer<typeof tagSummarySchema>;

export const createTagRequestSchema = z.object({ name: tagNameInputSchema }).strict();

export const updateTagRequestSchema = createTagRequestSchema;

export const tagListResponseSchema = z
  .object({ tags: z.array(tagSummarySchema).max(TAG_MAX_LIMIT) })
  .strict();

export const tagResponseSchema = z.object({ tag: tagSummarySchema }).strict();

export const deleteTagResponseSchema = z
  .object({ deleted: z.literal(true), tagId: tagIdSchema })
  .strict();

export const pageTagIdsSchema = z
  .array(tagIdSchema)
  .max(MAX_PAGE_TAGS)
  .refine((values) => new Set(values).size === values.length, {
    message: 'Tag ids must be unique.',
  });

export const updatePageTagsRequestSchema = z.object({ tagIds: pageTagIdsSchema }).strict();

export const updatePageFavoriteRequestSchema = z.object({ isFavorite: z.boolean() }).strict();

export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;
export type UpdateTagRequest = z.infer<typeof updateTagRequestSchema>;
export type UpdatePageTagsRequest = z.infer<typeof updatePageTagsRequestSchema>;
export type UpdatePageFavoriteRequest = z.infer<typeof updatePageFavoriteRequestSchema>;
