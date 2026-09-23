import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PageDetail, TiptapDocument } from '../../../../shared/pages';
import { PageApiError } from '../api';
import {
  AUTOSAVE_DEBOUNCE_MS,
  PageAutosaveManager,
  retryDelay,
  type SaveContent,
} from './autosave';
import type { DraftStore, PageDraft } from './draftStore';

const baseContent: TiptapDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Initial' }] }],
};

const firstChange: TiptapDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First change' }] }],
};

const secondChange: TiptapDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second change' }] }],
};

function createPage(
  content: TiptapDocument = baseContent,
  revision = 1,
  updatedAt = '2026-09-12T10:00:00.000Z',
): PageDetail {
  return {
    content,
    contentText: content.content[0]?.content?.[0]?.text ?? '',
    createdAt: '2026-09-12T09:00:00.000Z',
    deletedAt: null,
    id: '00000000-0000-4000-8000-000000000001',
    isFavorite: false,
    parentId: null,
    position: 0,
    revision,
    slug: 'autosave-test',
    title: 'Autosave test',
    tags: [],
    updatedAt,
  };
}

class MemoryDraftStore implements DraftStore {
  readonly drafts = new Map<string, PageDraft>();

  async read(pageId: string) {
    return this.drafts.get(pageId) ?? null;
  }

  async write(draft: PageDraft) {
    this.drafts.set(draft.pageId, draft);
  }

  async remove(pageId: string) {
    this.drafts.delete(pageId);
  }

  async removeIfMatches(pageId: string, draftId: string) {
    if (this.drafts.get(pageId)?.draftId === draftId) {
      this.drafts.delete(pageId);
    }
  }
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PageAutosaveManager', () => {
  it('debounces changes and confirms the saved revision', async () => {
    vi.useFakeTimers();
    const store = new MemoryDraftStore();
    const save = vi.fn<SaveContent>().mockResolvedValue({ page: createPage(firstChange, 2) });
    const manager = new PageAutosaveManager(store, save, () => 0.5);
    const page = createPage();

    await manager.initialize(page);
    manager.change(page.id, firstChange);

    expect(manager.getSnapshot(page.id)).toMatchObject({ status: 'dirty' });
    expect(save).not.toHaveBeenCalled();

    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await flushPromises();

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(page.id, 1, firstChange);
    expect(manager.getSnapshot(page.id)).toMatchObject({
      hasUnconfirmedChanges: false,
      status: 'saved',
    });
  });

  it('keeps one request in flight and saves one follow-up change', async () => {
    vi.useFakeTimers();
    const store = new MemoryDraftStore();
    let resolveFirst: ((value: { page: PageDetail }) => void) | undefined;
    const save = vi.fn<SaveContent>().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    save.mockResolvedValueOnce({
      page: createPage(secondChange, 3, '2026-09-12T10:00:02.000Z'),
    });
    const manager = new PageAutosaveManager(store, save, () => 0.5);
    const page = createPage();

    await manager.initialize(page);
    manager.change(page.id, firstChange);
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledOnce();

    manager.change(page.id, secondChange);
    expect(manager.getSnapshot(page.id).status).toBe('saving');
    expect(save).toHaveBeenCalledOnce();

    resolveFirst?.({ page: createPage(firstChange, 2, '2026-09-12T10:00:01.000Z') });
    await flushPromises();
    expect(save).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushPromises();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(page.id, 2, secondChange);
  });

  it('retries transient failures with bounded backoff and supports manual retry', async () => {
    vi.useFakeTimers();
    const store = new MemoryDraftStore();
    const save = vi
      .fn<SaveContent>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Unexpected validation error'))
      .mockResolvedValueOnce({ page: createPage(firstChange, 2) });
    const manager = new PageAutosaveManager(store, save, () => 0.5);
    const page = createPage();

    await manager.initialize(page);
    manager.change(page.id, firstChange);
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushPromises();

    expect(manager.getSnapshot(page.id)).toMatchObject({
      retryAttempt: 1,
      status: 'failed',
    });
    vi.advanceTimersByTime(retryDelay(1, () => 0.5));
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(2);

    expect(manager.getSnapshot(page.id).status).toBe('failed');
    manager.retry(page.id);
    expect(save).toHaveBeenCalledTimes(3);
    await flushPromises();
    expect(manager.getSnapshot(page.id).status).toBe('saved');
  });

  it('stops on a conflict and resets only after loading the server version', async () => {
    vi.useFakeTimers();
    const store = new MemoryDraftStore();
    const save = vi
      .fn<SaveContent>()
      .mockRejectedValue(
        new PageApiError(409, 'PAGE_CONFLICT', 'The page changed.', { currentRevision: 4 }),
      );
    const manager = new PageAutosaveManager(store, save, () => 0.5);
    const page = createPage();

    await manager.initialize(page);
    manager.change(page.id, firstChange);
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushPromises();

    expect(manager.getSnapshot(page.id)).toMatchObject({
      conflictRevision: 4,
      hasUnconfirmedChanges: true,
      status: 'conflict',
    });
    vi.advanceTimersByTime(60_000);
    expect(save).toHaveBeenCalledOnce();

    const serverPage = createPage(secondChange, 4, '2026-09-12T10:00:04.000Z');
    await manager.resetFromServer(serverPage);
    expect(manager.getSnapshot(page.id)).toMatchObject({
      hasUnconfirmedChanges: false,
      status: 'clean',
    });
    expect(manager.getCurrentContent(page.id)).toEqual(secondChange);
  });

  it('offers a persisted draft after reload and deletes it after confirmation', async () => {
    vi.useFakeTimers();
    const store = new MemoryDraftStore();
    const page = createPage();
    const firstManager = new PageAutosaveManager(store, vi.fn<SaveContent>(), () => 0.5);

    await firstManager.initialize(page);
    firstManager.change(page.id, firstChange);
    await flushPromises();
    firstManager.dispose();

    const save = vi.fn<SaveContent>().mockResolvedValue({ page: createPage(firstChange, 2) });
    const manager = new PageAutosaveManager(store, save, () => 0.5);
    await manager.initialize(page);

    expect(manager.getSnapshot(page.id)).toMatchObject({
      hasUnconfirmedChanges: true,
      recoveryAvailable: true,
    });
    await expect(manager.recoverDraft(page.id)).resolves.toEqual(firstChange);
    expect(manager.getSnapshot(page.id).status).toBe('dirty');

    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
    await flushPromises();
    expect(manager.getSnapshot(page.id).status).toBe('saved');
    await flushPromises();
    expect(store.drafts.size).toBe(0);
  });
});
