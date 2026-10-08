import type { ImageAsset } from '../../../domain/asset.ts';
import type { AssetId, ProductionId } from '../../../domain/ids.ts';
import { StorageQuotaError } from '../store/storage.ts';

/**
 * Where the asset store keeps its records and bytes. IndexedDB in the browser, a map in tests;
 * every write either completes or throws (quota, blocked storage), so the store can report it.
 */

/** One stored image: the port's metadata plus what only the store needs. */
export type StoredAsset = {
  id: AssetId;
  productionId: ProductionId;
  asset: ImageAsset;
};

export interface AssetBackend {
  readonly scope: 'local' | 'memory';
  /** Every stored record (metadata only). */
  load(): Promise<StoredAsset[]>;
  /** Writes a record, and its bytes when given, atomically. */
  write(record: StoredAsset, blob?: Blob): Promise<void>;
  readBlob(assetId: AssetId): Promise<Blob | undefined>;
  /** Deletes records and their bytes, atomically. */
  remove(assetIds: readonly AssetId[]): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export type MemoryBackendOptions = {
  /** Byte budget for stored blobs, to exercise the "cota cheia" path in tests. */
  quotaBytes?: number;
  /** Every operation fails as if storage were blocked (private mode). */
  unavailable?: boolean;
};

export type MemoryBackend = AssetBackend & {
  setQuota(bytes: number | undefined): void;
  /** Stored records, for tests. */
  records(): Map<AssetId, StoredAsset>;
};

class StorageBlockedError extends Error {
  readonly name = 'SecurityError';
}

export function memoryBackend(options: MemoryBackendOptions = {}): MemoryBackend {
  const records = new Map<AssetId, StoredAsset>();
  const blobs = new Map<AssetId, Blob>();
  let quota = options.quotaBytes;
  const guard = () => {
    if (options.unavailable) throw new StorageBlockedError('Storage blocked');
  };
  const used = () => [...blobs.values()].reduce((total, blob) => total + blob.size, 0);
  return {
    scope: 'memory',
    async load() {
      guard();
      return [...records.values()].map((record) => structuredClone(record));
    },
    async write(record, blob) {
      guard();
      if (blob && quota !== undefined && used() - (blobs.get(record.id)?.size ?? 0) + blob.size > quota) {
        throw new StorageQuotaError('Storage quota exceeded');
      }
      records.set(record.id, structuredClone(record));
      if (blob) blobs.set(record.id, blob);
    },
    async readBlob(assetId) {
      guard();
      return blobs.get(assetId);
    },
    async remove(assetIds) {
      guard();
      for (const id of assetIds) {
        records.delete(id);
        blobs.delete(id);
      }
    },
    async clear() {
      guard();
      records.clear();
      blobs.clear();
    },
    close() {},
    setQuota(bytes) {
      quota = bytes;
    },
    records: () => records,
  };
}
