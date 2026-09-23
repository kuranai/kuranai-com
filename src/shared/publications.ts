import { z } from 'zod';

import { assetIdSchema } from './assets';
import {
  baseRevisionSchema,
  derivePlainText,
  pageIdSchema,
  pageTitleSchema,
  validateTiptapDocument,
  type TiptapDocument,
  type TiptapNode,
} from './pages';
import { MAX_PAGE_TAGS, pageTagIdsSchema, tagNameSchema } from './tags';

export const PUBLICATION_DEFAULT_LIMIT = 100;
export const PUBLICATION_MAX_LIMIT = 100;
export const PUBLICATION_CURSOR_MAX_LENGTH = 512;

export const publicIdSchema = z.string().uuid();
export const publicationCursorSchema = z.string().min(1).max(PUBLICATION_CURSOR_MAX_LENGTH);

const timestampSchema = z.string().datetime({ offset: true });

export type PublicTiptapNode = TiptapNode;

export interface PublicTiptapDocument extends Omit<TiptapDocument, 'content'> {
  content: PublicTiptapNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function publicDocumentForValidation(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(publicDocumentForValidation);
  }

  if (!isRecord(value)) {
    return value;
  }

  if (value.type === 'publicWikiLink') {
    const attrs = isRecord(value.attrs) ? value.attrs : {};
    return {
      ...value,
      attrs: {
        targetPageId: null,
        targetTitle: attrs.targetTitle,
      },
      type: 'wikiLink',
    };
  }

  if (value.type === 'wikiLink') {
    return { ...value, type: 'unsupportedPublicWikiLink' };
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, publicDocumentForValidation(entry)]),
  );
}

function publicWikiLinkIssues(value: unknown, path: Array<string | number> = []) {
  const issues: Array<{ path: Array<string | number>; message: string }> = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => issues.push(...publicWikiLinkIssues(entry, [...path, index])));
    return issues;
  }
  if (!isRecord(value)) {
    return issues;
  }

  if (value.type === 'publicWikiLink') {
    const attrs = value.attrs;
    if (
      !isRecord(attrs) ||
      Object.keys(attrs).some((key) => !['targetPublicId', 'targetTitle'].includes(key))
    ) {
      issues.push({
        path: [...path, 'attrs'],
        message: 'Public wiki-link attributes are invalid.',
      });
    } else {
      if (!publicIdSchema.safeParse(attrs.targetPublicId).success) {
        issues.push({
          path: [...path, 'attrs', 'targetPublicId'],
          message: 'A public wiki link must reference a public UUID.',
        });
      }
      if (!pageTitleSchema.safeParse(attrs.targetTitle).success) {
        issues.push({
          path: [...path, 'attrs', 'targetTitle'],
          message: 'A public wiki link must contain a valid title.',
        });
      }
    }
  }

  for (const [key, entry] of Object.entries(value)) {
    issues.push(...publicWikiLinkIssues(entry, [...path, key]));
  }
  return issues;
}

export function validatePublicTiptapDocument(value: unknown) {
  return [
    ...validateTiptapDocument(publicDocumentForValidation(value)),
    ...publicWikiLinkIssues(value),
  ].slice(0, 20);
}

export const publicTiptapDocumentSchema = z.custom<PublicTiptapDocument>(
  (value) => validatePublicTiptapDocument(value).length === 0,
  { message: 'The public document contains unsupported or invalid content.' },
);

export function collectPublicAssetIds(document: PublicTiptapDocument) {
  const assetIds = new Set<string>();
  const visit = (node: TiptapNode) => {
    if (node.type === 'assetImage' || node.type === 'attachment') {
      const assetId = node.attrs?.assetId;
      if (typeof assetId === 'string' && assetIdSchema.safeParse(assetId).success) {
        assetIds.add(assetId);
      }
    }
    node.content?.forEach(visit);
  };
  document.content.forEach(visit);
  return [...assetIds];
}

export function derivePublicPlainText(document: PublicTiptapDocument) {
  const normalized = JSON.parse(JSON.stringify(document)) as TiptapDocument;
  const visit = (node: TiptapNode): TiptapNode => {
    if (node.type === 'publicWikiLink') {
      const title = node.attrs?.targetTitle;
      return { type: 'wikiLink', attrs: { targetPageId: null, targetTitle: title } };
    }
    return {
      ...node,
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
  };
  normalized.content = normalized.content.map(visit);
  return derivePlainText(normalized);
}

export const publicPublicationSummarySchema = z
  .object({
    publicId: publicIdSchema,
    publishedTitle: pageTitleSchema,
    publishedAt: timestampSchema,
    updatedAt: timestampSchema,
    allowIndexing: z.boolean(),
    parentPublicId: publicIdSchema.nullable().default(null),
    position: z.number().int().nonnegative().default(0),
    tags: z.array(tagNameSchema).max(MAX_PAGE_TAGS).default([]),
  })
  .strict();

export type PublicPublicationSummary = z.infer<typeof publicPublicationSummarySchema>;

export const publicPublicationSchema = publicPublicationSummarySchema.extend({
  content: publicTiptapDocumentSchema,
});

export type PublicPublication = z.infer<typeof publicPublicationSchema>;

export const publicPublicationsResponseSchema = z
  .object({
    publications: z.array(publicPublicationSummarySchema).max(PUBLICATION_MAX_LIMIT),
    nextCursor: publicationCursorSchema.nullable(),
  })
  .strict();

export type PublicPublicationsResponse = z.infer<typeof publicPublicationsResponseSchema>;

export const publicPublicationResponseSchema = z
  .object({ publication: publicPublicationSchema })
  .strict();

export const privatePublicationSchema = z
  .object({
    publicId: publicIdSchema,
    publicUrl: z.string().startsWith('/p/'),
    sourceRevision: baseRevisionSchema,
    publishedTitle: pageTitleSchema,
    allowIndexing: z.boolean(),
    publishedAt: timestampSchema,
    updatedAt: timestampSchema,
    tags: z.array(tagNameSchema).max(MAX_PAGE_TAGS).default([]),
  })
  .strict();

export type PrivatePublication = z.infer<typeof privatePublicationSchema>;

export const privatePublicationResponseSchema = z
  .object({ publication: privatePublicationSchema.nullable() })
  .strict();

export const publishPublicationRequestSchema = z
  .object({
    baseRevision: baseRevisionSchema,
    allowIndexing: z.boolean().default(false),
    tagIds: pageTagIdsSchema.default([]),
  })
  .strict();

export type PublishPublicationRequest = z.infer<typeof publishPublicationRequestSchema>;

export const unpublishPublicationRequestSchema = z
  .object({
    publicId: publicIdSchema,
    expectedUpdatedAt: timestampSchema,
  })
  .strict();

export type UnpublishPublicationRequest = z.infer<typeof unpublishPublicationRequestSchema>;

export const unpublishPublicationResponseSchema = z
  .object({ unpublished: z.literal(true), publicId: publicIdSchema })
  .strict();

export const publicationEditorTargetResponseSchema = z.object({ pageId: pageIdSchema }).strict();
