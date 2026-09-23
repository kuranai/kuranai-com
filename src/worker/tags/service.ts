import {
  normalizeTagName,
  normalizeTagNameForComparison,
  type CreateTagRequest,
  type UpdateTagRequest,
} from '../../shared/tags';
import { PageError } from '../pages/errors';
import { PageRepository } from '../pages/repository';
import { TagError } from './errors';
import { TagRepository, type TagRecord } from './repository';

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique/i.test(message);
}

function nowIso(after?: string) {
  const previous = after === undefined ? Number.NaN : Date.parse(after);
  const now = Date.now();
  const next = Number.isFinite(previous) ? Math.max(now, previous + 1) : now;
  return new Date(next).toISOString();
}

function tagNotFound() {
  return new TagError(404, 'TAG_NOT_FOUND', 'Tag not found.');
}

function tagConflict() {
  return new TagError(409, 'TAG_NAME_CONFLICT', 'A tag with this name already exists.');
}

function pageNotFound() {
  return new PageError(404, 'PAGE_NOT_FOUND', 'Page not found.');
}

function pageDeleted() {
  return new PageError(409, 'PAGE_ALREADY_DELETED', 'The page is already in the trash.');
}

export function toTagSummary(tag: TagRecord) {
  return { id: tag.id, name: tag.name };
}

export class TagService {
  constructor(private readonly repository: TagRepository) {}

  async list() {
    return (await this.repository.list()).map(toTagSummary);
  }

  async create(input: CreateTagRequest) {
    const name = normalizeTagName(input.name);
    const nameNormalized = normalizeTagNameForComparison(name);
    if (await this.repository.findByNameNormalized(nameNormalized)) {
      throw tagConflict();
    }

    const timestamp = nowIso();
    const tag = {
      createdAt: timestamp,
      id: crypto.randomUUID(),
      name,
      nameNormalized,
      updatedAt: timestamp,
    } as const;
    try {
      await this.repository.insert(tag);
    } catch (error) {
      if (isConstraintError(error)) throw tagConflict();
      throw error;
    }
    return toTagSummary(tag);
  }

  async update(id: string, input: UpdateTagRequest) {
    const current = await this.repository.findById(id);
    if (!current) throw tagNotFound();

    const name = normalizeTagName(input.name);
    const nameNormalized = normalizeTagNameForComparison(name);
    if (await this.repository.findByNameNormalized(nameNormalized, id)) {
      throw tagConflict();
    }

    const updatedAt = nowIso(current.updatedAt);
    try {
      const result = await this.repository.update(id, name, nameNormalized, updatedAt);
      if (result.meta.changes !== 1) throw tagNotFound();
    } catch (error) {
      if (isConstraintError(error)) throw tagConflict();
      throw error;
    }
    return { id, name };
  }

  async delete(id: string) {
    const current = await this.repository.findById(id);
    if (!current) throw tagNotFound();
    const result = await this.repository.delete(id);
    if (result.meta.changes < 1) throw tagNotFound();
    return { deleted: true as const, tagId: id };
  }

  async ensurePage(pageId: string) {
    const page = await new PageRepository(this.repository.db).findById(pageId, true);
    if (!page) throw pageNotFound();
    if (page.deletedAt !== null) throw pageDeleted();
    return page;
  }

  async updatePageTags(pageId: string, tagIds: string[]) {
    await this.ensurePage(pageId);
    const tags = await this.repository.findByIds(tagIds);
    if (tags.length !== tagIds.length) {
      const found = new Set(tags.map((tag) => tag.id));
      throw new TagError(422, 'TAG_NOT_FOUND', 'One or more selected tags do not exist.', {
        tagIds: tagIds.filter((tagId) => !found.has(tagId)),
      });
    }
    await this.repository.replacePageTags(pageId, tagIds);
    return tags.map(toTagSummary);
  }

  async listForPage(pageId: string) {
    const page = await this.ensurePage(pageId);
    return page.tags;
  }

  async resolveTagId(value: string | undefined) {
    if (value === undefined || value.length === 0) return null;
    const normalized = normalizeTagNameForComparison(value);
    const tag = await this.repository.findByNameNormalized(normalized);
    return tag?.id ?? null;
  }
}
