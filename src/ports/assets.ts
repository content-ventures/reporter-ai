import type { AssetRights, ImageAsset } from '../domain/asset.ts';
import type { AssetId, ProductionId } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';
import type { Unsubscribe } from './common.ts';
import type { SaveErrorCode } from './save-status.ts';

/**
 * Image store of the articles (cover and figures). Bytes are Blobs (IndexedDB in the browser;
 * localStorage's ~5 MB would overflow with two photos), metadata is read synchronously so checks,
 * diffs and the export resolve credit and rights without waiting. R2 "Acervo" (F2.9) and R6
 * "Gerar com IA" (F6.10) add assets with their own origin through the same `put`.
 */

/**
 * What a picker tab hands the store, by origin (mirrors `AssetOrigin`): "Enviar arquivo" (a Blob
 * from the Dropzone) or "Link" (an http/https address, with the size the browser measured while
 * previewing it). R2 "Acervo" and R6 "Gerar com IA" add their own variant here.
 */
export type AssetInput =
  | { type: 'upload'; file: Blob; fileName: string }
  | { type: 'url'; url: string; width?: number; height?: number };

export type AssetMeta = {
  productionId: ProductionId;
  /** "Uso autorizado". */
  authorized: boolean;
  credit?: string;
  /** Rights note ("uso só no site"). */
  note?: string;
};

/** A `credit` key that is blank (or `undefined`) removes the credit; absent keys stay as they are. */
export type AssetPatch = { credit?: string; rights?: AssetRights };

export type AssetRefusal =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'invalid_url'
  | 'unreadable'
  | 'not_found'
  /** The browser storage is full. */
  | 'quota'
  /** The browser refused storage (private mode, blocked site data). */
  | 'unavailable';

export type AssetChange = {
  /** `loaded`: the stored index finished opening; `health`: persistence failed or recovered; `collect`: unused images deleted. */
  kind: 'put' | 'update' | 'loaded' | 'reset' | 'health' | 'collect';
  assetIds: AssetId[];
  /** Productions whose images changed (empty for workspace-wide changes). */
  productionIds: ProductionId[];
};

/** Persistence of the store, merged into the studio's save status by the runtime. */
export type AssetHealth =
  | { status: 'ok' }
  | { status: 'error'; code: SaveErrorCode; message: string };

export type AssetLimits = {
  maxBytes: number;
  mimeTypes: readonly string[];
  /** For the Dropzone `accept`. */
  accept: string;
  /** pt-BR hint under the Dropzone ("JPG, PNG, WebP ou GIF, até 10 MB."). */
  hint: string;
};

/** Images no draft or version uses (see `AssetStore.unused`). */
export type UnusedAssets = { assetIds: AssetId[]; count: number; bytes: number };

export interface AssetStore {
  readonly limits: AssetLimits;
  /** Where the bytes live: `local` (IndexedDB) or `memory` (tests, storage refused). */
  readonly scope: 'local' | 'memory';
  /** Resolves once the stored index is readable (`get`/`list` answer from memory afterwards). */
  ready(): Promise<void>;
  /** Stores an uploaded file (validated: type, ≤ 10 MB, dimensions read when possible) or a link. */
  put(input: AssetInput, meta: AssetMeta): Promise<Result<ImageAsset, AssetRefusal>>;
  get(assetId: AssetId): ImageAsset | undefined;
  /** Credit and rights only: the bytes of an asset never change. */
  update(assetId: AssetId, patch: AssetPatch): Promise<Result<ImageAsset, AssetRefusal>>;
  /** Images added to a production, newest first. */
  list(productionId: ProductionId): ImageAsset[];
  /**
   * URL to show the image: a `blob:` URL created once per asset and revoked on `dispose`, or the
   * address of a linked image. Undefined when the asset (or its bytes) is not in this store.
   */
  objectUrl(assetId: AssetId): Promise<string | undefined>;
  /** The stored bytes (uploads); undefined for links and unknown ids. */
  blob(assetId: AssetId): Promise<Blob | undefined>;
  health(): AssetHealth;
  /** Writes again what failed to persist; resolves with the new health. */
  retry(): Promise<AssetHealth>;
  /** Drops every asset (`?reset=1`, "Restaurar exemplo", "Começar vazio"). */
  reset(): Promise<void>;
  /**
   * Stored images outside `referenced` (every asset id a draft or a version of any production
   * uses), with the bytes they take: what "Liberar espaço" would delete.
   */
  unused(referenced: ReadonlySet<AssetId>): UnusedAssets;
  /** Deletes the images outside `referenced` and their bytes; resolves with what was freed. */
  collect(referenced: ReadonlySet<AssetId>): Promise<Result<UnusedAssets, AssetRefusal>>;
  subscribe(listener: (change: AssetChange) => void): Unsubscribe;
  /** Revokes object URLs and closes storage; the store must not be used afterwards. */
  dispose(): void;
}
