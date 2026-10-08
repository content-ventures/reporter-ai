import { IMAGE_LIMITS, IMAGE_MIME_TYPES, normalizeCredit, validateImageFile, validateImageUrl } from '../../../domain/asset.ts';
import type { AssetRights, ImageAsset } from '../../../domain/asset.ts';
import type { ActorId, AssetId, ProductionId, WorkspaceId } from '../../../domain/ids.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import type { AssetChange, AssetHealth, AssetInput, AssetLimits, AssetMeta, AssetPatch, AssetRefusal, AssetStore, UnusedAssets } from '../../../ports/assets.ts';
import type { SaveErrorCode } from '../../../ports/save-status.ts';
import type { Clock, IdGenerator } from '../../../ports/system.ts';
import { dataUrl } from '../render/encoding.ts';
import { storageErrorCode } from '../store/storage.ts';
import { memoryBackend } from './backend.ts';
import type { AssetBackend, StoredAsset } from './backend.ts';
import { SNIFF_BYTES, sniffImage } from './image-sniff.ts';

/**
 * Local AssetStore over a backend (IndexedDB in the browser, a map in tests). Metadata is kept
 * in memory once the backend is read, so `get`/`list` are synchronous; bytes stay in the backend
 * and are served as one `blob:` URL per asset. Persistence failures are never silent: a refused
 * upload says why (`quota`), a failed credit change stays in this tab and turns the save status
 * into an error with "Tentar de novo"; when storage is blocked the images live in memory and the
 * save status says they last only in this tab. The example workspace ships a few images of its own
 * (`seed`): listed like any other, their bytes read from the app's files when asked, never stored.
 */

export type ImageSize = { width: number; height: number };

/** An image of the example workspace: its record, and where the app serves its bytes. */
export type SeededAsset = { productionId: ProductionId; asset: ImageAsset; src: string };

export type AssetStoreOptions = {
  backend: AssetBackend;
  clock: Clock;
  ids: IdGenerator;
  workspaceId: WorkspaceId;
  /** Who adds the image (the acting member). */
  actorId: () => ActorId;
  /** `?reset=1`, "Restaurar exemplo": drop stored images before reading. */
  reset?: boolean;
  /**
   * Pixel size of an uploaded image whose header does not say it (the header is read first, so
   * most images are never decoded); default `createImageBitmap` when the environment has it.
   */
  measure?: (blob: Blob) => Promise<ImageSize | undefined>;
  /** Images of the example workspace (fixtures), present unless this browser stored a change to them. */
  seed?: readonly SeededAsset[];
  /** Reads a seeded image's bytes; default `fetch` of its address (undefined where that fails). */
  fetchSeed?: (src: string) => Promise<Blob | undefined>;
};

/** An address the app serves, made absolute against the page (as stored when there is no page). */
function servedUrl(src: string): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!origin || origin === 'null') return src;
  try {
    return new URL(src, origin).href;
  } catch {
    return src;
  }
}

/** `fetch` of an address the app serves; undefined without `fetch` (Node) or on any failure. */
async function fetchBlob(src: string): Promise<Blob | undefined> {
  const run = (globalThis as { fetch?: (input: string) => Promise<{ ok: boolean; blob(): Promise<Blob> }> }).fetch;
  if (!run) return undefined;
  try {
    const response = await run(src);
    return response.ok ? await response.blob() : undefined;
  } catch {
    return undefined;
  }
}

export const ASSET_LIMITS: AssetLimits = {
  maxBytes: IMAGE_LIMITS.maxBytes,
  mimeTypes: IMAGE_MIME_TYPES,
  accept: IMAGE_LIMITS.accept,
  hint: IMAGE_LIMITS.hint,
};

export const ASSET_SAVE_MESSAGES: Record<SaveErrorCode, string> = {
  quota: 'O espaço deste navegador acabou para as imagens. Libere espaço e tente de novo.',
  unavailable: 'Este navegador não permite guardar imagens. Elas valem só nesta aba.',
  unknown: 'Não foi possível guardar as imagens neste navegador. Tente de novo.',
};

const PUT_REFUSALS: Record<SaveErrorCode, string> = {
  quota: 'O espaço deste navegador acabou e a imagem não foi guardada. Libere espaço e tente de novo.',
  unavailable: 'Este navegador não permite guardar a imagem. Tente de novo ou use um link.',
  unknown: 'Não foi possível guardar a imagem. Tente de novo.',
};

const COLLECT_REFUSALS: Record<SaveErrorCode, string> = {
  quota: 'Não foi possível apagar as imagens fora de uso. Tente de novo.',
  unavailable: 'Este navegador não permite apagar as imagens guardadas.',
  unknown: 'Não foi possível apagar as imagens fora de uso. Tente de novo.',
};

type CreateImageBitmap = (blob: Blob) => Promise<{ width: number; height: number; close?: () => void }>;

/** Pixel size via `createImageBitmap` (browser); undefined where it does not exist or fails. */
export async function bitmapSize(blob: Blob): Promise<ImageSize | undefined> {
  const create = (globalThis as { createImageBitmap?: CreateImageBitmap }).createImageBitmap;
  if (!create) return undefined;
  try {
    const bitmap = await create(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

type UrlApi = { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void };

export function createAssetStore(options: AssetStoreOptions): AssetStore {
  const { clock, ids } = options;
  const measure = options.measure ?? bitmapSize;
  const listeners = new Set<(change: AssetChange) => void>();
  const records = new Map<AssetId, StoredAsset>();
  /** Records whose last write failed (credit/rights changes kept in this tab). */
  const pending = new Set<AssetId>();
  const urls = new Map<AssetId, Promise<string | undefined>>();
  const createdUrls = new Set<string>();
  let backend = options.backend;
  /** Storage was refused: images live in memory for this tab only. */
  let degraded = false;
  let health: AssetHealth = { status: 'ok' };
  let disposed = false;
  const seeds = new Map<AssetId, SeededAsset>((options.seed ?? []).map((entry) => [entry.asset.id, entry]));
  const seedBlobs = new Map<AssetId, Promise<Blob | undefined>>();
  const fetchSeed = options.fetchSeed ?? fetchBlob;

  /** The example's images, unless a stored record (a changed credit, say) already holds them. */
  function plant(): void {
    for (const entry of seeds.values()) {
      if (!records.has(entry.asset.id)) records.set(entry.asset.id, { id: entry.asset.id, productionId: entry.productionId, asset: deepFreeze(structuredClone(entry.asset)) });
    }
  }

  /** A seeded image's bytes, read once (a failed read is tried again next time). */
  function seedBlob(assetId: AssetId): Promise<Blob | undefined> {
    const entry = seeds.get(assetId);
    if (!entry) return Promise.resolve(undefined);
    const cached = seedBlobs.get(assetId);
    if (cached) return cached;
    const pending = fetchSeed(entry.src).catch(() => undefined);
    seedBlobs.set(assetId, pending);
    void pending.then((blob) => {
      if (!blob && seedBlobs.get(assetId) === pending) seedBlobs.delete(assetId);
    });
    return pending;
  }

  const urlApi = (): UrlApi => (globalThis as { URL?: UrlApi }).URL ?? {};

  function emit(change: AssetChange): void {
    if (disposed) return;
    for (const listener of [...listeners]) listener(change);
  }

  function setHealth(next: AssetHealth): void {
    const same = next.status === health.status && (next.status === 'ok' || (health.status === 'error' && next.code === health.code));
    health = next;
    if (!same) emit({ kind: 'health', assetIds: [], productionIds: [] });
  }

  function failure(code: SaveErrorCode): AssetHealth {
    return { status: 'error', code, message: ASSET_SAVE_MESSAGES[code] };
  }

  function settleHealth(): void {
    if (degraded) setHealth(failure('unavailable'));
    else if (pending.size > 0) return;
    else setHealth({ status: 'ok' });
  }

  function revokeAll(): void {
    const revoke = urlApi().revokeObjectURL;
    for (const url of createdUrls) {
      try {
        revoke?.(url);
      } catch {
        // Already revoked.
      }
    }
    createdUrls.clear();
    urls.clear();
  }

  // Listed from the start (checks and the package read metadata synchronously); stored records win on load.
  plant();

  async function open(): Promise<void> {
    try {
      if (options.reset) await backend.clear();
      const stored = await backend.load();
      for (const record of stored) records.set(record.id, { ...record, asset: deepFreeze(structuredClone(record.asset)) });
    } catch {
      // Storage refused (private mode, blocked site data): keep working in memory, say so on write.
      degraded = backend.scope === 'local';
      backend.close();
      backend = memoryBackend();
    }
    plant();
    if (records.size > 0) emit({ kind: 'loaded', assetIds: [...records.keys()], productionIds: [...new Set([...records.values()].map((record) => record.productionId))] });
  }

  const opened = open();

  async function persist(record: StoredAsset, blob?: Blob): Promise<SaveErrorCode | undefined> {
    try {
      await backend.write(record, blob);
      return undefined;
    } catch (error) {
      return storageErrorCode(error);
    }
  }

  function remember(record: StoredAsset): ImageAsset {
    const frozen = deepFreeze(structuredClone(record.asset));
    records.set(record.id, { ...record, asset: frozen });
    return frozen;
  }

  async function readHeader(file: Blob): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    } catch {
      return undefined;
    }
  }

  function baseAsset(meta: AssetMeta, origin: ImageAsset['origin']): ImageAsset {
    const rights: AssetRights = { authorized: meta.authorized };
    const note = meta.note?.trim();
    if (note) rights.note = note;
    const asset: ImageAsset = {
      id: ids.next('img'),
      workspaceId: options.workspaceId,
      kind: 'image',
      origin,
      rights,
      createdAt: clock.now(),
      createdBy: options.actorId(),
    };
    const credit = normalizeCredit(meta.credit);
    if (credit) asset.credit = credit;
    return asset;
  }

  function storedOf(asset: ImageAsset, meta: AssetMeta): StoredAsset {
    return { id: asset.id, productionId: meta.productionId, asset };
  }

  async function putFile(file: Blob, fileName: string, meta: AssetMeta): Promise<Result<ImageAsset, AssetRefusal>> {
    const checked = validateImageFile({ name: fileName, type: file.type, size: file.size });
    if (!checked.ok) return checked;
    const header = await readHeader(file);
    if (!header) return refuse('unreadable', 'Não foi possível ler o arquivo. Tente de novo.');
    const sniffed = sniffImage(header);
    if (!sniffed) return refuse('unsupported_type', 'O arquivo não é uma imagem JPG, PNG, WebP ou GIF.');
    const size = sniffed.width && sniffed.height ? { width: sniffed.width, height: sniffed.height } : await measure(file);
    const asset = baseAsset(meta, { type: 'upload', fileName: fileName.trim() || 'imagem' });
    asset.mime = sniffed.mime;
    asset.bytes = file.size;
    if (size) {
      asset.width = size.width;
      asset.height = size.height;
    }
    // Stored with the type read from the bytes, so the object URL serves the right image type.
    const bytes = file.type === sniffed.mime ? file : file.slice(0, file.size, sniffed.mime);
    const record = storedOf(asset, meta);
    const failed = await persist(record, bytes);
    if (failed) {
      setHealth(failure(failed));
      return refuse(failed === 'quota' ? 'quota' : 'unavailable', PUT_REFUSALS[failed]);
    }
    const value = remember(record);
    settleHealth();
    emit({ kind: 'put', assetIds: [value.id], productionIds: [meta.productionId] });
    return ok(value);
  }

  async function putUrl(input: Extract<AssetInput, { type: 'url' }>, meta: AssetMeta): Promise<Result<ImageAsset, AssetRefusal>> {
    const checked = validateImageUrl(input.url);
    if (!checked.ok) return refuse(checked.refusal.code === 'empty' ? 'empty' : 'invalid_url', checked.refusal.message);
    const asset = baseAsset(meta, { type: 'url', url: checked.value });
    // The size the browser measured while previewing the address (the bytes never come here).
    const measured = [input.width, input.height].every((side) => side !== undefined && Number.isInteger(side) && side > 0);
    if (measured) {
      asset.width = input.width;
      asset.height = input.height;
    }
    const record = storedOf(asset, meta);
    const failed = await persist(record);
    if (failed) {
      setHealth(failure(failed));
      return refuse(failed === 'quota' ? 'quota' : 'unavailable', PUT_REFUSALS[failed]);
    }
    const value = remember(record);
    settleHealth();
    emit({ kind: 'put', assetIds: [value.id], productionIds: [meta.productionId] });
    return ok(value);
  }

  /** Stored images outside `referenced`, oldest first, with the bytes they hold. */
  function unusedOf(referenced: ReadonlySet<AssetId>): UnusedAssets {
    // The example's images take no room in this browser: "Liberar espaço" never lists them.
    const unused = [...records.values()]
      .filter((record) => !referenced.has(record.id) && !seeds.has(record.id))
      .sort((a, b) => a.asset.createdAt.localeCompare(b.asset.createdAt) || a.id.localeCompare(b.id));
    return {
      assetIds: unused.map((record) => record.id),
      count: unused.length,
      bytes: unused.reduce((total, record) => total + (record.asset.origin.type === 'url' ? 0 : (record.asset.bytes ?? 0)), 0),
    };
  }

  const store: AssetStore = {
    limits: ASSET_LIMITS,
    get scope() {
      return degraded ? 'memory' : options.backend.scope;
    },
    ready: () => opened,
    async put(input: AssetInput, meta: AssetMeta) {
      await opened;
      switch (input.type) {
        case 'upload':
          return putFile(input.file, input.fileName, meta);
        case 'url':
          return putUrl(input, meta);
      }
    },
    get: (assetId) => records.get(assetId)?.asset,
    async update(assetId: AssetId, patch: AssetPatch) {
      await opened;
      const current = records.get(assetId);
      if (!current) return refuse('not_found', 'Imagem não encontrada.');
      const asset: ImageAsset = structuredClone(current.asset);
      if ('credit' in patch) {
        const credit = normalizeCredit(patch.credit);
        if (credit) asset.credit = credit;
        else delete asset.credit;
      }
      if (patch.rights) {
        asset.rights = { authorized: patch.rights.authorized };
        const note = patch.rights.note?.trim();
        if (note) asset.rights.note = note;
      }
      const record: StoredAsset = { ...current, asset };
      const value = remember(record);
      const failed = await persist(record);
      if (failed) {
        pending.add(assetId);
        setHealth(failure(failed));
      } else {
        pending.delete(assetId);
        settleHealth();
      }
      emit({ kind: 'update', assetIds: [assetId], productionIds: [current.productionId] });
      return ok(value);
    },
    list(productionId: ProductionId) {
      return [...records.values()]
        .filter((record) => record.productionId === productionId)
        .map((record) => record.asset)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    },
    async objectUrl(assetId) {
      await opened;
      const record = records.get(assetId);
      if (!record) return undefined;
      if (record.asset.origin.type === 'url') return record.asset.origin.url;
      // An example image is served by the app itself: its address (absolute in a page) is the URL.
      const seeded = seeds.get(assetId);
      if (seeded) return servedUrl(seeded.src);
      const cached = urls.get(assetId);
      if (cached) return cached;
      const created = (async () => {
        const blob = await backend.readBlob(assetId).catch(() => undefined);
        if (!blob || disposed) return undefined;
        const create = urlApi().createObjectURL;
        if (create) {
          const url = create(blob);
          createdUrls.add(url);
          return url;
        }
        return dataUrl(blob.type || record.asset.mime || 'application/octet-stream', new Uint8Array(await blob.arrayBuffer()));
      })();
      urls.set(assetId, created);
      // A failed read is retried on the next call.
      void created.then((url) => {
        if (!url && urls.get(assetId) === created) urls.delete(assetId);
      });
      return created;
    },
    async blob(assetId) {
      await opened;
      const record = records.get(assetId);
      if (!record || record.asset.origin.type === 'url') return undefined;
      if (seeds.has(assetId)) return seedBlob(assetId);
      return backend.readBlob(assetId).catch(() => undefined);
    },
    health: () => health,
    async retry() {
      await opened;
      for (const assetId of [...pending]) {
        const record = records.get(assetId);
        if (!record) {
          pending.delete(assetId);
          continue;
        }
        const failed = await persist(record);
        if (failed) {
          setHealth(failure(failed));
          return health;
        }
        pending.delete(assetId);
      }
      settleHealth();
      return health;
    },
    unused(referenced) {
      return unusedOf(referenced);
    },
    async collect(referenced) {
      await opened;
      const unused = unusedOf(referenced);
      if (unused.count === 0) return ok(unused);
      try {
        await backend.remove(unused.assetIds);
      } catch (error) {
        const code = storageErrorCode(error);
        return refuse(code === 'quota' ? 'quota' : 'unavailable', COLLECT_REFUSALS[code]);
      }
      const productionIds = new Set<ProductionId>();
      const revoke = urlApi().revokeObjectURL;
      for (const assetId of unused.assetIds) {
        const record = records.get(assetId);
        if (record) productionIds.add(record.productionId);
        records.delete(assetId);
        pending.delete(assetId);
        const url = urls.get(assetId);
        urls.delete(assetId);
        void url?.then((value) => {
          if (!value || !createdUrls.has(value)) return;
          createdUrls.delete(value);
          try {
            revoke?.(value);
          } catch {
            // Already revoked.
          }
        });
      }
      settleHealth();
      emit({ kind: 'collect', assetIds: unused.assetIds, productionIds: [...productionIds] });
      return ok(unused);
    },
    async reset() {
      await opened;
      revokeAll();
      records.clear();
      pending.clear();
      try {
        await backend.clear();
      } catch {
        // Memory is cleared regardless; the next write reports a storage problem if any.
      }
      // The example's own images come back with it.
      plant();
      settleHealth();
      emit({ kind: 'reset', assetIds: [], productionIds: [] });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      revokeAll();
      listeners.clear();
      backend.close();
    },
  };
  return store;
}
