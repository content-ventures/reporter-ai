import type { AssetId } from '../../../domain/ids.ts';
import type { AssetBackend, StoredAsset } from './backend.ts';

/**
 * IndexedDB backend: database `reporter-sim-assets` v1 with two object stores, `assets` (records,
 * key `id`) and `blobs` (the bytes, keyed by asset id). A record and its bytes are written in one
 * transaction, so a quota error never leaves a record without its image.
 */

export const ASSET_DB_NAME = 'reporter-sim-assets';
export const ASSET_DB_VERSION = 1;
const RECORDS = 'assets';
const BLOBS = 'blobs';

/** The subset of the IndexedDB API this backend uses (the browser's, or a test double). */
export type IdbRequest<T> = {
  result: T;
  error: unknown;
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type IdbOpenRequest = IdbRequest<IdbDatabase> & {
  onupgradeneeded: ((event: unknown) => void) | null;
  onblocked: ((event: unknown) => void) | null;
};

export type IdbObjectStore = {
  put(value: unknown, key?: string): IdbRequest<unknown>;
  get(key: string): IdbRequest<unknown>;
  getAll(): IdbRequest<unknown[]>;
  delete(key: string): IdbRequest<unknown>;
  clear(): IdbRequest<unknown>;
};

export type IdbTransaction = {
  objectStore(name: string): IdbObjectStore;
  error: unknown;
  oncomplete: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onabort: ((event: unknown) => void) | null;
};

export type IdbDatabase = {
  readonly objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: { keyPath?: string }): unknown;
  transaction(stores: string | string[], mode: 'readonly' | 'readwrite'): IdbTransaction;
  close(): void;
  onversionchange?: ((event: unknown) => void) | null;
};

export type IdbFactory = { open(name: string, version: number): IdbOpenRequest };

/** The browser's IndexedDB, or undefined (SSR, Node, storage disabled). Never throws. */
export function browserIndexedDb(): IdbFactory | undefined {
  try {
    const factory = (globalThis as { indexedDB?: IdbFactory }).indexedDB;
    return factory && typeof factory.open === 'function' ? factory : undefined;
  } catch {
    return undefined;
  }
}

class IdbUnavailableError extends Error {
  readonly name = 'SecurityError';
}

function openDatabase(factory: IdbFactory): Promise<IdbDatabase> {
  return new Promise((resolve, reject) => {
    let request: IdbOpenRequest;
    try {
      request = factory.open(ASSET_DB_NAME, ASSET_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new IdbUnavailableError('IndexedDB open failed'));
    request.onblocked = () => reject(new IdbUnavailableError('IndexedDB blocked by another tab'));
  });
}

function done(transaction: IdbTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function answer<T>(request: IdbRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function isStoredAsset(value: unknown): value is StoredAsset {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredAsset>;
  return typeof record.id === 'string' && typeof record.productionId === 'string' && record.asset?.kind === 'image' && record.asset.id === record.id;
}

export function indexedDbBackend(factory: IdbFactory): AssetBackend {
  let database: Promise<IdbDatabase> | undefined;
  const db = (): Promise<IdbDatabase> => {
    if (database) return database;
    const opening = openDatabase(factory).then((opened) => {
      // Another tab upgrading the schema: close so it can proceed; the next call reopens.
      opened.onversionchange = () => {
        opened.close();
        if (database === opening) database = undefined;
      };
      return opened;
    });
    // A failed open is retried on the next operation (the person may free space or allow storage).
    opening.catch(() => {
      if (database === opening) database = undefined;
    });
    database = opening;
    return opening;
  };
  return {
    scope: 'local',
    async load() {
      const opened = await db();
      const transaction = opened.transaction(RECORDS, 'readonly');
      const all = await answer(transaction.objectStore(RECORDS).getAll());
      return all.filter(isStoredAsset);
    },
    async write(record, blob) {
      const opened = await db();
      const transaction = opened.transaction(blob ? [RECORDS, BLOBS] : RECORDS, 'readwrite');
      const finished = done(transaction);
      transaction.objectStore(RECORDS).put(record);
      if (blob) transaction.objectStore(BLOBS).put(blob, record.id);
      await finished;
    },
    async readBlob(assetId: AssetId) {
      const opened = await db();
      const transaction = opened.transaction(BLOBS, 'readonly');
      const value = await answer(transaction.objectStore(BLOBS).get(assetId));
      return value instanceof Blob ? value : undefined;
    },
    async remove(assetIds) {
      if (assetIds.length === 0) return;
      const opened = await db();
      const transaction = opened.transaction([RECORDS, BLOBS], 'readwrite');
      const finished = done(transaction);
      for (const id of assetIds) {
        transaction.objectStore(RECORDS).delete(id);
        transaction.objectStore(BLOBS).delete(id);
      }
      await finished;
    },
    async clear() {
      const opened = await db();
      const transaction = opened.transaction([RECORDS, BLOBS], 'readwrite');
      const finished = done(transaction);
      transaction.objectStore(RECORDS).clear();
      transaction.objectStore(BLOBS).clear();
      await finished;
    },
    close() {
      void database?.then((opened) => opened.close(), () => undefined);
      database = undefined;
    },
  };
}
