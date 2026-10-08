import type { AssetId } from '../../../domain/ids.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import type { AssetStore } from '../../../ports/assets.ts';
import type { CoverImage } from './canvas.ts';

/**
 * Decodes the article cover for the slide renderer. Only stored bytes can be drawn: a linked
 * image would taint the canvas (the browser blocks reading other sites' pixels), so the slide
 * keeps its colours and says why.
 */

export type CoverRefusal = 'missing' | 'external' | 'unreadable';

export type CoverLoader = (assetId: AssetId) => Promise<Result<CoverImage, CoverRefusal>>;

type Decode = (blob: Blob, size?: { width?: number; height?: number }) => Promise<CoverImage | undefined>;

type BitmapOptions = { resizeWidth?: number; resizeHeight?: number; resizeQuality?: 'low' | 'medium' | 'high' };
type CreateImageBitmap = (blob: Blob, options?: BitmapOptions) => Promise<{ width: number; height: number }>;

/** Longest side kept in memory: twice the slide width is sharp at every export scale. */
export const COVER_MAX_SIDE = 2160;

/**
 * `createImageBitmap` (browser, no DOM), scaled down to `COVER_MAX_SIDE` when the asset says it
 * is larger (a 12 MP photo would otherwise hold ~48 MB decoded); undefined where it fails.
 */
export async function decodeBitmap(blob: Blob, size: { width?: number; height?: number } = {}): Promise<CoverImage | undefined> {
  const create = (globalThis as { createImageBitmap?: CreateImageBitmap }).createImageBitmap;
  if (!create) return undefined;
  const { width = 0, height = 0 } = size;
  const options: BitmapOptions | undefined =
    Math.max(width, height) > COVER_MAX_SIDE
      ? width >= height
        ? { resizeWidth: COVER_MAX_SIDE, resizeQuality: 'high' }
        : { resizeHeight: COVER_MAX_SIDE, resizeQuality: 'high' }
      : undefined;
  try {
    const bitmap = await (options ? create(blob, options) : create(blob));
    return { source: bitmap, width: bitmap.width, height: bitmap.height };
  } catch {
    return undefined;
  }
}

export const COVER_REASONS: Record<CoverRefusal, string> = {
  missing: 'Imagem de destaque não encontrada neste navegador.',
  external: 'Imagem de destaque por link: o slide usa as cores do modelo.',
  unreadable: 'Não foi possível desenhar a imagem de destaque neste navegador.',
};

/** One decoded image per asset (bytes never change); failures are retried on the next render. */
export function assetCoverLoader(assets: Pick<AssetStore, 'get' | 'blob' | 'ready'>, decode: Decode = decodeBitmap): CoverLoader {
  const decoded = new Map<AssetId, Promise<Result<CoverImage, CoverRefusal>>>();
  const load = async (assetId: AssetId): Promise<Result<CoverImage, CoverRefusal>> => {
    await assets.ready();
    const asset = assets.get(assetId);
    if (!asset) return refuse('missing', COVER_REASONS.missing);
    if (asset.origin.type === 'url') return refuse('external', COVER_REASONS.external);
    const blob = await assets.blob(assetId);
    if (!blob) return refuse('missing', COVER_REASONS.missing);
    const image = await decode(blob, { width: asset.width, height: asset.height });
    return image ? ok(image) : refuse('unreadable', COVER_REASONS.unreadable);
  };
  return (assetId) => {
    const cached = decoded.get(assetId);
    if (cached) return cached;
    const pending = load(assetId);
    decoded.set(assetId, pending);
    void pending.then((result) => {
      if (!result.ok && result.refusal.code !== 'external') decoded.delete(assetId);
    });
    return pending;
  };
}
