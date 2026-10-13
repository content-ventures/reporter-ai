import type { IdbDatabase, IdbFactory, IdbObjectStore, IdbOpenRequest, IdbRequest, IdbTransaction } from './indexeddb.ts';

/**
 * In-memory stand-in for the slice of IndexedDB the asset backend uses (Node has no IndexedDB).
 * Asynchronous like the real one (callbacks after the current task), with transactions that
 * commit or abort as a whole, a byte quota for stored Blobs and a "storage blocked" mode.
 */

type StoreData = { keyPath?: string; data: Map<string, unknown> };
type Database = { version: number; stores: Map<string, StoreData> };

export type FakeIndexedDb = IdbFactory & {
  setQuota(bytes: number | undefined): void;
  setBlocked(blocked: boolean): void;
  /** Stored values per database and store, for tests. */
  dump(name: string): Record<string, unknown[]> | undefined;
};

const later = (task: () => void) => setTimeout(task, 0);

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function request<T>(): IdbRequest<T> {
  return { result: undefined as T, error: null, onsuccess: null, onerror: null };
}

function blobBytes(stores: Iterable<Map<string, unknown>>): number {
  let total = 0;
  for (const data of stores) for (const value of data.values()) if (value instanceof Blob) total += value.size;
  return total;
}

export function fakeIndexedDb(options: { quotaBytes?: number; blocked?: boolean } = {}): FakeIndexedDb {
  const databases = new Map<string, Database>();
  let quota = options.quotaBytes;
  let blocked = options.blocked === true;

  function handle(db: Database): IdbDatabase {
    return {
      objectStoreNames: { contains: (name) => db.stores.has(name) },
      createObjectStore(name, storeOptions) {
        db.stores.set(name, { keyPath: storeOptions?.keyPath, data: new Map() });
        return {};
      },
      transaction(names, mode) {
        const list = Array.isArray(names) ? names : [names];
        for (const name of list) if (!db.stores.has(name)) throw namedError('NotFoundError', `No store ${name}`);
        const staged = new Map(list.map((name) => [name, new Map((db.stores.get(name) as StoreData).data)]));
        const transaction: IdbTransaction = {
          error: null,
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore(name): IdbObjectStore {
            const data = staged.get(name);
            const spec = db.stores.get(name);
            if (!data || !spec) throw namedError('NotFoundError', `Store ${name} outside the transaction`);
            const answer = <T>(compute: () => T): IdbRequest<T> => {
              const pending = request<T>();
              later(() => {
                pending.result = compute();
                pending.onsuccess?.({});
              });
              return pending;
            };
            const writable = () => {
              if (mode !== 'readwrite') throw namedError('ReadOnlyError', 'Read-only transaction');
            };
            return {
              put(value, key) {
                writable();
                const id = key ?? (spec.keyPath ? String((value as Record<string, unknown>)[spec.keyPath]) : undefined);
                if (id === undefined) throw namedError('DataError', 'Missing key');
                data.set(id, value instanceof Blob ? value : structuredClone(value));
                return answer(() => id);
              },
              get: (key) => answer(() => data.get(key)),
              getAll: () => answer(() => [...data.values()]),
              delete(key) {
                writable();
                data.delete(key);
                return answer(() => undefined);
              },
              clear() {
                writable();
                data.clear();
                return answer(() => undefined);
              },
            };
          },
        };
        // Requests answer first, then the transaction settles (as in IndexedDB).
        later(() =>
          later(() => {
            if (mode === 'readwrite') {
              const after = new Map([...db.stores].map(([name, spec]) => [name, staged.get(name) ?? spec.data]));
              if (quota !== undefined && blobBytes(after.values()) > quota) {
                transaction.error = namedError('QuotaExceededError', 'Quota exceeded');
                transaction.onabort?.({});
                return;
              }
              for (const [name, data] of staged) (db.stores.get(name) as StoreData).data = data;
            }
            transaction.oncomplete?.({});
          }),
        );
        return transaction;
      },
      close() {},
      onversionchange: null,
    };
  }

  return {
    open(name, version) {
      const opening = request<IdbDatabase>() as IdbOpenRequest;
      opening.onupgradeneeded = null;
      opening.onblocked = null;
      later(() => {
        if (blocked) {
          opening.error = namedError('SecurityError', 'Storage blocked');
          opening.onerror?.({});
          return;
        }
        let db = databases.get(name);
        if (!db) {
          db = { version: 0, stores: new Map() };
          databases.set(name, db);
        }
        opening.result = handle(db);
        if (db.version < version) {
          db.version = version;
          opening.onupgradeneeded?.({});
        }
        opening.onsuccess?.({});
      });
      return opening;
    },
    setQuota(bytes) {
      quota = bytes;
    },
    setBlocked(next) {
      blocked = next;
    },
    dump(name) {
      const db = databases.get(name);
      return db ? Object.fromEntries([...db.stores].map(([store, spec]) => [store, [...spec.data.values()]])) : undefined;
    },
  };
}
