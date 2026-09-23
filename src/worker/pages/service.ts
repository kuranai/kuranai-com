import {
  derivePlainText,
  collectAssetIds,
  collectWikiLinkReferences,
  estimatePageRowBytes,
  emptyDocument,
  MAX_PAGE_ROW_BYTES,
  PAGE_SLUG_MAX_LENGTH,
  tiptapDocumentSchema,
  type CreatePageRequest,
  type DeletePageRequest,
  type MovePageRequest,
  type PageDetail,
  type PageSummary,
  type TiptapDocument,
  type TiptapNode,
  type UpdatePageContentRequest,
  type UpdatePageRequest,
} from '../../shared/pages';
import { TagRepository } from '../tags/repository';
import { normalizeTagNameForComparison } from '../../shared/tags';
import type {
  PageRevisionDetail,
  PageRevisionSummary,
  PermanentDeleteRequest,
  PermanentDeleteResponse,
  RestorePageRequest,
  TrashPage,
} from '../../shared/recovery';
import { PageError } from './errors';
import { encodeRecoveryCursor } from './recovery';
import {
  PageRepository,
  type PageLinkRecord,
  type PageRecord,
  type PageRevisionRecord,
  type RecoveryCursor,
  type PageTreeUpdate,
  type NewDailyNoteRecord,
  type NewPageRecord,
} from './repository';

const MAX_SLUG_ATTEMPTS = 1_000;
const REVISION_WINDOW_MS = 10 * 60 * 1_000;

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique/i.test(message);
}

function timestamp(after?: string) {
  const previous = after === undefined ? Number.NaN : Date.parse(after);
  const now = Date.now();
  const next = Number.isFinite(previous) ? Math.max(now, previous + 1) : now;
  return new Date(next).toISOString();
}

export function slugifyPageTitle(title: string) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PAGE_SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');

  return slug || 'page';
}

function slugWithSuffix(base: string, suffix: number) {
  if (suffix === 1) {
    return base;
  }

  const suffixText = `-${suffix}`;
  const availableBaseLength = PAGE_SLUG_MAX_LENGTH - suffixText.length;
  const truncatedBase = base.slice(0, availableBaseLength).replace(/-+$/g, '') || 'page';
  return `${truncatedBase}${suffixText}`;
}

function pageNotFound() {
  return new PageError(404, 'PAGE_NOT_FOUND', 'Page not found.');
}

function pageConflict(current: PageRecord) {
  return new PageError(409, 'PAGE_CONFLICT', 'The page changed in another tab.', {
    currentRevision: current.revision,
  });
}

function pageNotDeleted() {
  return new PageError(422, 'PAGE_NOT_DELETED', 'The page is not in the trash.');
}

function pageAlreadyDeleted() {
  return new PageError(409, 'PAGE_ALREADY_DELETED', 'The page is already in the trash.');
}

function revisionNotFound() {
  return new PageError(404, 'REVISION_NOT_FOUND', 'The page revision was not found.');
}

function toSummary(page: PageRecord): PageSummary {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    parentId: page.parentId,
    position: page.position,
    revision: page.revision,
    isFavorite: page.isFavorite,
    tags: page.tags,
    updatedAt: page.updatedAt,
  };
}

function parseStoredContent(page: PageRecord): TiptapDocument {
  let value: unknown;
  try {
    value = JSON.parse(page.contentJson) as unknown;
  } catch {
    throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
  }

  const parsed = tiptapDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
  }

  return parsed.data;
}

function toDetail(page: PageRecord): PageDetail {
  return {
    ...toSummary(page),
    content: parseStoredContent(page),
    contentText: page.contentText,
    createdAt: page.createdAt,
    deletedAt: page.deletedAt,
  };
}

function resolveWikiLinkTitles(
  document: TiptapDocument,
  titlesByPageId: ReadonlyMap<string, string>,
): TiptapDocument {
  const resolveNode = (node: TiptapNode): TiptapNode => {
    const targetPageId = node.type === 'wikiLink' ? node.attrs?.targetPageId : null;
    const currentTitle =
      typeof targetPageId === 'string' ? titlesByPageId.get(targetPageId) : undefined;
    const content = node.content?.map(resolveNode);

    return {
      ...node,
      ...(currentTitle === undefined
        ? {}
        : { attrs: { ...node.attrs, targetTitle: currentTitle } }),
      ...(content === undefined ? {} : { content }),
    };
  };

  return { ...document, content: document.content.map(resolveNode) };
}

function wikiLinkTargetPageIds(document: TiptapDocument) {
  const ids = new Set<string>();
  const visit = (node: TiptapNode) => {
    if (node.type === 'wikiLink' && typeof node.attrs?.targetPageId === 'string') {
      ids.add(node.attrs.targetPageId);
    }
    node.content?.forEach(visit);
  };

  document.content.forEach(visit);
  return [...ids];
}

function toTrashPage(page: PageRecord): TrashPage {
  if (page.deletedAt === null) {
    throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
  }

  return {
    deletedAt: page.deletedAt,
    id: page.id,
    parentId: page.parentId,
    revision: page.revision,
    title: page.title,
    updatedAt: page.updatedAt,
  };
}

function toRevisionSummary(revision: PageRevisionRecord): PageRevisionSummary {
  return {
    createdAt: revision.createdAt,
    id: revision.id,
    pageId: revision.pageId,
    sourceRevision: revision.sourceRevision,
    title: revision.title,
    trigger: revision.trigger,
  };
}

function parseRevisionContent(revision: PageRevisionRecord): TiptapDocument {
  let value: unknown;
  try {
    value = JSON.parse(revision.contentJson) as unknown;
  } catch {
    throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
  }

  const parsed = tiptapDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
  }

  return parsed.data;
}

export class PageService {
  constructor(
    private readonly repository: PageRepository,
    private readonly tags = new TagRepository(repository.db),
  ) {}

  private snapshot(
    page: PageRecord,
    trigger: 'interval' | 'delete' | 'restore',
    createdAt: string,
  ) {
    return {
      createdAt,
      id: crypto.randomUUID(),
      intervalCutoff:
        trigger === 'interval'
          ? new Date(Date.parse(createdAt) - REVISION_WINDOW_MS).toISOString()
          : undefined,
      pageId: page.id,
      sourceRevision: page.revision,
      trigger,
    } as const;
  }

  private async normalizeSiblings(parentId: string | null, siblings?: PageRecord[]) {
    const currentSiblings = siblings ?? (await this.repository.listActiveChildren(parentId));
    const updates: PageTreeUpdate[] = currentSiblings.flatMap((page, position) =>
      page.position === position
        ? []
        : [
            {
              id: page.id,
              parentId,
              position,
              revision: page.revision,
              updatedAt: timestamp(page.updatedAt),
            },
          ],
    );

    if (updates.length === 0) {
      return;
    }

    await this.repository.updateTree(updates);
    const normalized = await this.repository.listActiveChildren(parentId);
    if (
      normalized.length !== currentSiblings.length ||
      normalized.some(
        (page, position) => page.id !== currentSiblings[position]?.id || page.position !== position,
      )
    ) {
      throw new PageError(409, 'PAGE_CONFLICT', 'The page tree changed in another tab.');
    }
  }

  async list(filters: { favorite?: boolean; tagId?: string; tagName?: string } = {}) {
    let tagId = filters.tagId;
    if (tagId === undefined && filters.tagName !== undefined) {
      tagId =
        (await this.tags.findByNameNormalized(normalizeTagNameForComparison(filters.tagName)))
          ?.id ?? '__missing_tag__';
    }
    const pages = await this.repository.listActive({ favorite: filters.favorite, tagId });
    return pages.map(toSummary);
  }

  async listTrash(cursor: RecoveryCursor | null, limit: number) {
    const rows = await this.repository.listDeleted(cursor, limit + 1);
    const pages = rows.slice(0, limit).map(toTrashPage);
    const lastPage = pages.at(-1);
    const nextCursor =
      rows.length > limit && lastPage?.deletedAt
        ? encodeRecoveryCursor({ id: lastPage.id, timestamp: lastPage.deletedAt })
        : null;

    return { nextCursor, pages };
  }

  async listPageRevisions(pageId: string, cursor: RecoveryCursor | null, limit: number) {
    const page = await this.repository.findById(pageId, true);
    if (!page) {
      throw pageNotFound();
    }

    const rows = await this.repository.listRevisions(pageId, cursor, limit + 1);
    const revisions = rows.slice(0, limit).map(toRevisionSummary);
    const lastRevision = revisions.at(-1);
    const nextCursor =
      rows.length > limit && lastRevision
        ? encodeRecoveryCursor({ id: lastRevision.id, timestamp: lastRevision.createdAt })
        : null;

    return { nextCursor, revisions };
  }

  async getPageRevision(pageId: string, revisionId: string): Promise<PageRevisionDetail> {
    const page = await this.repository.findById(pageId, true);
    if (!page) {
      throw pageNotFound();
    }

    const revision = await this.repository.findRevision(pageId, revisionId);
    if (!revision) {
      throw revisionNotFound();
    }

    return {
      ...toRevisionSummary(revision),
      content: parseRevisionContent(revision),
    };
  }

  async searchWikiLinks(query: string, limit: number): Promise<PageSummary[]> {
    const pages = await this.repository.searchActiveTitles(query, limit);
    return pages.map(toSummary);
  }

  async backlinks(id: string): Promise<PageSummary[]> {
    if (!(await this.repository.findById(id))) {
      throw pageNotFound();
    }

    const pages = await this.repository.listBacklinks(id);
    return pages.map(toSummary);
  }

  async get(id: string): Promise<PageDetail> {
    const page = await this.repository.findById(id);
    if (!page) {
      throw pageNotFound();
    }

    const detail = toDetail(page);
    const targetPageIds = wikiLinkTargetPageIds(detail.content);
    const titlesByPageId = await this.repository.findActiveTitlesByIds(targetPageIds);
    return { ...detail, content: resolveWikiLinkTitles(detail.content, titlesByPageId) };
  }

  private async uniqueSlug(base: string, excludeId?: string) {
    for (let suffix = 1; suffix <= MAX_SLUG_ATTEMPTS; suffix += 1) {
      const candidate = slugWithSuffix(base, suffix);
      const existing = await this.repository.findBySlug(candidate, excludeId);
      if (!existing) {
        return candidate;
      }
    }

    throw new PageError(409, 'SLUG_CONFLICT', 'A unique page slug could not be generated.');
  }

  private async createPageWithContent(
    input: CreatePageRequest,
    content: TiptapDocument,
    insertPage: (page: NewPageRecord) => Promise<number> = (page) => this.repository.insert(page),
    pageId: string = crypto.randomUUID(),
  ): Promise<PageDetail> {
    if (input.parentId !== null && !(await this.repository.hasActiveParent(input.parentId))) {
      throw new PageError(422, 'PARENT_NOT_FOUND', 'The selected parent page does not exist.');
    }

    await this.normalizeSiblings(input.parentId);

    const now = timestamp();
    const id = pageId;
    const baseSlug = slugifyPageTitle(input.title);
    const contentJson = JSON.stringify(content);
    const contentText = derivePlainText(content);
    const estimatedBytes = estimatePageRowBytes({
      id,
      title: input.title,
      slug: baseSlug,
      contentJson,
      contentText,
      parentId: input.parentId,
      position: 0,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    if (estimatedBytes > MAX_PAGE_ROW_BYTES) {
      throw new PageError(
        413,
        'PAGE_TOO_LARGE',
        'This page is too large. Split it into smaller pages.',
        { maxBytes: MAX_PAGE_ROW_BYTES },
      );
    }

    const linkReferences = collectWikiLinkReferences(content);
    const activeTargetIds = await this.repository.findActiveIds(
      linkReferences.flatMap((link) => (link.targetPageId === null ? [] : [link.targetPageId])),
    );
    const wikiLinks: PageLinkRecord[] = linkReferences.map((link) => ({
      ...link,
      id: crypto.randomUUID(),
      targetPageId:
        link.targetPageId !== null && activeTargetIds.has(link.targetPageId)
          ? link.targetPageId
          : null,
      createdAt: now,
    }));

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      const slug = await this.uniqueSlug(baseSlug);

      try {
        const changes = await insertPage({
          id,
          title: input.title,
          slug,
          contentJson,
          contentText,
          parentId: input.parentId,
          createdAt: now,
          updatedAt: now,
          assetIds: collectAssetIds(content),
          wikiLinks,
        });

        if (changes < 1) {
          throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
        }

        const page = await this.repository.findById(id);
        if (!page) {
          throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
        }

        return toDetail(page);
      } catch (error) {
        if (!isConstraintError(error)) {
          throw error;
        }
      }
    }

    throw new PageError(409, 'SLUG_CONFLICT', 'A unique page slug could not be generated.');
  }

  async create(input: CreatePageRequest): Promise<PageDetail> {
    return this.createPageWithContent(input, JSON.parse(emptyDocument) as TiptapDocument);
  }

  async createWithContent(input: CreatePageRequest, content: TiptapDocument) {
    return this.createPageWithContent(input, content);
  }

  async createDailyNote(
    input: CreatePageRequest,
    content: TiptapDocument,
    dailyNote: NewDailyNoteRecord,
  ) {
    return this.createPageWithContent(
      input,
      content,
      (page) =>
        this.repository.insertWithDailyNote(page, dailyNote).then((result) => result.pageChanges),
      dailyNote.pageId,
    );
  }

  async updateMetadata(id: string, input: UpdatePageRequest): Promise<PageDetail> {
    const current = await this.repository.findById(id);
    if (!current) {
      throw pageNotFound();
    }
    if (current.revision !== input.baseRevision) {
      throw pageConflict(current);
    }

    const title = input.title ?? current.title;
    let slug: string;
    if (input.slug !== undefined) {
      const existing = await this.repository.findBySlug(input.slug, id);
      if (existing) {
        throw new PageError(409, 'SLUG_CONFLICT', 'A page with this slug already exists.');
      }
      slug = input.slug;
    } else if (input.title !== undefined) {
      slug = await this.uniqueSlug(slugifyPageTitle(input.title), id);
    } else {
      slug = current.slug;
    }

    if (title === current.title && slug === current.slug) {
      return toDetail(current);
    }

    const updatedAt = timestamp(current.updatedAt);
    const snapshot =
      title === current.title ? undefined : this.snapshot(current, 'interval', updatedAt);
    try {
      const changes = await this.repository.updateMetadata(
        id,
        input.baseRevision,
        {
          title,
          slug,
          updatedAt,
        },
        snapshot,
      );
      if (changes < 1) {
        const latest = await this.repository.findById(id);
        if (!latest) {
          throw pageNotFound();
        }
        throw pageConflict(latest);
      }
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PageError(409, 'SLUG_CONFLICT', 'A page with this slug already exists.');
      }
      throw error;
    }

    const page = await this.repository.findById(id);
    if (!page) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(page);
  }

  async updateTags(id: string, tagIds: string[]): Promise<PageDetail> {
    const current = await this.repository.findById(id);
    if (!current) {
      throw pageNotFound();
    }

    const tags = await this.tags.findByIds(tagIds);
    if (tags.length !== tagIds.length) {
      const found = new Set(tags.map((tag) => tag.id));
      throw new PageError(422, 'TAG_NOT_FOUND', 'One or more selected tags do not exist.', {
        tagIds: tagIds.filter((tagId) => !found.has(tagId)),
      });
    }

    const currentIds = current.tags.map((tag) => tag.id).sort();
    const requestedIds = [...tagIds].sort();
    if (
      currentIds.length === requestedIds.length &&
      currentIds.every((tagId, index) => tagId === requestedIds[index])
    ) {
      return toDetail(current);
    }

    await this.tags.replacePageTags(id, tagIds);
    const page = await this.repository.findById(id);
    if (!page) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(page);
  }

  async updateFavorite(id: string, isFavorite: boolean): Promise<PageDetail> {
    const current = await this.repository.findById(id);
    if (!current) {
      throw pageNotFound();
    }
    if (current.isFavorite === isFavorite) {
      return toDetail(current);
    }

    const changes = await this.repository.updateFavorite(
      id,
      isFavorite,
      timestamp(current.updatedAt),
    );
    if (changes < 1) {
      const latest = await this.repository.findById(id);
      if (!latest) {
        throw pageNotFound();
      }
      return toDetail(latest);
    }

    const page = await this.repository.findById(id);
    if (!page) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(page);
  }

  async updateContent(id: string, input: UpdatePageContentRequest): Promise<PageDetail> {
    const current = await this.repository.findById(id);
    if (!current) {
      throw pageNotFound();
    }
    if (current.revision !== input.baseRevision) {
      throw pageConflict(current);
    }

    const contentJson = JSON.stringify(input.content);
    if (contentJson === current.contentJson) {
      return toDetail(current);
    }

    const contentText = derivePlainText(input.content);
    const updatedAt = timestamp(current.updatedAt);
    const estimatedBytes = estimatePageRowBytes({
      id: current.id,
      title: current.title,
      slug: current.slug,
      contentJson,
      contentText,
      parentId: current.parentId,
      position: current.position,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt,
    });

    if (estimatedBytes > MAX_PAGE_ROW_BYTES) {
      throw new PageError(
        413,
        'PAGE_TOO_LARGE',
        'This page is too large. Split it into smaller pages.',
        { maxBytes: MAX_PAGE_ROW_BYTES },
      );
    }

    const linkReferences = collectWikiLinkReferences(input.content);
    const activeTargetIds = await this.repository.findActiveIds(
      linkReferences.flatMap((link) => (link.targetPageId === null ? [] : [link.targetPageId])),
    );
    const wikiLinks: PageLinkRecord[] = linkReferences.map((link) => ({
      ...link,
      id: crypto.randomUUID(),
      targetPageId:
        link.targetPageId !== null && activeTargetIds.has(link.targetPageId)
          ? link.targetPageId
          : null,
      createdAt: updatedAt,
    }));

    const changes = await this.repository.updateContent(
      id,
      input.baseRevision,
      {
        contentJson,
        contentText,
        updatedAt,
        assetIds: collectAssetIds(input.content),
        wikiLinks,
      },
      this.snapshot(current, 'interval', updatedAt),
    );
    if (changes < 1) {
      const latest = await this.repository.findById(id);
      if (!latest) {
        throw pageNotFound();
      }
      throw pageConflict(latest);
    }

    const page = await this.repository.findById(id);
    if (!page) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(page);
  }

  async move(id: string, input: MovePageRequest): Promise<PageDetail> {
    const current = await this.repository.findById(id);
    if (!current) {
      throw pageNotFound();
    }

    if (input.parentId !== null) {
      const parent = await this.repository.findById(input.parentId);
      if (!parent) {
        throw new PageError(422, 'PARENT_NOT_FOUND', 'The selected parent page does not exist.');
      }

      if (await this.repository.isInAncestorChain(input.parentId, id)) {
        throw new PageError(422, 'PAGE_CYCLE', 'A page cannot be moved into itself or its child.');
      }
    }

    const anchorId = input.beforeId ?? input.afterId;
    let anchor: PageRecord | null = null;
    if (anchorId !== undefined) {
      anchor = await this.repository.findById(anchorId);
      if (!anchor) {
        throw new PageError(
          422,
          'MOVE_TARGET_NOT_FOUND',
          'The selected move target does not exist.',
        );
      }
      if (anchor.id === current.id || anchor.parentId !== input.parentId) {
        throw new PageError(
          422,
          'MOVE_TARGET_INVALID',
          'The selected move target must be a sibling in the destination.',
        );
      }
    }

    const sourceSiblings = await this.repository.listActiveChildren(current.parentId);
    const destinationSiblings =
      current.parentId === input.parentId
        ? sourceSiblings
        : await this.repository.listActiveChildren(input.parentId);
    const sourceWithoutCurrent = sourceSiblings.filter((page) => page.id !== current.id);
    const destinationWithoutCurrent = destinationSiblings.filter((page) => page.id !== current.id);

    if (!sourceSiblings.some((page) => page.id === current.id)) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }

    const insertionIndex =
      anchor === null
        ? destinationWithoutCurrent.length
        : destinationWithoutCurrent.findIndex((page) => page.id === anchor?.id) +
          (input.afterId === undefined ? 0 : 1);
    if (insertionIndex < 0) {
      throw new PageError(
        422,
        'MOVE_TARGET_INVALID',
        'The selected move target must be a sibling in the destination.',
      );
    }

    const nextDestination = [...destinationWithoutCurrent];
    nextDestination.splice(insertionIndex, 0, current);

    const desired = new Map<string, { parentId: string | null; position: number }>();
    sourceWithoutCurrent.forEach((page, position) => {
      desired.set(page.id, { parentId: current.parentId, position });
    });
    nextDestination.forEach((page, position) => {
      desired.set(page.id, { parentId: input.parentId, position });
    });

    const updates = Array.from(desired, ([pageId, next]) => {
      const page =
        pageId === current.id
          ? current
          : (sourceSiblings.find((sibling) => sibling.id === pageId) ??
            destinationSiblings.find((sibling) => sibling.id === pageId));
      if (!page) {
        throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
      }

      if (page.parentId === next.parentId && page.position === next.position) {
        return null;
      }

      return {
        id: page.id,
        parentId: next.parentId,
        position: next.position,
        revision: page.revision,
        updatedAt: timestamp(page.updatedAt),
      };
    }).filter((update): update is NonNullable<typeof update> => update !== null);

    if (updates.length === 0) {
      return toDetail(current);
    }

    await this.repository.updateTree(updates);
    const sourceAfter = await this.repository.listActiveChildren(current.parentId);
    const destinationAfter =
      current.parentId === input.parentId
        ? sourceAfter
        : await this.repository.listActiveChildren(input.parentId);
    const expectedSourceIds = sourceWithoutCurrent.map((page) => page.id);
    const expectedDestinationIds = nextDestination.map((page) => page.id);
    const matchesTree = (
      actual: PageRecord[],
      expectedIds: string[],
      expectedParentId: string | null,
    ) =>
      actual.length === expectedIds.length &&
      actual.every(
        (page, position) =>
          page.id === expectedIds[position] &&
          page.parentId === expectedParentId &&
          page.position === position,
      );
    const sourceMatches = matchesTree(sourceAfter, expectedSourceIds, current.parentId);
    const destinationMatches = matchesTree(
      destinationAfter,
      expectedDestinationIds,
      input.parentId,
    );
    const sameParent = current.parentId === input.parentId;
    const treeMatches = sameParent ? destinationMatches : sourceMatches && destinationMatches;
    if (!treeMatches) {
      const latest = await this.repository.findById(id);
      if (!latest) {
        throw pageNotFound();
      }
      throw pageConflict(latest);
    }

    const moved = await this.repository.findById(id);
    if (!moved) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(moved);
  }

  async delete(id: string, input?: DeletePageRequest): Promise<PageDetail> {
    const current = await this.repository.findById(id);
    if (!current) {
      if (await this.repository.findById(id, true)) {
        throw pageAlreadyDeleted();
      }
      throw pageNotFound();
    }
    if (input?.baseRevision !== undefined && current.revision !== input.baseRevision) {
      throw pageConflict(current);
    }

    const deletedAt = timestamp(current.updatedAt);
    const baseRevision = input?.baseRevision ?? current.revision;
    const siblings = await this.repository.listActiveChildren(current.parentId);
    if (!siblings.some((page) => page.id === current.id)) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    const changes = await this.repository.softDelete(
      id,
      baseRevision,
      deletedAt,
      this.snapshot(current, 'delete', deletedAt),
    );
    if (changes < 1) {
      const latest = await this.repository.findById(id);
      if (!latest) {
        throw pageNotFound();
      }
      throw pageConflict(latest);
    }
    await this.normalizeSiblings(
      current.parentId,
      siblings.filter((page) => page.id !== current.id),
    );

    const deleted = await this.repository.findById(id, true);
    if (!deleted) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(deleted);
  }

  async restoreDeletedPage(id: string, input: RestorePageRequest): Promise<PageDetail> {
    const current = await this.repository.findById(id, true);
    if (!current) {
      throw pageNotFound();
    }
    if (current.deletedAt === null) {
      throw pageNotDeleted();
    }
    if (current.revision !== input.baseRevision) {
      throw pageConflict(current);
    }

    const parentId =
      current.parentId !== null && (await this.repository.hasActiveParent(current.parentId))
        ? current.parentId
        : null;
    const siblings = await this.repository.listActiveChildren(parentId);
    const updatedAt = timestamp(current.updatedAt);
    const changes = await this.repository.restoreDeleted(
      id,
      input.baseRevision,
      parentId,
      siblings.length,
      updatedAt,
      this.snapshot(current, 'restore', updatedAt),
    );
    if (changes < 1) {
      const latest = await this.repository.findById(id, true);
      if (!latest) {
        throw pageNotFound();
      }
      throw pageConflict(latest);
    }

    await this.normalizeSiblings(parentId);
    const restored = await this.repository.findById(id);
    if (!restored) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(restored);
  }

  async restorePageRevision(
    pageId: string,
    revisionId: string,
    input: RestorePageRequest,
  ): Promise<PageDetail> {
    const current = await this.repository.findById(pageId, true);
    if (!current) {
      throw pageNotFound();
    }
    if (current.deletedAt !== null) {
      throw pageNotDeleted();
    }
    if (current.revision !== input.baseRevision) {
      throw pageConflict(current);
    }

    const revision = await this.repository.findRevision(pageId, revisionId);
    if (!revision) {
      throw revisionNotFound();
    }

    const content = parseRevisionContent(revision);
    const contentJson = JSON.stringify(content);
    const contentText = derivePlainText(content);
    const updatedAt = timestamp(current.updatedAt);
    const estimatedBytes = estimatePageRowBytes({
      id: current.id,
      title: revision.title,
      slug: current.slug,
      contentJson,
      contentText,
      parentId: current.parentId,
      position: current.position,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt,
    });

    if (estimatedBytes > MAX_PAGE_ROW_BYTES) {
      throw new PageError(
        413,
        'PAGE_TOO_LARGE',
        'This page is too large. Split it into smaller pages.',
        { maxBytes: MAX_PAGE_ROW_BYTES },
      );
    }

    const baseSlug = slugifyPageTitle(revision.title);
    const slug = await this.uniqueSlug(baseSlug, pageId);
    const linkReferences = collectWikiLinkReferences(content);
    const activeTargetIds = await this.repository.findActiveIds(
      linkReferences.flatMap((link) => (link.targetPageId === null ? [] : [link.targetPageId])),
    );
    const wikiLinks: PageLinkRecord[] = linkReferences.map((link) => ({
      ...link,
      id: crypto.randomUUID(),
      targetPageId:
        link.targetPageId !== null && activeTargetIds.has(link.targetPageId)
          ? link.targetPageId
          : null,
      createdAt: updatedAt,
    }));

    try {
      const changes = await this.repository.restoreRevision(
        pageId,
        input.baseRevision,
        {
          assetIds: collectAssetIds(content),
          contentJson,
          contentText,
          slug,
          title: revision.title,
          updatedAt,
          wikiLinks,
        },
        this.snapshot(current, 'restore', updatedAt),
      );
      if (changes < 1) {
        const latest = await this.repository.findById(pageId, true);
        if (!latest) {
          throw pageNotFound();
        }
        throw pageConflict(latest);
      }
    } catch (error) {
      if (isConstraintError(error)) {
        throw new PageError(409, 'SLUG_CONFLICT', 'A page with this slug already exists.');
      }
      throw error;
    }

    const restored = await this.repository.findById(pageId);
    if (!restored) {
      throw new PageError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(restored);
  }

  async permanentlyDeletePage(
    id: string,
    input: PermanentDeleteRequest,
  ): Promise<PermanentDeleteResponse> {
    const current = await this.repository.findById(id, true);
    if (!current) {
      throw pageNotFound();
    }
    if (current.deletedAt === null) {
      throw pageNotDeleted();
    }
    if (current.revision !== input.baseRevision) {
      throw pageConflict(current);
    }
    if (current.title !== input.confirmationTitle) {
      throw new PageError(
        422,
        'CONFIRMATION_MISMATCH',
        'The page title confirmation is incorrect.',
      );
    }

    const changes = await this.repository.permanentDelete(id, input.baseRevision);
    if (changes < 1) {
      const latest = await this.repository.findById(id, true);
      if (!latest) {
        throw pageNotFound();
      }
      throw pageConflict(latest);
    }

    if (current.parentId !== null) {
      await this.normalizeSiblings(current.parentId);
    }
    await this.normalizeSiblings(null);
    return { deleted: true, pageId: id };
  }
}
