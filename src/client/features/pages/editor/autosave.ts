import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import type { PageDetail, TiptapDocument } from '../../../../shared/pages';
import { PageApiError, pageErrorMessage, updatePageContent } from '../api';
import { createIndexedDbDraftStore, type DraftStore, type PageDraft } from './draftStore';

export const AUTOSAVE_DEBOUNCE_MS = 750;
export const MAX_RETRY_DELAY_MS = 30_000;

export type AutosaveStatus =
  'clean' | 'dirty' | 'waiting' | 'saving' | 'saved' | 'failed' | 'retrying' | 'conflict';

export interface AutosaveSnapshot {
  status: AutosaveStatus;
  hasUnconfirmedChanges: boolean;
  recoveryAvailable: boolean;
  errorMessage: string | null;
  conflictRevision: number | null;
  retryAttempt: number;
}

export type SaveContent = (
  pageId: string,
  baseRevision: number,
  content: TiptapDocument,
) => Promise<{ page: PageDetail }>;

export type SavedPageListener = (page: PageDetail, isCurrentContent: boolean) => void;

interface Subscriber {
  listener: () => void;
  onSaved?: SavedPageListener;
}

interface SaveAttempt {
  baseRevision: number;
  content: TiptapDocument;
  contentKey: string;
  draftId: string | null;
  sequence: number;
}

interface PageAutosaveItem {
  pageId: string;
  initialized: boolean;
  baseRevision: number;
  serverRevision: number;
  serverUpdatedAt: string;
  serverContent: TiptapDocument;
  confirmedContent: TiptapDocument;
  confirmedKey: string;
  currentContent: TiptapDocument;
  currentKey: string;
  status: AutosaveStatus;
  errorMessage: string | null;
  conflictRevision: number | null;
  retryAttempt: number;
  sequence: number;
  changedAt: number | null;
  draftId: string | null;
  draftWrite: Promise<void>;
  recovery: PageDraft | null;
  saveAttempt: SaveAttempt | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  subscribers: Set<Subscriber>;
  snapshot: AutosaveSnapshot;
}

export interface AutosaveInitialization {
  contentToApply: TiptapDocument | null;
}

export interface UsePageAutosaveResult {
  snapshot: AutosaveSnapshot;
  change: (content: TiptapDocument) => void;
  retry: () => void;
  recoverDraft: () => Promise<TiptapDocument | null>;
  discardDraft: () => Promise<void>;
  resetFromServer: (page: PageDetail) => Promise<void>;
  getCurrentContent: () => TiptapDocument;
}

const emptyDocument: TiptapDocument = { type: 'doc', content: [] };
const emptySnapshot: AutosaveSnapshot = {
  conflictRevision: null,
  errorMessage: null,
  hasUnconfirmedChanges: false,
  recoveryAvailable: false,
  retryAttempt: 0,
  status: 'clean',
};

function contentKey(content: TiptapDocument) {
  return JSON.stringify(content);
}

function createDraftId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isTransientError(error: unknown) {
  if (error instanceof PageApiError) {
    return error.status === 429 || error.status >= 500;
  }

  if (error instanceof TypeError) {
    return true;
  }

  return error instanceof Error && /network|fetch|connection/i.test(error.message);
}

export function retryDelay(attempt: number, random = Math.random) {
  const exponentialDelay = Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** Math.max(0, attempt - 1));
  const jitteredDelay = exponentialDelay * (0.5 + random());
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(1, Math.round(jitteredDelay)));
}

function snapshotsEqual(left: AutosaveSnapshot, right: AutosaveSnapshot) {
  return (
    left.status === right.status &&
    left.hasUnconfirmedChanges === right.hasUnconfirmedChanges &&
    left.recoveryAvailable === right.recoveryAvailable &&
    left.errorMessage === right.errorMessage &&
    left.conflictRevision === right.conflictRevision &&
    left.retryAttempt === right.retryAttempt
  );
}

export class PageAutosaveManager {
  private readonly items = new Map<string, PageAutosaveItem>();

  private readonly beforeUnloadHandler = (event: BeforeUnloadEvent) => {
    if (![...this.items.values()].some((item) => item.snapshot.hasUnconfirmedChanges)) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  };

  constructor(
    private readonly draftStore: DraftStore = createIndexedDbDraftStore(),
    private readonly saveContent: SaveContent = updatePageContent,
    private readonly random: () => number = Math.random,
  ) {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.beforeUnloadHandler);
    }
  }

  private createItem(pageId: string): PageAutosaveItem {
    const initialKey = contentKey(emptyDocument);
    return {
      baseRevision: 1,
      changedAt: null,
      confirmedContent: emptyDocument,
      confirmedKey: initialKey,
      conflictRevision: null,
      currentContent: emptyDocument,
      currentKey: initialKey,
      debounceTimer: null,
      draftId: null,
      draftWrite: Promise.resolve(),
      errorMessage: null,
      initialized: false,
      pageId,
      recovery: null,
      retryAttempt: 0,
      retryTimer: null,
      saveAttempt: null,
      serverContent: emptyDocument,
      serverRevision: 1,
      serverUpdatedAt: '',
      snapshot: emptySnapshot,
      sequence: 0,
      status: 'clean',
      subscribers: new Set(),
    };
  }

  private item(pageId: string) {
    let item = this.items.get(pageId);
    if (!item) {
      item = this.createItem(pageId);
      this.items.set(pageId, item);
    }
    return item;
  }

  private hasUnconfirmedChanges(item: PageAutosaveItem) {
    return (
      item.saveAttempt !== null || item.currentKey !== item.confirmedKey || item.recovery !== null
    );
  }

  private emit(item: PageAutosaveItem) {
    const nextSnapshot: AutosaveSnapshot = {
      conflictRevision: item.conflictRevision,
      errorMessage: item.errorMessage,
      hasUnconfirmedChanges: this.hasUnconfirmedChanges(item),
      recoveryAvailable: item.recovery !== null,
      retryAttempt: item.retryAttempt,
      status: item.status,
    };

    if (snapshotsEqual(item.snapshot, nextSnapshot)) {
      return;
    }

    item.snapshot = nextSnapshot;
    for (const subscriber of item.subscribers) {
      subscriber.listener();
    }
  }

  private clearDebounce(item: PageAutosaveItem) {
    if (item.debounceTimer !== null) {
      clearTimeout(item.debounceTimer);
      item.debounceTimer = null;
    }
  }

  private clearRetry(item: PageAutosaveItem) {
    if (item.retryTimer !== null) {
      clearTimeout(item.retryTimer);
      item.retryTimer = null;
    }
  }

  private queueDraftWrite(item: PageAutosaveItem, draft: PageDraft) {
    item.draftWrite = item.draftWrite
      .catch(() => undefined)
      .then(() => this.draftStore.write(draft));
  }

  private clearDraft(item: PageAutosaveItem) {
    const pendingWrite = item.draftWrite;
    const draftId = item.draftId ?? item.recovery?.draftId ?? null;
    item.draftId = null;
    item.draftWrite = Promise.resolve();
    if (draftId === null) {
      return Promise.resolve();
    }

    return pendingWrite
      .catch(() => undefined)
      .then(() => this.draftStore.removeIfMatches(item.pageId, draftId));
  }

  private clearDraftIfCurrent(item: PageAutosaveItem) {
    const pendingWrite = item.draftWrite;
    const draftId = item.draftId;
    item.draftId = null;
    item.draftWrite = Promise.resolve();
    if (draftId === null) {
      return Promise.resolve();
    }

    return pendingWrite
      .catch(() => undefined)
      .then(() => this.draftStore.removeIfMatches(item.pageId, draftId));
  }

  private persistCurrentDraft(item: PageAutosaveItem) {
    const draftId = createDraftId();
    item.draftId = draftId;
    this.queueDraftWrite(item, {
      baseRevision: item.baseRevision,
      changedAt: item.changedAt ?? Date.now(),
      content: item.currentContent,
      contentKey: item.currentKey,
      draftId,
      pageId: item.pageId,
    });
  }

  private scheduleSave(item: PageAutosaveItem, dueAt: number) {
    this.clearDebounce(item);
    const delay = Math.max(0, dueAt - Date.now());
    item.debounceTimer = setTimeout(() => {
      item.debounceTimer = null;
      if (
        !item.initialized ||
        item.saveAttempt !== null ||
        item.status === 'conflict' ||
        item.currentKey === item.confirmedKey
      ) {
        if (item.currentKey === item.confirmedKey && item.saveAttempt === null) {
          item.status = 'clean';
          item.errorMessage = null;
          item.retryAttempt = 0;
          void this.clearDraft(item);
          this.emit(item);
        }
        return;
      }

      item.status = 'waiting';
      this.emit(item);
      this.startSave(item);
    }, delay);
  }

  private startSave(item: PageAutosaveItem) {
    if (
      !item.initialized ||
      item.saveAttempt !== null ||
      item.status === 'conflict' ||
      item.currentKey === item.confirmedKey
    ) {
      return;
    }

    const saveAttempt: SaveAttempt = {
      baseRevision: item.baseRevision,
      content: item.currentContent,
      contentKey: item.currentKey,
      draftId: item.draftId,
      sequence: item.sequence,
    };
    item.saveAttempt = saveAttempt;
    item.errorMessage = null;
    item.status = 'saving';
    this.emit(item);
    void this.performSave(item, saveAttempt);
  }

  private async performSave(item: PageAutosaveItem, saveAttempt: SaveAttempt) {
    try {
      const response = await this.saveContent(
        item.pageId,
        saveAttempt.baseRevision,
        saveAttempt.content,
      );

      if (item.saveAttempt !== saveAttempt || this.items.get(item.pageId) !== item) {
        return;
      }

      item.saveAttempt = null;
      item.baseRevision = response.page.revision;
      item.serverRevision = response.page.revision;
      item.serverUpdatedAt = response.page.updatedAt;
      item.serverContent = response.page.content;
      item.confirmedContent = response.page.content;
      item.confirmedKey = contentKey(response.page.content);
      item.errorMessage = null;
      item.conflictRevision = null;
      item.retryAttempt = 0;

      const isCurrentContent = item.currentKey === saveAttempt.contentKey;
      if (isCurrentContent) {
        item.currentContent = response.page.content;
        item.currentKey = item.confirmedKey;
        item.changedAt = null;
        item.status = 'saved';
        void this.clearDraftIfCurrent(item);
      } else {
        item.status = 'waiting';
        this.emit(item);
        this.scheduleSave(item, (item.changedAt ?? Date.now()) + AUTOSAVE_DEBOUNCE_MS);
      }

      this.emit(item);
      for (const subscriber of item.subscribers) {
        subscriber.onSaved?.(response.page, isCurrentContent);
      }
    } catch (error) {
      if (item.saveAttempt !== saveAttempt || this.items.get(item.pageId) !== item) {
        return;
      }

      item.saveAttempt = null;
      if (error instanceof PageApiError && error.status === 409) {
        item.status = 'conflict';
        item.errorMessage = 'This page changed elsewhere. Choose which version to keep.';
        item.conflictRevision =
          typeof error.details?.currentRevision === 'number' ? error.details.currentRevision : null;
        this.emit(item);
        return;
      }

      item.errorMessage = pageErrorMessage(error, "We couldn't save this page.");
      item.conflictRevision = null;
      if (isTransientError(error)) {
        item.retryAttempt += 1;
        const delay = retryDelay(item.retryAttempt, this.random);
        item.status = 'failed';
        this.emit(item);
        this.clearRetry(item);
        item.retryTimer = setTimeout(() => {
          item.retryTimer = null;
          if (!this.hasUnconfirmedChanges(item) || item.status !== 'failed') {
            return;
          }
          item.status = 'retrying';
          this.emit(item);
          this.startSave(item);
        }, delay);
        return;
      }

      item.status = 'failed';
      this.emit(item);
    }
  }

  async initialize(page: PageDetail): Promise<AutosaveInitialization> {
    const item = this.item(page.id);
    if (!item.initialized) {
      item.initialized = true;
      item.baseRevision = page.revision;
      item.serverRevision = page.revision;
      item.serverUpdatedAt = page.updatedAt;
      item.serverContent = page.content;
      item.confirmedContent = page.content;
      item.confirmedKey = contentKey(page.content);
      item.currentContent = page.content;
      item.currentKey = item.confirmedKey;
      item.status = 'clean';
      item.errorMessage = null;
      item.conflictRevision = null;
      item.retryAttempt = 0;
      this.emit(item);

      const initialSequence = item.sequence;
      const draft = await this.draftStore.read(page.id);
      if (
        this.items.get(page.id) !== item ||
        item.sequence !== initialSequence ||
        item.currentKey !== item.confirmedKey
      ) {
        return { contentToApply: null };
      }

      if (draft && draft.contentKey !== item.confirmedKey) {
        item.recovery = draft;
        this.emit(item);
      } else if (draft) {
        await this.draftStore.removeIfMatches(page.id, draft.draftId);
      }

      return { contentToApply: null };
    }

    if (!this.hasUnconfirmedChanges(item) && page.revision >= item.baseRevision) {
      item.baseRevision = page.revision;
      item.serverRevision = page.revision;
      item.serverUpdatedAt = page.updatedAt;
      item.serverContent = page.content;
      item.confirmedContent = page.content;
      item.confirmedKey = contentKey(page.content);
      item.currentContent = page.content;
      item.currentKey = item.confirmedKey;
      if (item.status !== 'saved') {
        item.status = 'clean';
      }
      this.emit(item);
      return { contentToApply: null };
    }

    return {
      contentToApply: item.currentKey === contentKey(page.content) ? null : item.currentContent,
    };
  }

  getSnapshot(pageId: string) {
    return this.item(pageId).snapshot;
  }

  subscribe(pageId: string, listener: () => void, onSaved?: SavedPageListener) {
    const item = this.item(pageId);
    const subscriber: Subscriber = { listener, onSaved };
    item.subscribers.add(subscriber);
    return () => item.subscribers.delete(subscriber);
  }

  change(pageId: string, content: TiptapDocument) {
    const item = this.item(pageId);
    if (!item.initialized) {
      return;
    }

    this.clearDebounce(item);
    this.clearRetry(item);
    item.sequence += 1;
    item.currentContent = content;
    item.currentKey = contentKey(content);
    item.changedAt = Date.now();
    item.recovery = null;
    item.errorMessage = null;
    item.conflictRevision = null;
    item.retryAttempt = 0;
    this.persistCurrentDraft(item);

    if (item.currentKey === item.confirmedKey && item.saveAttempt === null) {
      item.status = 'clean';
      void this.clearDraft(item);
      this.emit(item);
      return;
    }

    if (item.saveAttempt === null) {
      item.status = 'dirty';
      this.scheduleSave(item, item.changedAt + AUTOSAVE_DEBOUNCE_MS);
    } else {
      item.status = 'saving';
    }
    this.emit(item);
  }

  retry(pageId: string) {
    const item = this.item(pageId);
    if (!item.initialized || item.status === 'conflict' || !this.hasUnconfirmedChanges(item)) {
      return;
    }

    this.clearDebounce(item);
    this.clearRetry(item);
    item.retryAttempt = 0;
    item.errorMessage = null;
    item.status = 'retrying';
    this.emit(item);
    this.startSave(item);
  }

  async recoverDraft(pageId: string) {
    const item = this.item(pageId);
    const draft = item.recovery;
    if (!item.initialized || draft === null) {
      return null;
    }

    this.clearDebounce(item);
    this.clearRetry(item);
    item.recovery = null;
    item.baseRevision = draft.baseRevision;
    item.currentContent = draft.content;
    item.currentKey = draft.contentKey;
    item.sequence += 1;
    item.changedAt = Date.now();
    item.errorMessage = null;
    item.conflictRevision = null;
    item.retryAttempt = 0;
    this.persistCurrentDraft(item);
    item.status = 'dirty';
    this.emit(item);
    this.scheduleSave(item, item.changedAt + AUTOSAVE_DEBOUNCE_MS);
    return draft.content;
  }

  async discardDraft(pageId: string) {
    const item = this.item(pageId);
    if (!item.initialized) {
      return;
    }

    this.clearDebounce(item);
    this.clearRetry(item);
    item.baseRevision = item.serverRevision;
    item.confirmedContent = item.serverContent;
    item.confirmedKey = contentKey(item.serverContent);
    item.currentContent = item.serverContent;
    item.currentKey = item.confirmedKey;
    item.changedAt = null;
    item.errorMessage = null;
    item.conflictRevision = null;
    item.retryAttempt = 0;
    item.status = 'clean';
    await this.clearDraft(item);
    item.recovery = null;
    this.emit(item);
  }

  async resetFromServer(page: PageDetail) {
    const item = this.item(page.id);
    this.clearDebounce(item);
    this.clearRetry(item);
    item.saveAttempt = null;
    item.initialized = true;
    item.baseRevision = page.revision;
    item.serverRevision = page.revision;
    item.serverUpdatedAt = page.updatedAt;
    item.serverContent = page.content;
    item.confirmedContent = page.content;
    item.confirmedKey = contentKey(page.content);
    item.currentContent = page.content;
    item.currentKey = item.confirmedKey;
    item.changedAt = null;
    item.errorMessage = null;
    item.conflictRevision = null;
    item.retryAttempt = 0;
    item.status = 'clean';
    await this.clearDraft(item);
    item.recovery = null;
    this.emit(item);
  }

  getCurrentContent(pageId: string) {
    return this.item(pageId).currentContent;
  }

  dispose() {
    for (const item of this.items.values()) {
      this.clearDebounce(item);
      this.clearRetry(item);
      item.saveAttempt = null;
      item.subscribers.clear();
    }
    this.items.clear();
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    }
  }
}

export const autosaveManager = new PageAutosaveManager();

export function usePageAutosave(
  page: PageDetail,
  onSaved: SavedPageListener,
  onContentAvailable: (content: TiptapDocument) => void,
): UsePageAutosaveResult {
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onContentAvailableRef = useRef(onContentAvailable);
  onContentAvailableRef.current = onContentAvailable;

  const subscribe = useCallback(
    (listener: () => void) =>
      autosaveManager.subscribe(page.id, listener, (savedPage, isCurrentContent) => {
        onSavedRef.current(savedPage, isCurrentContent);
      }),
    [page.id],
  );
  const getSnapshot = useCallback(() => autosaveManager.getSnapshot(page.id), [page.id]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    let active = true;
    void autosaveManager.initialize(page).then(({ contentToApply }) => {
      if (active && contentToApply !== null) {
        onContentAvailableRef.current(contentToApply);
      }
    });

    return () => {
      active = false;
    };
  }, [page.id, page.revision, page.updatedAt]);

  const change = useCallback(
    (content: TiptapDocument) => autosaveManager.change(page.id, content),
    [page.id],
  );
  const retry = useCallback(() => autosaveManager.retry(page.id), [page.id]);
  const recoverDraft = useCallback(() => autosaveManager.recoverDraft(page.id), [page.id]);
  const discardDraft = useCallback(() => autosaveManager.discardDraft(page.id), [page.id]);
  const resetFromServer = useCallback(
    (serverPage: PageDetail) => autosaveManager.resetFromServer(serverPage),
    [],
  );
  const getCurrentContent = useCallback(
    () => autosaveManager.getCurrentContent(page.id),
    [page.id],
  );

  return {
    change,
    discardDraft,
    getCurrentContent,
    recoverDraft,
    resetFromServer,
    retry,
    snapshot,
  };
}
