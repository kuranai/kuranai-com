import type { TiptapDocument } from '../../../../shared/pages';

const DRAFT_DATABASE_NAME = 'dovari-editor';
const DRAFT_DATABASE_VERSION = 1;
const DRAFT_STORE_NAME = 'page-drafts';

export interface PageDraft {
  pageId: string;
  draftId: string;
  baseRevision: number;
  changedAt: number;
  contentKey: string;
  content: TiptapDocument;
}

export interface DraftStore {
  read(pageId: string): Promise<PageDraft | null>;
  write(draft: PageDraft): Promise<void>;
  remove(pageId: string): Promise<void>;
  removeIfMatches(pageId: string, draftId: string): Promise<void>;
}

function isIndexedDbAvailable() {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DATABASE_NAME, DRAFT_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        database.createObjectStore(DRAFT_STORE_NAME, { keyPath: 'pageId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

export function createIndexedDbDraftStore(): DraftStore {
  async function withDatabase<T>(operation: (database: IDBDatabase) => Promise<T>) {
    if (!isIndexedDbAvailable()) {
      throw new Error('IndexedDB is not available in this browser.');
    }

    const database = await openDatabase();
    try {
      return await operation(database);
    } finally {
      database.close();
    }
  }

  return {
    async read(pageId) {
      try {
        return await withDatabase(async (database) => {
          const transaction = database.transaction(DRAFT_STORE_NAME, 'readonly');
          const value = await requestResult<PageDraft | undefined>(
            transaction.objectStore(DRAFT_STORE_NAME).get(pageId),
          );
          await transactionComplete(transaction);
          return value ?? null;
        });
      } catch {
        return null;
      }
    },

    async write(draft) {
      try {
        await withDatabase(async (database) => {
          const transaction = database.transaction(DRAFT_STORE_NAME, 'readwrite');
          transaction.objectStore(DRAFT_STORE_NAME).put(draft);
          await transactionComplete(transaction);
        });
      } catch {
        // Draft persistence is a loss-prevention aid and must not block saving.
      }
    },

    async remove(pageId) {
      try {
        await withDatabase(async (database) => {
          const transaction = database.transaction(DRAFT_STORE_NAME, 'readwrite');
          transaction.objectStore(DRAFT_STORE_NAME).delete(pageId);
          await transactionComplete(transaction);
        });
      } catch {
        // A later write or the next successful save can clean up the draft.
      }
    },

    async removeIfMatches(pageId, draftId) {
      try {
        await withDatabase(async (database) => {
          const transaction = database.transaction(DRAFT_STORE_NAME, 'readwrite');
          const store = transaction.objectStore(DRAFT_STORE_NAME);
          const current = await requestResult<PageDraft | undefined>(store.get(pageId));
          if (current?.draftId === draftId) {
            store.delete(pageId);
          }
          await transactionComplete(transaction);
        });
      } catch {
        // Keep the draft when its cleanup cannot be confirmed.
      }
    },
  };
}
