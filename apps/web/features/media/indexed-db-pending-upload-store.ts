/**
 * Real `indexedDB`-backed `PendingUploadStore`.
 *
 * Deliberately thin: every method opens the database, runs one transaction
 * built from plain event handlers (not a generic promise-wrapping helper
 * layered over "await inside a transaction" — IndexedDB transactions
 * auto-commit once no request is pending, and chaining a `get` into a `put`
 * is clearer and less fragile written as one explicit
 * `onsuccess`-triggers-the-next-request chain than as `await`ed steps).
 * No schema migration story beyond a single `onupgradeneeded` that creates
 * the one object store this module has ever needed.
 *
 * Not unit-tested directly: `jsdom`, this project's test environment, does
 * not implement `indexedDB` at all (confirmed directly rather than
 * assumed). This matches this codebase's own precedent for a real,
 * mechanically-simple infrastructure adapter with no independent test file
 * of its own (`services/api/.../gcs-media-storage-gateway.ts`). The logic
 * worth testing — resumability decisions, offset reconciliation, chunk
 * upload/pause/retry outcomes — lives in `resumable-upload-driver.ts` and
 * `media-upload-controller.ts`, both fully unit-tested against a fake
 * `PendingUploadStore` and a fake `ResumableTransport`.
 *
 * Source: `pending-upload-store.ts`'s own doc comment.
 */

import type { PendingUploadRecord, PendingUploadStore } from './pending-upload-store';

const DATABASE_NAME = 'verdery.media.pendingUploads';
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = 'pendingUploads';
const GARDEN_ID_INDEX_NAME = 'gardenId';

/**
 * Present only when the browser exposes `indexedDB` (it is absent under
 * server rendering, and some locked-down private-browsing modes disable it
 * entirely) — every caller checks this before using the store, the same
 * graceful-degradation shape `core/drafts/local-draft-store.ts` already
 * uses for `localStorage`.
 */
export function isPendingUploadStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        const store = database.createObjectStore(OBJECT_STORE_NAME, { keyPath: 'mediaId' });
        store.createIndex(GARDEN_ID_INDEX_NAME, 'gardenId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open the pending-upload database.'));
  });
}

/** Runs one transaction to completion, resolving with whatever `resultRef` held once it commits. */
function runTransaction<TResult>(
  database: IDBDatabase,
  mode: IDBTransactionMode,
  work: (
    store: IDBObjectStore,
    resolveWith: (value: TResult) => void,
    reject: (error: unknown) => void,
  ) => void,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(OBJECT_STORE_NAME, mode);
    const store = transaction.objectStore(OBJECT_STORE_NAME);
    let result: TResult;
    let settled = false;

    transaction.oncomplete = () => {
      if (!settled) {
        resolve(result);
      }
    };
    transaction.onerror = () => {
      settled = true;
      reject(transaction.error ?? new Error('The pending-upload transaction failed.'));
    };
    transaction.onabort = () => {
      settled = true;
      reject(transaction.error ?? new Error('The pending-upload transaction was aborted.'));
    };

    work(
      store,
      (value) => {
        result = value;
      },
      (error) => {
        settled = true;
        reject(
          error instanceof Error ? error : new Error('The pending-upload transaction failed.'),
        );
        transaction.abort();
      },
    );
  });
}

export function createIndexedDbPendingUploadStore(): PendingUploadStore {
  return {
    async put(record) {
      const database = await openDatabase();
      try {
        await runTransaction<void>(database, 'readwrite', (store, resolveWith) => {
          const request = store.put(record);
          request.onsuccess = () => resolveWith(undefined);
        });
      } finally {
        database.close();
      }
    },

    async get(mediaId) {
      const database = await openDatabase();
      try {
        return await runTransaction<PendingUploadRecord | null>(
          database,
          'readonly',
          (store, resolveWith) => {
            const request = store.get(mediaId);
            request.onsuccess = () =>
              resolveWith((request.result as PendingUploadRecord | undefined) ?? null);
          },
        );
      } finally {
        database.close();
      }
    },

    async updateOffset(mediaId, confirmedOffsetBytes) {
      const database = await openDatabase();
      try {
        await runTransaction<void>(database, 'readwrite', (store, resolveWith, reject) => {
          const getRequest = store.get(mediaId);
          getRequest.onsuccess = () => {
            const existing = getRequest.result as PendingUploadRecord | undefined;
            if (existing === undefined) {
              resolveWith(undefined);
              return;
            }
            const putRequest = store.put({ ...existing, confirmedOffsetBytes });
            putRequest.onsuccess = () => resolveWith(undefined);
            putRequest.onerror = () =>
              reject(putRequest.error ?? new Error('Failed to update the pending-upload offset.'));
          };
          getRequest.onerror = () =>
            reject(getRequest.error ?? new Error('Failed to read the pending-upload record.'));
        });
      } finally {
        database.close();
      }
    },

    async delete(mediaId) {
      const database = await openDatabase();
      try {
        await runTransaction<void>(database, 'readwrite', (store, resolveWith) => {
          const request = store.delete(mediaId);
          request.onsuccess = () => resolveWith(undefined);
        });
      } finally {
        database.close();
      }
    },

    async listByGarden(gardenId) {
      const database = await openDatabase();
      try {
        return await runTransaction<readonly PendingUploadRecord[]>(
          database,
          'readonly',
          (store, resolveWith) => {
            const request = store.index(GARDEN_ID_INDEX_NAME).getAll(gardenId);
            request.onsuccess = () => resolveWith(request.result as PendingUploadRecord[]);
          },
        );
      } finally {
        database.close();
      }
    },
  };
}
