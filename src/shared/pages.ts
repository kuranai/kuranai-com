import { z } from 'zod';

import { tagSummarySchema, type TagSummary } from './tags';

export const PAGE_TITLE_MAX_LENGTH = 200;
export const PAGE_SLUG_MAX_LENGTH = 200;
export const MAX_PAGE_ROW_BYTES = 1_800_000;
export const MAX_PAGE_REQUEST_BYTES = MAX_PAGE_ROW_BYTES + 64_000;
export const MAX_DOCUMENT_DEPTH = 100;
export const WIKI_LINK_SEARCH_DEFAULT_LIMIT = 8;
export const WIKI_LINK_SEARCH_MAX_RESULTS = 20;
export const emptyDocument = '{"type":"doc","content":[]}';

export interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
}

export interface TiptapDocument {
  type: 'doc';
  content: TiptapNode[];
}

export interface WikiLinkReference {
  targetPageId: string | null;
  targetTitle: string;
  targetTitleNormalized: string;
}

export interface PageSummary {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  position: number;
  revision: number;
  updatedAt: string;
  isFavorite: boolean;
  tags: TagSummary[];
}

export interface PageDetail extends PageSummary {
  createdAt: string;
  content: TiptapDocument;
  contentText: string;
  deletedAt: string | null;
}

export interface DocumentValidationIssue {
  path: Array<string | number>;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isUuid(value: unknown) {
  return typeof value === 'string' && z.string().uuid().safeParse(value).success;
}

function hasUnsafeControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function normalizeWikiLinkTitle(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function normalizedWikiLinkTitle(value: string) {
  return value.trim().replace(/\s+/gu, ' ');
}

function addIssue(
  issues: DocumentValidationIssue[],
  path: Array<string | number>,
  message: string,
) {
  if (issues.length < 20) {
    issues.push({ message, path });
  }
}

function validateLinkAttributes(
  attrs: unknown,
  path: Array<string | number>,
  issues: DocumentValidationIssue[],
) {
  if (!isRecord(attrs) || !hasOnlyKeys(attrs, ['href', 'target', 'rel', 'class'])) {
    addIssue(issues, path, 'Link attributes are invalid.');
    return;
  }

  if (typeof attrs.href !== 'string' || attrs.href.length === 0 || attrs.href.length > 2_048) {
    addIssue(issues, [...path, 'href'], 'A link must contain a valid href.');
    return;
  }

  if (hasUnsafeControlCharacters(attrs.href)) {
    addIssue(issues, [...path, 'href'], 'A link href cannot contain control characters.');
  }

  try {
    const protocol = new URL(attrs.href, 'https://dovari.invalid').protocol;
    if (!['http:', 'https:', 'mailto:'].includes(protocol)) {
      addIssue(issues, [...path, 'href'], 'This link protocol is not allowed.');
    }
  } catch {
    addIssue(issues, [...path, 'href'], 'A link must contain a valid href.');
  }

  for (const key of ['target', 'rel', 'class']) {
    const value = attrs[key];
    if (value !== undefined && value !== null) {
      if (typeof value !== 'string') {
        addIssue(issues, [...path, key], 'Link attributes must be strings or null.');
      } else if (value.length > 200 || hasUnsafeControlCharacters(value)) {
        addIssue(issues, [...path, key], 'Link attributes contain invalid characters.');
      }
    }
  }
}

function validateMarks(
  value: unknown,
  path: Array<string | number>,
  issues: DocumentValidationIssue[],
) {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'Marks must be an array.');
    return;
  }

  value.forEach((mark, index) => {
    const markPath = [...path, index];
    if (!isRecord(mark) || typeof mark.type !== 'string') {
      addIssue(issues, markPath, 'A mark must have a type.');
      return;
    }

    if (!hasOnlyKeys(mark, ['type', 'attrs'])) {
      addIssue(issues, markPath, 'A mark contains unsupported fields.');
      return;
    }

    if (!['bold', 'italic', 'strike', 'code', 'link'].includes(mark.type)) {
      addIssue(issues, [...markPath, 'type'], `The mark '${mark.type}' is not allowed.`);
      return;
    }

    if (mark.type === 'link') {
      validateLinkAttributes(mark.attrs, [...markPath, 'attrs'], issues);
    } else if (mark.attrs !== undefined) {
      addIssue(issues, [...markPath, 'attrs'], 'This mark does not accept attributes.');
    }
  });
}

function validateAssetAttributes(
  attrs: unknown,
  path: Array<string | number>,
  issues: DocumentValidationIssue[],
  attachment: boolean,
) {
  const allowedKeys = attachment
    ? ['assetId', 'filename', 'title']
    : ['assetId', 'alt', 'title', 'width', 'height'];

  if (!isRecord(attrs) || !hasOnlyKeys(attrs, allowedKeys)) {
    addIssue(issues, path, 'Asset attributes are invalid.');
    return;
  }

  if (!isUuid(attrs.assetId)) {
    addIssue(issues, [...path, 'assetId'], 'An asset node must reference a UUID.');
  }

  for (const key of attachment ? ['filename', 'title'] : ['alt', 'title']) {
    const value = attrs[key];
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== 'string' || value.length > 500 || hasUnsafeControlCharacters(value))
    ) {
      addIssue(issues, [...path, key], 'Asset text attributes must be short strings or null.');
    }
  }

  if (!attachment) {
    for (const key of ['width', 'height']) {
      const value = attrs[key];
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 100_000)
      ) {
        addIssue(issues, [...path, key], 'Asset dimensions must be positive integers.');
      }
    }
  }
}

function validateWikiLinkAttributes(
  attrs: unknown,
  path: Array<string | number>,
  issues: DocumentValidationIssue[],
) {
  if (!isRecord(attrs) || !hasOnlyKeys(attrs, ['targetPageId', 'targetTitle'])) {
    addIssue(issues, path, 'Wiki-link attributes are invalid.');
    return;
  }

  if (
    attrs.targetPageId !== null &&
    attrs.targetPageId !== undefined &&
    !isUuid(attrs.targetPageId)
  ) {
    addIssue(issues, [...path, 'targetPageId'], 'A wiki link must reference a valid page UUID.');
  }

  if (
    typeof attrs.targetTitle !== 'string' ||
    attrs.targetTitle.trim().length === 0 ||
    attrs.targetTitle.length > PAGE_TITLE_MAX_LENGTH ||
    hasUnsafeControlCharacters(attrs.targetTitle)
  ) {
    addIssue(issues, [...path, 'targetTitle'], 'A wiki link must contain a valid page title.');
  }
}

function validateNode(
  value: unknown,
  path: Array<string | number>,
  context: 'root' | 'block' | 'inline' | 'code',
  depth: number,
  issues: DocumentValidationIssue[],
  parentType: string | null,
  ancestors: WeakSet<object>,
) {
  if (depth > MAX_DOCUMENT_DEPTH) {
    addIssue(issues, path, 'The document is nested too deeply.');
    return;
  }

  if (!isRecord(value) || typeof value.type !== 'string') {
    addIssue(issues, path, 'Every document node must have a type.');
    return;
  }

  if (ancestors.has(value)) {
    addIssue(issues, path, 'The document contains a cyclic node reference.');
    return;
  }

  ancestors.add(value);

  try {
    if (!hasOnlyKeys(value, ['type', 'attrs', 'content', 'text', 'marks'])) {
      addIssue(issues, path, 'A document node contains unsupported fields.');
    }

    const type = value.type;
    const childPath = [...path, 'content'];

    if (type === 'text') {
      if (!['inline', 'code'].includes(context)) {
        addIssue(issues, path, 'Text nodes are only allowed inside text content.');
      }
      if (typeof value.text !== 'string' || value.text.length === 0) {
        addIssue(issues, [...path, 'text'], 'Text nodes must contain text.');
      }
      if (value.attrs !== undefined || value.content !== undefined) {
        addIssue(issues, path, 'Text nodes cannot contain attributes or child nodes.');
      }
      if (value.marks !== undefined) {
        if (context === 'code') {
          if (!Array.isArray(value.marks) || value.marks.length > 0) {
            addIssue(issues, [...path, 'marks'], 'Code block text cannot contain marks.');
          }
        } else {
          validateMarks(value.marks, [...path, 'marks'], issues);
        }
      }
      return;
    }

    if (value.text !== undefined || value.marks !== undefined) {
      addIssue(issues, path, 'Only text nodes may contain text or marks.');
    }

    const hasContent = value.content !== undefined;
    const visitContent = (
      childrenContext: 'block' | 'inline' | 'code',
      required: boolean,
      requireNonEmpty = false,
      requireFirstParagraph = false,
      allowedChildTypes?: readonly string[],
    ) => {
      if (!hasContent) {
        if (required) {
          addIssue(issues, childPath, 'This node must contain a content array.');
        }
        return;
      }
      if (!Array.isArray(value.content)) {
        addIssue(issues, childPath, 'Node content must be an array.');
        return;
      }

      if (requireNonEmpty && value.content.length === 0) {
        addIssue(issues, childPath, 'This node must contain at least one child.');
      }

      if (requireFirstParagraph && value.content[0] !== undefined) {
        if (!isRecord(value.content[0]) || value.content[0].type !== 'paragraph') {
          addIssue(issues, [...childPath, 0], 'A list item must start with a paragraph.');
        }
      }

      value.content.forEach((child, index) =>
        (() => {
          if (
            allowedChildTypes !== undefined &&
            (!isRecord(child) ||
              typeof child.type !== 'string' ||
              !allowedChildTypes.includes(child.type))
          ) {
            addIssue(
              issues,
              [...childPath, index, 'type'],
              `Only ${allowedChildTypes.join(' or ')} nodes are allowed here.`,
            );
          }

          validateNode(
            child,
            [...childPath, index],
            childrenContext,
            depth + 1,
            issues,
            type,
            ancestors,
          );
        })(),
      );
    };
    const requireContent = (
      childrenContext: 'block' | 'inline' | 'code',
      requireNonEmpty = false,
      requireFirstParagraph = false,
      allowedChildTypes?: readonly string[],
    ) =>
      visitContent(
        childrenContext,
        true,
        requireNonEmpty,
        requireFirstParagraph,
        allowedChildTypes,
      );
    const optionalContent = (childrenContext: 'block' | 'inline' | 'code') =>
      visitContent(childrenContext, false);
    const noContent = () => {
      if (hasContent) {
        addIssue(issues, childPath, 'This node cannot contain child nodes.');
      }
    };
    const noAttrs = () => {
      if (value.attrs !== undefined) {
        addIssue(issues, [...path, 'attrs'], 'This node does not accept attributes.');
      }
    };
    const requireBlockContext = () => {
      if (!['root', 'block'].includes(context)) {
        addIssue(issues, path, `The node '${type}' is not allowed here.`);
      }
    };

    if (context === 'root' && type !== 'doc') {
      addIssue(issues, [...path, 'type'], 'The root node must be a document node.');
    }

    switch (type) {
      case 'doc':
        if (context !== 'root' || parentType !== null) {
          addIssue(issues, path, 'A document node is only allowed at the root.');
        }
        noAttrs();
        requireContent('block');
        break;
      case 'paragraph':
        requireBlockContext();
        noAttrs();
        optionalContent('inline');
        break;
      case 'heading':
        requireBlockContext();
        if (
          value.attrs !== undefined &&
          (!isRecord(value.attrs) ||
            !hasOnlyKeys(value.attrs, ['level']) ||
            !Number.isInteger(value.attrs.level) ||
            ![1, 2, 3].includes(value.attrs.level as number))
        ) {
          addIssue(issues, [...path, 'attrs'], 'Heading level must be 1, 2, or 3.');
        }
        optionalContent('inline');
        break;
      case 'bulletList':
        requireBlockContext();
        noAttrs();
        requireContent('block', true, false, ['listItem']);
        break;
      case 'orderedList':
        requireBlockContext();
        if (
          value.attrs !== undefined &&
          (!isRecord(value.attrs) ||
            !hasOnlyKeys(value.attrs, ['start']) ||
            (value.attrs.start !== undefined &&
              value.attrs.start !== null &&
              (!Number.isInteger(value.attrs.start) || (value.attrs.start as number) < 0)))
        ) {
          addIssue(issues, [...path, 'attrs'], 'Ordered-list attributes are invalid.');
        }
        requireContent('block', true, false, ['listItem']);
        break;
      case 'taskList':
        requireBlockContext();
        noAttrs();
        requireContent('block', true, false, ['taskItem']);
        break;
      case 'listItem':
        if (context !== 'block' || !['bulletList', 'orderedList'].includes(parentType ?? '')) {
          addIssue(issues, path, 'List items are only allowed inside bullet or ordered lists.');
        }
        noAttrs();
        requireContent('block', true, true);
        break;
      case 'taskItem':
        if (context !== 'block' || parentType !== 'taskList') {
          addIssue(issues, path, 'Task items are only allowed inside task lists.');
        }
        if (
          value.attrs !== undefined &&
          (!isRecord(value.attrs) ||
            !hasOnlyKeys(value.attrs, ['checked']) ||
            typeof value.attrs.checked !== 'boolean')
        ) {
          addIssue(issues, [...path, 'attrs'], 'Task-item attributes are invalid.');
        }
        requireContent('block', true, true);
        break;
      case 'blockquote':
        requireBlockContext();
        noAttrs();
        requireContent('block', true);
        break;
      case 'horizontalRule':
        requireBlockContext();
        noAttrs();
        noContent();
        break;
      case 'hardBreak':
        if (context !== 'inline') {
          addIssue(issues, path, 'Hard breaks are only allowed inside text content.');
        }
        noAttrs();
        noContent();
        break;
      case 'codeBlock':
        requireBlockContext();
        if (
          value.attrs !== undefined &&
          (!isRecord(value.attrs) ||
            !hasOnlyKeys(value.attrs, ['language']) ||
            (value.attrs.language !== undefined &&
              value.attrs.language !== null &&
              (typeof value.attrs.language !== 'string' ||
                value.attrs.language.length > 100 ||
                hasUnsafeControlCharacters(value.attrs.language) ||
                /\s/.test(value.attrs.language))))
        ) {
          addIssue(issues, [...path, 'attrs'], 'Code-block attributes are invalid.');
        }
        optionalContent('code');
        break;
      case 'assetImage':
        if (!['block', 'inline'].includes(context)) {
          addIssue(issues, path, 'Asset images are not allowed here.');
        }
        validateAssetAttributes(value.attrs, [...path, 'attrs'], issues, false);
        noContent();
        break;
      case 'attachment':
        if (!['block', 'inline'].includes(context)) {
          addIssue(issues, path, 'Attachments are not allowed here.');
        }
        validateAssetAttributes(value.attrs, [...path, 'attrs'], issues, true);
        noContent();
        break;
      case 'wikiLink':
        if (context !== 'inline') {
          addIssue(issues, path, 'Wiki links are only allowed inside text content.');
        }
        validateWikiLinkAttributes(value.attrs, [...path, 'attrs'], issues);
        noContent();
        break;
      default:
        addIssue(issues, [...path, 'type'], `The node '${type}' is not allowed.`);
    }
  } finally {
    ancestors.delete(value);
  }
}

export function validateTiptapDocument(value: unknown): DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  validateNode(value, [], 'root', 0, issues, null, new WeakSet<object>());
  return issues;
}

export function collectAssetIds(document: TiptapDocument) {
  const assetIds = new Set<string>();

  const visit = (node: TiptapNode) => {
    if (node.type === 'assetImage' || node.type === 'attachment') {
      const assetId = node.attrs?.assetId;
      if (typeof assetId === 'string') {
        assetIds.add(assetId);
      }
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  };

  for (const node of document.content) {
    visit(node);
  }

  return [...assetIds];
}

export function collectWikiLinkReferences(document: TiptapDocument): WikiLinkReference[] {
  const links = new Map<string, WikiLinkReference>();

  const visit = (node: TiptapNode) => {
    if (node.type === 'wikiLink') {
      const rawTitle = node.attrs?.targetTitle;
      const targetTitle = typeof rawTitle === 'string' ? normalizedWikiLinkTitle(rawTitle) : '';
      const targetTitleNormalized = normalizeWikiLinkTitle(targetTitle);
      if (targetTitle.length > 0 && targetTitleNormalized.length > 0) {
        const rawTargetPageId = node.attrs?.targetPageId;
        const targetPageId = typeof rawTargetPageId === 'string' ? rawTargetPageId : null;
        const previous = links.get(targetTitleNormalized);
        if (!previous || (previous.targetPageId === null && targetPageId !== null)) {
          links.set(targetTitleNormalized, {
            targetPageId,
            targetTitle,
            targetTitleNormalized,
          });
        }
      }
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  };

  for (const node of document.content) {
    visit(node);
  }

  return [...links.values()];
}

export const tiptapDocumentSchema = z.custom<TiptapDocument>(
  (value) => validateTiptapDocument(value).length === 0,
  { message: 'The document contains unsupported or invalid content.' },
);

export const pageIdSchema = z.string().uuid();
export const pageTitleSchema = z.string().trim().min(1).max(PAGE_TITLE_MAX_LENGTH);
export const pageSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(PAGE_SLUG_MAX_LENGTH)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const baseRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const createPageRequestSchema = z
  .object({
    title: pageTitleSchema,
    parentId: pageIdSchema.nullable().default(null),
  })
  .strict();

export const updatePageRequestSchema = z
  .object({
    baseRevision: baseRevisionSchema,
    title: pageTitleSchema.optional(),
    slug: pageSlugSchema.optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.slug !== undefined, {
    message: 'At least one page metadata field is required.',
    path: ['title'],
  });

export const updatePageContentRequestSchema = z
  .object({
    baseRevision: baseRevisionSchema,
    content: tiptapDocumentSchema,
  })
  .strict();

export const deletePageRequestSchema = z
  .object({
    baseRevision: baseRevisionSchema,
  })
  .strict();

export const movePageRequestSchema = z
  .object({
    parentId: pageIdSchema.nullable(),
    beforeId: pageIdSchema.optional(),
    afterId: pageIdSchema.optional(),
  })
  .strict()
  .refine((value) => value.beforeId === undefined || value.afterId === undefined, {
    message: 'A move can use either beforeId or afterId, not both.',
    path: ['beforeId'],
  });

export const pageSummarySchema = z
  .object({
    id: pageIdSchema,
    title: pageTitleSchema,
    slug: pageSlugSchema,
    parentId: pageIdSchema.nullable(),
    position: z.number().int().nonnegative(),
    revision: baseRevisionSchema,
    updatedAt: z.string().datetime({ offset: true }),
    isFavorite: z.boolean(),
    tags: z.array(tagSummarySchema).max(50),
  })
  .strict();

export const pageDetailSchema = pageSummarySchema.extend({
  createdAt: z.string().datetime({ offset: true }),
  content: tiptapDocumentSchema,
  contentText: z.string(),
  deletedAt: z.string().datetime({ offset: true }).nullable(),
});

export const pagesListResponseSchema = z
  .object({ pages: z.array(pageSummarySchema).max(100) })
  .strict();

export const pageResponseSchema = z.object({ page: pageDetailSchema }).strict();

export const wikiLinkSearchResponseSchema = z
  .object({ pages: z.array(pageSummarySchema).max(WIKI_LINK_SEARCH_MAX_RESULTS) })
  .strict();

export const pageBacklinksResponseSchema = z
  .object({ backlinks: z.array(pageSummarySchema).max(100) })
  .strict();

export function derivePlainText(document: TiptapDocument): string {
  const inlineText = (node: TiptapNode): string => {
    switch (node.type) {
      case 'text':
        return node.text ?? '';
      case 'assetImage': {
        const alt = node.attrs?.alt;
        return typeof alt === 'string' ? alt : '';
      }
      case 'attachment': {
        const filename = node.attrs?.filename;
        return typeof filename === 'string' ? filename : '';
      }
      case 'wikiLink': {
        const title = node.attrs?.targetTitle;
        return typeof title === 'string' ? title : '';
      }
      case 'hardBreak':
        return '\n';
      default:
        return (node.content ?? []).map(inlineText).join('');
    }
  };

  const blockText = (node: TiptapNode): string => {
    switch (node.type) {
      case 'text':
      case 'assetImage':
      case 'attachment':
      case 'wikiLink':
      case 'hardBreak':
        return inlineText(node);
      case 'horizontalRule':
        return '';
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
        return (node.content ?? []).map(inlineText).join('');
      default:
        return (node.content ?? []).map(blockText).join('\n');
    }
  };

  return blockText(document)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, '\n');
}

function stringAttribute(node: TiptapNode, name: string) {
  const value = node.attrs?.[name];
  return typeof value === 'string' ? value : undefined;
}

function numberAttribute(node: TiptapNode, name: string) {
  const value = node.attrs?.[name];
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function booleanAttribute(node: TiptapNode, name: string) {
  return node.attrs?.[name] === true;
}

function escapeMarkdownText(value: string) {
  return normalizeLineEndings(value)
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]~])/g, '\\$1')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/&/g, '\\&')
    .replace(/^( {0,3})(#{1,6})(?=\s)/gm, '$1\\$2')
    .replace(/^( {0,3})([-+])(?=\s)/gm, '$1\\$2')
    .replace(/^( {0,3})(\d+)\.(?=\s)/gm, '$1$2\\.');
}

function escapeMarkdownCodeSpan(value: string) {
  const normalized = normalizeLineEndings(value);
  const longestBacktickRun = Math.max(
    0,
    ...(normalized.match(/`+/g) ?? []).map((run) => run.length),
  );
  const delimiter = '`'.repeat(longestBacktickRun + 1);
  const padding = normalized.startsWith(' ') || normalized.endsWith(' ') ? ' ' : '';
  return `${delimiter}${padding}${normalized}${padding}${delimiter}`;
}

function escapeMarkdownLinkDestination(value: string) {
  return normalizeLineEndings(value)
    .replace(/\\/g, '\\\\')
    .replace(/[()]/g, '\\$&')
    .replace(/\s/g, (character) => encodeURIComponent(character));
}

function escapeMarkdownTitle(value: string) {
  return normalizeLineEndings(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const markdownMarkOrder: Record<string, number> = {
  bold: 10,
  italic: 20,
  strike: 30,
  link: 40,
};

export interface MarkdownRenderOptions {
  assetPath?: (assetId: string) => string;
  wikiLinkPath?: (targetPageId: string | null, targetTitle: string) => string | null;
}

function renderMarkedText(node: TiptapNode) {
  const source = node.text ?? '';
  const marks = [...(node.marks ?? [])].filter((mark) => mark.type !== 'code');
  const hasCodeMark = (node.marks ?? []).some((mark) => mark.type === 'code');
  let rendered = hasCodeMark ? escapeMarkdownCodeSpan(source) : escapeMarkdownText(source);

  marks
    .sort(
      (left, right) =>
        (markdownMarkOrder[left.type] ?? 100) - (markdownMarkOrder[right.type] ?? 100),
    )
    .forEach((mark) => {
      switch (mark.type) {
        case 'bold':
          rendered = `**${rendered}**`;
          break;
        case 'italic':
          rendered = `*${rendered}*`;
          break;
        case 'strike':
          rendered = `~~${rendered}~~`;
          break;
        case 'link': {
          const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
          rendered = `[${rendered}](${escapeMarkdownLinkDestination(href)})`;
          break;
        }
        default:
          break;
      }
    });

  return rendered;
}

function renderAssetPath(assetId: string) {
  return `assets/${assetId}`;
}

function renderAssetTitle(title: string | undefined) {
  return title === undefined ? '' : ` "${escapeMarkdownTitle(title)}"`;
}

function renderInlineMarkdown(node: TiptapNode, options: MarkdownRenderOptions): string {
  switch (node.type) {
    case 'text':
      return renderMarkedText(node);
    case 'hardBreak':
      return '\\' + '\n';
    case 'assetImage': {
      const assetId = stringAttribute(node, 'assetId') ?? '';
      const alt = stringAttribute(node, 'alt') ?? '';
      const title = stringAttribute(node, 'title');
      const assetPath = options.assetPath?.(assetId) ?? renderAssetPath(assetId);
      return `![${escapeMarkdownText(alt)}](${escapeMarkdownLinkDestination(assetPath)}${renderAssetTitle(title)})`;
    }
    case 'attachment': {
      const assetId = stringAttribute(node, 'assetId') ?? '';
      const filename = stringAttribute(node, 'filename') ?? 'Attachment';
      const title = stringAttribute(node, 'title');
      const assetPath = options.assetPath?.(assetId) ?? renderAssetPath(assetId);
      return `[${escapeMarkdownText(filename)}](${escapeMarkdownLinkDestination(assetPath)}${renderAssetTitle(title)})`;
    }
    case 'wikiLink': {
      const title = stringAttribute(node, 'targetTitle') ?? '';
      const targetPageId = stringAttribute(node, 'targetPageId') ?? null;
      const wikiLinkPath = options.wikiLinkPath?.(targetPageId, title);
      return wikiLinkPath === null || wikiLinkPath === undefined
        ? `[[${escapeMarkdownText(title)}]]`
        : `[${escapeMarkdownText(title)}](${escapeMarkdownLinkDestination(wikiLinkPath)})`;
    }
    default:
      return (node.content ?? []).map((child) => renderInlineMarkdown(child, options)).join('');
  }
}

function renderCodeBlock(node: TiptapNode, options: MarkdownRenderOptions) {
  const code = normalizeLineEndings(
    (node.content ?? [])
      .map((child) =>
        child.type === 'text' ? (child.text ?? '') : renderInlineMarkdown(child, options),
      )
      .join(''),
  );
  const longestBacktickRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));
  const language = stringAttribute(node, 'language') ?? '';
  const content = code.endsWith('\n') ? code : `${code}\n`;
  return `${fence}${language}\n${content}${fence}`;
}

function renderListItem(
  node: TiptapNode,
  marker: string,
  indentation: string,
  options: MarkdownRenderOptions,
) {
  const children = node.content ?? [];
  const firstBlock = children[0] === undefined ? '' : renderBlockMarkdown(children[0], options);
  const firstLines = firstBlock.split('\n');
  const contentIndent = `${indentation}${' '.repeat(marker.length + 1)}`;
  const lines = [`${indentation}${marker} ${firstLines[0] ?? ''}`];

  lines.push(...firstLines.slice(1).map((line) => `${contentIndent}${line}`));

  for (const child of children.slice(1)) {
    const childLines = renderBlockMarkdown(child, options).split('\n');
    const nestedIndentation = `${indentation}  `;
    lines.push(...childLines.map((line) => `${nestedIndentation}${line}`));
  }

  return lines.join('\n');
}

function renderListMarkdown(node: TiptapNode, options: MarkdownRenderOptions, indentation = '') {
  const children = node.content ?? [];
  const ordered = node.type === 'orderedList';
  const task = node.type === 'taskList';
  const start = numberAttribute(node, 'start') ?? 1;

  return children
    .map((child, index) => {
      const marker = task
        ? booleanAttribute(child, 'checked')
          ? '- [x]'
          : '- [ ]'
        : ordered
          ? `${start + index}.`
          : '-';
      return renderListItem(child, marker, indentation, options);
    })
    .join('\n');
}

function renderBlockMarkdown(node: TiptapNode, options: MarkdownRenderOptions): string {
  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map((child) => renderBlockMarkdown(child, options)).join('\n\n');
    case 'paragraph':
      return (node.content ?? []).map((child) => renderInlineMarkdown(child, options)).join('');
    case 'heading': {
      const level = numberAttribute(node, 'level') ?? 1;
      const content = (node.content ?? [])
        .map((child) => renderInlineMarkdown(child, options))
        .join('');
      return `${'#'.repeat(level)}${content.length > 0 ? ` ${content}` : ''}`;
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return renderListMarkdown(node, options);
    case 'blockquote': {
      const content = (node.content ?? [])
        .map((child) => renderBlockMarkdown(child, options))
        .join('\n\n');
      return content
        .split('\n')
        .map((line) => (line.length > 0 ? `> ${line}` : '>'))
        .join('\n');
    }
    case 'horizontalRule':
      return '---';
    case 'codeBlock':
      return renderCodeBlock(node, options);
    case 'assetImage':
    case 'attachment':
    case 'wikiLink':
      return renderInlineMarkdown(node, options);
    default:
      return (node.content ?? []).map((child) => renderBlockMarkdown(child, options)).join('\n\n');
  }
}

export function deriveMarkdown(
  document: TiptapDocument,
  options: MarkdownRenderOptions = {},
): string {
  if (validateTiptapDocument(document).length > 0) {
    throw new Error('Cannot render an invalid Tiptap document.');
  }

  return renderBlockMarkdown(document, options);
}

export interface PageRowSizeInput {
  id: string;
  title: string;
  slug: string;
  contentJson: string;
  contentText: string;
  parentId: string | null;
  position: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export function estimatePageRowBytes(page: PageRowSizeInput) {
  const encoder = new TextEncoder();
  const stringBytes = [
    page.id,
    page.title,
    page.slug,
    page.contentJson,
    page.contentText,
    page.parentId ?? '',
    page.createdAt,
    page.updatedAt,
  ].reduce((total, value) => total + encoder.encode(value).byteLength, 0);

  return stringBytes + 256 + String(page.position).length + String(page.revision).length;
}

export type CreatePageRequest = z.infer<typeof createPageRequestSchema>;
export type UpdatePageRequest = z.infer<typeof updatePageRequestSchema>;
export type UpdatePageContentRequest = z.infer<typeof updatePageContentRequestSchema>;
export type DeletePageRequest = z.infer<typeof deletePageRequestSchema>;
export type MovePageRequest = z.infer<typeof movePageRequestSchema>;
export type PagesListResponse = z.infer<typeof pagesListResponseSchema>;
export type PageResponse = z.infer<typeof pageResponseSchema>;
export type WikiLinkSearchResponse = z.infer<typeof wikiLinkSearchResponseSchema>;
export type PageBacklinksResponse = z.infer<typeof pageBacklinksResponseSchema>;
