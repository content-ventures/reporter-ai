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

export type CoverLoader = ((assetId: AssetId) => Promise<Result<CoverImage, CoverRefusal>>) & {dispose?:()=>void};

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

/** `fetch` of an address the app serves; undefined without `fetch` (Node) or on any failure. */
async function fetchServed(src: string): Promise<Blob | undefined> {
  const run = (globalThis as { fetch?: (input: string) => Promise<{ ok: boolean; blob(): Promise<Blob> }> }).fetch;
  if (!run) return undefined;
  try {
    const response = await run(src);
    return response.ok ? await response.blob() : undefined;
  } catch {
    return undefined;
  }
}

function imageCache(){
  const entries=new Map<string,Promise<Result<CoverImage,CoverRefusal>>>();let disposed=false;
  const close=(result:Result<CoverImage,CoverRefusal>)=>{if(result.ok)(result.value.source as {close?:()=>void})?.close?.();};
  return{read(key:string,read:()=>Promise<Result<CoverImage,CoverRefusal>>){
    if(disposed)return Promise.resolve(refuse('unreadable' as const,COVER_REASONS.unreadable));
    const cached=entries.get(key);if(cached)return cached;
    const pending=read().then(result=>{if(disposed){close(result);return refuse('unreadable' as const,COVER_REASONS.unreadable);}if(!result.ok&&result.refusal.code!=='external')entries.delete(key);return result;});
    entries.set(key,pending);return pending;
  },dispose(){if(disposed)return;disposed=true;for(const pending of entries.values())void pending.then(close);entries.clear();}};
}

/** A served image, decoded once within its owner and explicitly released on context disposal. */
export function servedCoverLoader(
  src:string,
  {fetchBlob=fetchServed,decode=decodeBitmap}:{fetchBlob?:(src:string)=>Promise<Blob|undefined>;decode?:Decode}={},
):(()=>Promise<Result<CoverImage,CoverRefusal>>)&{dispose:()=>void}{
  const cache=imageCache();
  return Object.assign(()=>cache.read(src,async()=>{const blob=await fetchBlob(src);if(!blob)return refuse('missing',COVER_REASONS.missing);const image=await decode(blob);return image?ok(image):refuse('unreadable',COVER_REASONS.unreadable);}),{dispose:cache.dispose});
}
/** One decoded image per immutable asset, released with the runtime. */
export function assetCoverLoader(assets:Pick<AssetStore,'get'|'blob'|'ready'>,decode:Decode=decodeBitmap):CoverLoader{
  const cache=imageCache();
  return Object.assign((assetId:AssetId)=>cache.read(assetId,async()=>{
    await assets.ready();const asset=assets.get(assetId);if(!asset)return refuse('missing',COVER_REASONS.missing);
    if(asset.origin.type==='url')return refuse('external',COVER_REASONS.external);
    const blob=await assets.blob(assetId);if(!blob)return refuse('missing',COVER_REASONS.missing);
    const image=await decode(blob,{width:asset.width,height:asset.height});return image?ok(image):refuse('unreadable',COVER_REASONS.unreadable);
  }),{dispose:cache.dispose});
}
