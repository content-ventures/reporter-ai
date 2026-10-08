import type { AssetStore } from '../../../ports/assets.ts';
import { createAssetStore } from './asset-store.ts';
import type { AssetStoreOptions } from './asset-store.ts';
import { memoryBackend } from './backend.ts';
import type { MemoryBackendOptions } from './backend.ts';
import { browserIndexedDb, indexedDbBackend } from './indexeddb.ts';
import type { IdbFactory } from './indexeddb.ts';

/**
 * Local AssetStore (article images): IndexedDB in the browser, memory in Node and tests. Imported
 * only by src/runtime and tests.
 */

export type LocalAssetOptions = Omit<AssetStoreOptions, 'backend'>;

/** Images in memory (Node, tests, a runtime without persistence). */
export function createMemoryAssetStore(options: LocalAssetOptions & { memory?: MemoryBackendOptions }): AssetStore {
  const { memory, ...rest } = options;
  return createAssetStore({ ...rest, backend: memoryBackend(memory) });
}

/** Images in IndexedDB (`reporter-sim-assets`), or in memory when this browser has none. */
export function createIndexedDbAssetStore(options: LocalAssetOptions & { indexedDB?: IdbFactory }): AssetStore {
  const { indexedDB, ...rest } = options;
  const factory = indexedDB ?? browserIndexedDb();
  return createAssetStore({ ...rest, backend: factory ? indexedDbBackend(factory) : memoryBackend() });
}

export { ASSET_LIMITS, ASSET_SAVE_MESSAGES, bitmapSize, createAssetStore } from './asset-store.ts';
export type { AssetStoreOptions, ImageSize } from './asset-store.ts';
export { memoryBackend } from './backend.ts';
export type { AssetBackend, MemoryBackend, MemoryBackendOptions, StoredAsset } from './backend.ts';
export { ASSET_DB_NAME, ASSET_DB_VERSION, browserIndexedDb, indexedDbBackend } from './indexeddb.ts';
export type { IdbFactory } from './indexeddb.ts';
export { sniffImage } from './image-sniff.ts';
export { sha256Hex, sha256Sync } from './sha256.ts';
