import {
  emptyTemplateDocument,
  isValidLocalDate,
  localDateForTimeZone,
  type CreatePageFromTemplateRequest,
  type CreateTemplateRequest,
  type DailyNoteRequest,
  type TemplateDetail,
  type TemplateSummary,
  type UpdateTemplateRequest,
} from '../../shared/templates';
import { tiptapDocumentSchema, type TiptapDocument } from '../../shared/pages';
import { PageError } from '../pages/errors';
import { PageRepository } from '../pages/repository';
import { PageService } from '../pages/service';
import { TemplateError } from './errors';
import { TemplateRepository, type DailyNoteRecord, type TemplateRecord } from './repository';

function nowIso(after?: string) {
  const previous = after === undefined ? Number.NaN : Date.parse(after);
  const now = Date.now();
  const next = Number.isFinite(previous) ? Math.max(now, previous + 1) : now;
  return new Date(next).toISOString();
}

function isConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /constraint|unique/i.test(message);
}

function templateNotFound() {
  return new TemplateError(404, 'TEMPLATE_NOT_FOUND', 'The template was not found.');
}

function templateConflict(current: TemplateRecord) {
  return new TemplateError(409, 'TEMPLATE_CONFLICT', 'The template changed in another tab.', {
    currentRevision: current.revision,
  });
}

function titleConflict() {
  return new TemplateError(
    409,
    'TEMPLATE_TITLE_CONFLICT',
    'A template with this title already exists.',
  );
}

function dailyTemplateConflict() {
  return new TemplateError(
    409,
    'DAILY_NOTE_TEMPLATE_CONFLICT',
    'Only one template can be configured for daily notes.',
  );
}

function parseContent(template: TemplateRecord): TiptapDocument {
  let value: unknown;
  try {
    value = JSON.parse(template.contentJson) as unknown;
  } catch {
    throw new TemplateError(500, 'INTERNAL_ERROR', 'Internal server error.');
  }
  const parsed = tiptapDocumentSchema.safeParse(value);
  if (!parsed.success) {
    throw new TemplateError(500, 'INTERNAL_ERROR', 'Internal server error.');
  }
  return parsed.data;
}

function toSummary(template: TemplateRecord): TemplateSummary {
  return {
    id: template.id,
    title: template.title,
    revision: template.revision,
    isDailyNote: template.isDailyNote,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function toDetail(template: TemplateRecord): TemplateDetail {
  return { ...toSummary(template), content: parseContent(template) };
}

function toDailyNoteSummary(note: DailyNoteRecord) {
  return {
    id: note.id,
    localDate: note.localDate,
    timeZone: note.timeZone,
    pageId: note.pageId,
    templateId: note.templateId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  } as const;
}

export class TemplateService {
  private readonly pages: PageService;

  constructor(
    private readonly repository: TemplateRepository,
    pageService = new PageService(new PageRepository(repository.db)),
  ) {
    this.pages = pageService;
  }

  async list() {
    return (await this.repository.list()).map(toSummary);
  }

  async get(id: string) {
    const template = await this.repository.findById(id);
    if (!template) {
      throw templateNotFound();
    }
    return toDetail(template);
  }

  async create(input: CreateTemplateRequest) {
    if (await this.repository.findByTitle(input.title)) {
      throw titleConflict();
    }

    const createdAt = nowIso();
    const template: TemplateRecord = {
      id: crypto.randomUUID(),
      title: input.title,
      contentJson: JSON.stringify(input.content),
      revision: 1,
      isDailyNote: input.isDailyNote,
      createdAt,
      updatedAt: createdAt,
    };
    try {
      const result = await this.repository.insert(template);
      if (result.meta.changes !== 1) {
        throw new TemplateError(500, 'INTERNAL_ERROR', 'Internal server error.');
      }
    } catch (error) {
      if (isConstraintError(error)) {
        throw template.isDailyNote ? dailyTemplateConflict() : titleConflict();
      }
      throw error;
    }
    return toDetail(template);
  }

  async update(id: string, input: UpdateTemplateRequest) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw templateNotFound();
    }
    if (current.revision !== input.baseRevision) {
      throw templateConflict(current);
    }

    const nextTitle = input.title ?? current.title;
    const nextContent = input.content ?? parseContent(current);
    const nextIsDailyNote = input.isDailyNote ?? current.isDailyNote;
    const titleOwner = await this.repository.findByTitle(nextTitle);
    if (titleOwner && titleOwner.id !== id) {
      throw titleConflict();
    }
    if (
      nextTitle === current.title &&
      JSON.stringify(nextContent) === current.contentJson &&
      nextIsDailyNote === current.isDailyNote
    ) {
      return toDetail(current);
    }

    const updatedAt = nowIso(current.updatedAt);
    try {
      const result = await this.repository.update(id, input.baseRevision, {
        title: nextTitle,
        contentJson: JSON.stringify(nextContent),
        isDailyNote: nextIsDailyNote,
        updatedAt,
      });
      if (result.meta.changes !== 1) {
        const latest = await this.repository.findById(id);
        if (!latest) throw templateNotFound();
        throw templateConflict(latest);
      }
    } catch (error) {
      if (isConstraintError(error)) {
        throw nextIsDailyNote ? dailyTemplateConflict() : titleConflict();
      }
      throw error;
    }

    const updated = await this.repository.findById(id);
    if (!updated) {
      throw new TemplateError(500, 'INTERNAL_ERROR', 'Internal server error.');
    }
    return toDetail(updated);
  }

  async delete(id: string, baseRevision: number) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw templateNotFound();
    }
    if (current.revision !== baseRevision) {
      throw templateConflict(current);
    }
    const result = await this.repository.delete(id, baseRevision);
    if (result.meta.changes !== 1) {
      const latest = await this.repository.findById(id);
      if (!latest) throw templateNotFound();
      throw templateConflict(latest);
    }
    return { deleted: true as const, templateId: id };
  }

  async createPageFromTemplate(input: CreatePageFromTemplateRequest) {
    const template = await this.repository.findById(input.templateId);
    if (!template) {
      throw templateNotFound();
    }
    return this.pages.createWithContent(
      { parentId: input.parentId, title: input.title ?? template.title },
      parseContent(template),
    );
  }

  async openDailyNote(input: DailyNoteRequest) {
    const timeZone = input.timeZone;
    const localDate = input.localDate ?? localDateForTimeZone(new Date(), timeZone);
    if (!isValidLocalDate(localDate)) {
      throw new TemplateError(422, 'INVALID_LOCAL_DATE', 'The daily note date is invalid.');
    }
    const expectedDate = localDateForTimeZone(new Date(), timeZone);
    if (localDate !== expectedDate) {
      throw new TemplateError(
        422,
        'DAILY_NOTE_DATE_MISMATCH',
        'The daily note date does not match the supplied time zone.',
        { expectedLocalDate: expectedDate, timeZone },
      );
    }

    const existing = await this.repository.findDailyNote(localDate);
    if (existing) {
      try {
        return {
          dailyNote: toDailyNoteSummary(existing),
          page: await this.pages.get(existing.pageId),
        };
      } catch (error) {
        if (error instanceof PageError && error.code === 'PAGE_NOT_FOUND') {
          throw new TemplateError(
            409,
            'DAILY_NOTE_PAGE_MISSING',
            'The existing daily note page is no longer available.',
          );
        }
        throw error;
      }
    }

    const template = await this.repository.findDailyNoteTemplate();
    const content = template ? parseContent(template) : emptyTemplateDocument();
    const createdAt = nowIso();
    const pageId = crypto.randomUUID();
    const dailyNote: DailyNoteRecord = {
      id: crypto.randomUUID(),
      localDate,
      timeZone,
      pageId,
      templateId: template?.id ?? null,
      createdAt,
      updatedAt: createdAt,
    };

    try {
      const page = await this.pages.createDailyNote(
        { parentId: null, title: localDate },
        content,
        dailyNote,
      );
      return { dailyNote: toDailyNoteSummary(dailyNote), page };
    } catch (error) {
      if (!isConstraintError(error)) {
        throw error;
      }
      const winner = await this.repository.findDailyNote(localDate);
      if (winner) {
        return { dailyNote: toDailyNoteSummary(winner), page: await this.pages.get(winner.pageId) };
      }
      throw new TemplateError(409, 'DAILY_NOTE_CONFLICT', 'The daily note could not be created.');
    }
  }
}
