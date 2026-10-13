import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ArticleBody, ImageSlot } from '../domain/article.ts';
import { foldForMatch } from '../domain/text/normalize.ts';
import type { LibraryImage, StockImage } from '../domain/visual-library.ts';
import { isCoverResolution, libraryImageNote, publicationImageCredit } from '../domain/visual-library.ts';
import type { ServerImageAsset } from '../ports/connected-workspace.ts';
import { localContext } from './config';
import { importStockImage } from './visual-library';
import { searchStock } from './stock-images';
import { safeCode } from './errors';

/** Only generic public subject keywords leave the application, never names or podcast text. */
export function editorialImageQuery(subject: string): string | undefined {
  const text = foldForMatch(subject);
  const matches: [RegExp,string][] = [
    [/aquicultur|piscicultur|criacao de peixe/,'aquaculture'],[/camarao|carcinicultur/,'shrimp'],
    [/salmao/,'salmon'],[/atum/,'tuna'],[/processamento|beneficiamento|industria|fabrica|maquin/,'fish processing'],
    [/mercado|varejo|peixaria|comercio/,'fish market'],[/pesca|embarcacao|pescador/,'fishing'],
    [/peixe|pescado|frutos do mar|seafood/,'seafood'],
  ];
  const query = matches.find(([pattern]) => pattern.test(text))?.[1];
  return ['fish processing','fish market'].includes(query ?? '') && !/peixe|pescado|frutos do mar|seafood|fish/.test(text) ? undefined : query;
}
export const IMAGE_LOOKUP_MESSAGES: Record<string,string> = {
  PIXABAY_ORIGINAL_REQUIRED: 'O Pixabay precisa liberar os originais em alta resolução. A prévia de 1.280 px não foi importada.',
  PIXABAY_KEY_MISSING: 'Configure a chave do Pixabay para preencher as imagens automaticamente.',
  NO_RELEVANT_IMAGE: 'Nenhuma foto pertinente em alta resolução foi encontrada. O texto está preservado.',
  STOCK_UNAVAILABLE: 'O banco de imagens não respondeu. O texto está preservado; tente a busca novamente.',
};
type Dependencies = {
  search(query: string,signal: AbortSignal): Promise<StockImage[]>;
  importImage(image: StockImage,signal: AbortSignal): Promise<LibraryImage>;
};
const defaults: Dependencies = {
  async search(query,signal) {
    const fetcher: typeof fetch = (url,init) => fetch(url,{ ...init,signal: AbortSignal.any([signal,...(init?.signal ? [init.signal] : [])]) });
    try { return (await searchStock('pixabay',query,1,fetcher,false)).images; }
    catch (error) {
      if (safeCode(error) !== 'STOCK_RATE_LIMIT') throw error;
      await new Promise<void>((resolve,reject) => {
        const abort = () => { clearTimeout(timer);reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort',abort);resolve(); },1100);
        signal.addEventListener('abort',abort,{ once: true });if (signal.aborted) abort();
      });
      return (await searchStock('pixabay',query,1,fetcher,false)).images;
    }
  },
  importImage: (image,signal) => importStockImage('pixabay',image.providerId,signal),
};
/** At most three planned images. No invented URLs, low-resolution upscale or legacy fallback. */
export async function illustrateArticle(body: ArticleBody,productionId: string,signal: AbortSignal,dependencies: Dependencies = defaults) {
  const result = structuredClone(body), assets: ServerImageAsset[] = [], used = new Set<string>(), queries = new Map<string,StockImage[]>();
  const codes: string[] = [];
  const fill = async (slot: ImageSlot) => {
    signal.throwIfAborted();
    let code = 'NO_RELEVANT_IMAGE';
    try {
      const query = editorialImageQuery(slot.subject);
      if (query) {
        let photos = queries.get(query);
        if (!photos) { photos = await dependencies.search(query,signal);queries.set(query,photos); }
        const candidates = photos.filter(image => image.provider === 'pixabay' && isCoverResolution(image) && !image.downloadLimited && !used.has(image.providerId));
        if (photos.some(image => image.downloadLimited) && !candidates.length) code = 'PIXABAY_ORIGINAL_REQUIRED';
        for (const photo of candidates.slice(0,2)) {
          try {
            const image = await dependencies.importImage(photo,signal);
            signal.throwIfAborted();
            if (!isCoverResolution(image) || image.provider !== 'pixabay' || image.downloadLimited) continue;
            used.add(image.providerId);
            const assetId = randomUUID();
            assets.push({ productionId,asset: { id: assetId,workspaceId: localContext.portal,kind: 'image',origin: { type: 'archive',archiveId: image.id },
              mime: 'image/jpeg',width: image.width,height: image.height,bytes: image.bytes,credit: publicationImageCredit(image),
              rights: { authorized: true,note: libraryImageNote(image) },createdAt: new Date().toISOString(),createdBy: localContext.actor,
              provenance: { ...image,libraryId: image.id } } });
            return { image: { assetId,alt: image.title,caption: `Imagem ilustrativa: ${image.title}.` } };
          } catch (error) { if (signal.aborted) throw error;code = safeCode(error); }
        }
      }
    } catch (error) { if (signal.aborted) throw error;code = safeCode(error); }
    codes.push(code);
    return { slot: { ...slot,availability: { code,message: IMAGE_LOOKUP_MESSAGES[code] ?? IMAGE_LOOKUP_MESSAGES.STOCK_UNAVAILABLE } } };
  };
  if (result.coverSlot && !result.cover) {
    const cover = await fill(result.coverSlot);
    if (cover.image) { result.cover = cover.image;delete result.coverSlot; } else result.coverSlot = cover.slot;
  }
  let count = 0;
  for (const [index,block] of result.blocks.entries()) {
    if (block.type !== 'figure' || !block.slot || count++ >= 2) continue;
    const resolved = await fill(block.slot);
    result.blocks[index] = resolved.image ? { ...block,slot: undefined,image: resolved.image } : { ...block,slot: resolved.slot };
  }
  return { body: result,assets,filled: assets.length,codes: [...new Set(codes)] };
}
