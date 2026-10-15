import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { BannerContent, BannerDraft, LibraryImage, StockImage } from '../domain/visual-library';
import { bannerContentKey, initialBanner, isCoverResolution } from '../domain/visual-library';
import { blockText } from '../domain/article';
import { directQuotes, literalQuoteText, r1ArticleQuotationIssue } from '../domain/article-policy';
import { editorialTransaction } from './editorial';
import type { EditorialScope } from './editorial-store';
import { stockProviders, searchStock, stockDetails, downloadStock, trackStockSelection } from './stock-images';
import { bannerSchema, renderBanner } from './banner-render';
import { readImageFile, writeImageFile } from './image-storage.ts';
import { prepareAssetUpload,completeAssetUpload,importLinkedAsset,uploadedAssetFile } from './image-assets.ts';
import { FlowError } from './errors';
import { hasAnyRole } from '../domain/workspace';
import { contentHash } from '../domain/text/hash';
import { isRunActive } from '../domain/run';
import { pendingReview } from '../domain/record';
import { illustrateArticle } from './article-illustration';

const UUID = z.string().uuid(), provider = z.enum(['openverse','pexels','unsplash','pixabay']);
async function imageBytes(image: LibraryImage): Promise<Buffer> {
  if (!/^[a-f0-9]{64}\.photo\.jpg$/.test(image.fileKey)) throw new FlowError('UNSAFE_STORAGE',500);
  const bytes = await readImageFile(image.fileKey);
  if (createHash('sha256').update(bytes).digest('hex') !== image.fileKey.slice(0,64)) throw new FlowError('IMAGE_UNAVAILABLE',422);
  return bytes;
}
// The library is workspace-wide and independent of productions; none are read.
const LIBRARY_SCOPE: EditorialScope = { pipelines: false,items: { library_image: 'all',banner: 'all' } };
const libraryRole = () => process.env.REPORTER_FUNCTION_RUNTIME === 'true' ? 'worker' : 'runtime';
export async function visualLibrary() {
  return (await editorialTransaction(libraryRole(),async checkpoint => ({
    images: checkpoint.visuals?.images ?? [],banners: checkpoint.visuals?.banners ?? [],providers: stockProviders(),
  }),false,'reporter.edit',LIBRARY_SCOPE)).value;
}
async function importImage(value: unknown) {
  const input = z.object({ provider,id: z.string().min(1).max(64),confirmed: z.literal(true) }).strict().parse(value);
  return importStockImage(input.provider,input.id);
}
/** Bounded, user-initiated selection. The worker uses only Pixabay, never a legacy fallback. */
export async function importStockImage(selectedProvider: StockImage['provider'],id: string,signal?: AbortSignal) {
  const fetcher: typeof fetch = (url,init) => fetch(url,{ ...init,
    ...(signal ? { signal: AbortSignal.any([signal,...(init?.signal ? [init.signal] : [])]) } : {}) });
  signal?.throwIfAborted();
  const input = { provider: selectedProvider,id };
  const existing = (await visualLibrary()).images.find(image => image.provider === input.provider && image.providerId === input.id);
  if (existing) { await trackStockSelection(existing,fetcher);return existing; }
  const details = await stockDetails(input.provider,input.id,fetcher),original = await downloadStock(details,fetcher);
  const { bytes,width,height } = await normalizeLibraryPhoto(details,original);
  await trackStockSelection(details,fetcher);
  signal?.throwIfAborted();
  const hash = createHash('sha256').update(bytes).digest('hex'),fileKey = hash+'.photo.jpg';
  await writeImageFile(fileKey,bytes);
  return (await editorialTransaction(libraryRole(),async checkpoint => {
    signal?.throwIfAborted();
    const library = checkpoint.visuals ??= { images: [],banners: [] };
    const duplicate = library.images.find(image => image.provider === input.provider && image.providerId === input.id);
    if (duplicate) return duplicate;
    if (library.images.length >= 1000) throw new FlowError('LIBRARY_FULL',422);
    const image: LibraryImage = { ...details,id: crypto.randomUUID(),fileKey,bytes: bytes.length,width,height,
      createdAt: new Date().toISOString(),authorized: true };
    library.images.unshift(image); return image;
  },true,'reporter.edit',{ pipelines: false,items: { library_image: 'all' } })).value;
}
/** Validate real decoded pixels, not only dimensions declared by a provider. No storage writes. */
export async function normalizeLibraryPhoto(details: StockImage,original: Buffer) {
  let bytes: Buffer,width: number,height: number;
  try {
    const result = await sharp(original,{ limitInputPixels: 40000000,animated: false }).rotate().resize(3840,3840,{ fit: 'inside',withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    bytes = result.data;width = result.info.width;height = result.info.height;
  } catch { throw new FlowError('STOCK_INVALID',422); }
  if (details.provider === 'pixabay' && !isCoverResolution({ width,height })) throw new FlowError('PIXABAY_ORIGINAL_REQUIRED',422);
  if (bytes.length > 10*1024**2) throw new FlowError('IMAGE_TOO_LARGE',422);
  return { bytes,width,height };
}
async function bannerPhoto(content: BannerContent) {
  if (!content.imageId) return undefined;
  const image = (await visualLibrary()).images.find(item => item.id === content.imageId);
  if (!image) throw new FlowError('IMAGE_UNAVAILABLE',422);
  return { bytes: await imageBytes(image),attribution: image.attribution,licenseUrl: image.licenseUrl,sourceUrl: image.sourceUrl,creditRequired: image.provider !== 'pixabay' };
}
async function articleSeed(productionId: string) {
  const id = UUID.parse(productionId);
  return (await editorialTransaction('runtime',async (_checkpoint,engine) => {
    const record = engine.records.record(id);
    if (!record) throw new FlowError('NOT_FOUND',404);
    const body = record.pieces.find(piece => piece.kind === 'article')?.draft.body;
    if (body?.type !== 'article') throw new FlowError('NOT_FOUND',404);
    const quotes = r1ArticleQuotationIssue(body,record.sources) ? [] : body.blocks.flatMap(block => directQuotes(blockText(block))).filter(quote => quote.length <= 200);
    return { content: { ...initialBanner(),template: 'editorial' as const,title: body.title,productionId },quotes,
      sourceState: 'Rascunho do artigo; banner ainda precisa de revisão editorial.' };
  },false,'reporter.edit',{ productions: [id],parts: ['piece'],runs: 'none',pipelines: false })).value;
}
async function validateBannerSource(content: BannerContent) {
  if (content.productionId) {
    const seed = await articleSeed(content.productionId);
    if (content.template === 'quote' && !seed.quotes.some(quote => literalQuoteText(quote) === literalQuoteText(content.quote ?? ''))) throw new FlowError('BANNER_QUOTE_UNSUPPORTED',422);
  } else if (content.template === 'quote') throw new FlowError('BANNER_QUOTE_UNSUPPORTED',422);
}
async function saveBanner(value: unknown) {
  const input = z.object({ id: UUID,revision: z.number().int().nonnegative(),content: bannerSchema }).strict().parse(value);
  await validateBannerSource(input.content);
  // Validate rendering before saving; a rejected layout cannot become an exportable draft.
  await renderBanner(input.content,await bannerPhoto(input.content));
  return (await editorialTransaction('runtime',async checkpoint => {
    const library = checkpoint.visuals ??= { images: [],banners: [] },previous = library.banners.find(banner => banner.id === input.id);
    const same = previous && bannerContentKey(previous.content) === bannerContentKey(input.content);
    if (same && previous.revision === input.revision+1) return previous; // network retry of the exact write
    if ((previous?.revision ?? 0) !== input.revision) throw new FlowError('BANNER_CONFLICT',409);
    if (!previous && library.banners.length >= 500) throw new FlowError('LIBRARY_FULL',422);
    const next: BannerDraft = { id: input.id,revision: input.revision+1,content: input.content,updatedAt: new Date().toISOString() };
    library.banners = [next,...library.banners.filter(banner => banner.id !== input.id)]; return next;
  },true,'reporter.edit',{ pipelines: false,items: { banner: 'all' } })).value;
}
const json = (value: unknown) => Response.json(value,{ headers: { 'Cache-Control': 'no-store','X-Content-Type-Options': 'nosniff' } });
function file(bytes: Uint8Array | string,mime: string,name?: string) {
  let offset=0;
  const body=typeof bytes==='string'?bytes:new ReadableStream<Uint8Array>({pull(controller){
    if(offset>=bytes.length){controller.close();return;}
    const next=bytes.subarray(offset,offset+65536);offset+=next.length;controller.enqueue(new Uint8Array(next));
  }});
  return new Response(body,{ headers: {
    'Content-Type': mime,'Cache-Control': 'no-store','X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src data:; sandbox",
    ...(name ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}),
  } });
}
export async function handleVisualLibrary(request: Request,path: string[],readJson: (request: Request) => Promise<unknown>) {
  if (request.method === 'GET' && path.length === 3 && path[0] === 'assets' && path[2] === 'file') {
    const image=await uploadedAssetFile(UUID.parse(path[1]));return file(image.bytes,image.mime);
  }
  if (request.method === 'POST' && path.length === 2 && path[0] === 'assets') {
    const body = await readJson(request);
    if (path[1] === 'prepare') return json(await prepareAssetUpload(body));
    if (path[1] === 'complete') return json(await completeAssetUpload(body));
    if (path[1] === 'link') return json(await importLinkedAsset(body,request.signal));
  }
  if (request.method === 'GET') {
    if (!path.length) return json(await visualLibrary());
    if (path.length === 1 && path[0] === 'search') {
      const params = new URL(request.url).searchParams;
      const input = z.object({ provider,q: z.string().trim().min(2).max(100),page: z.coerce.number().int().min(1).max(21),curated: z.enum(['true','false']) }).parse({ provider: params.get('provider'),q: params.get('q'),page: params.get('page') ?? 1,curated: params.get('curated') ?? 'true' });
      return json(await searchStock(input.provider,input.q,input.page,undefined,input.curated === 'true'));
    }
    if (path.length === 2 && path[0] === 'article') return json(await articleSeed(path[1]));
    if (path.length === 3 && path[0] === 'images' && path[2] === 'file') {
      const image = (await visualLibrary()).images.find(item => item.id === UUID.parse(path[1]));
      if (!image) throw new FlowError('NOT_FOUND',404);
      if (image.provider === 'unsplash') return Response.redirect(image.imageUrl,302);
      return file(await imageBytes(image),'image/jpeg');
    }
    if (path.length === 3 && path[0] === 'banners' && ['png','svg','json'].includes(path[2])) {
      const library = await visualLibrary(),banner = library.banners.find(item => item.id === UUID.parse(path[1]));
      if (!banner) throw new FlowError('NOT_FOUND',404);
      const image = library.images.find(image => image.id === banner.content.imageId);
      if (path[2] === 'json') return file(JSON.stringify({ ...banner,image,review: 'draft',modified: 'Recorte e tratamento editorial' },null,2),'application/json',`banner-${banner.id}.json`);
      const rendered = await renderBanner(banner.content,await bannerPhoto(banner.content));
      return file(path[2] === 'svg' ? rendered.svg : rendered.png,path[2] === 'svg' ? 'image/svg+xml' : 'image/png',`banner-${banner.id}.${path[2]}`);
    }
  }
  if (request.method === 'POST' && path.length === 1) {
    const body = await readJson(request);
    if (path[0] === 'illustrate') {
      const input = z.object({ productionId: UUID,revision: z.number().int().nonnegative(),bodyHash: z.string().regex(/^[a-f0-9]{16}$/) }).strict().parse(body);
      const selected = (await editorialTransaction('runtime',async (checkpoint,engine) => {
        const member = checkpoint.state.members.find(member => member.personId === checkpoint.state.sessionPersonId);
        if (!hasAnyRole(member,['editor','admin'])) throw new FlowError('CITATION_FORBIDDEN',403);
        const record = engine.records.record(input.productionId),piece = record?.pieces.find(piece => piece.kind === 'article');
        if (!record || piece?.draft.body.type !== 'article') throw new FlowError('NOT_FOUND',404);
        if (record.sources.some(source => !source.rights.authorized)) throw new FlowError('SOURCE_NOT_AUTHORIZED',422);
        if (pendingReview(record,piece.id) || record.runs.some(isRunActive)) throw new FlowError('ARTICLE_LOCKED',409);
        if (piece.draft.revision !== input.revision || contentHash(piece.draft.body) !== input.bodyHash) throw new FlowError('IMAGE_DRAFT_CONFLICT',409);
        return { pieceId: piece.id,body: piece.draft.body };
      },false,'reporter.edit',{ productions: [input.productionId],runs: 'none',pipelines: false })).value;
      const resolved = await illustrateArticle(selected.body,input.productionId,AbortSignal.any([request.signal,AbortSignal.timeout(60000)]));
      return json((await editorialTransaction('runtime',async (checkpoint,engine) => {
        const member = checkpoint.state.members.find(member => member.personId === checkpoint.state.sessionPersonId);
        if (!hasAnyRole(member,['editor','admin'])) throw new FlowError('CITATION_FORBIDDEN',403);
        const record = engine.records.record(input.productionId),piece = record?.pieces.find(piece => piece.id === selected.pieceId);
        if (piece?.draft.body.type !== 'article' || piece.draft.revision !== input.revision || contentHash(piece.draft.body) !== input.bodyHash
          || pendingReview(record!,piece.id) || record!.runs.some(isRunActive)) throw new FlowError('IMAGE_DRAFT_CONFLICT',409);
        const saved = await engine.commands.saveDraft(piece.id,resolved.body,input.revision);
        if (!saved.ok) throw new FlowError('IMAGE_DRAFT_CONFLICT',409);
        checkpoint.imageAssets = [...(checkpoint.imageAssets ?? []),...resolved.assets];
        return { filled: resolved.filled,codes: resolved.codes,revision: saved.value.revision };
      },true,'reporter.edit',{ productions: [input.productionId],parts: ['piece','review','decision','run'],sources: 'none',runs: 'none' })).value);
    }
    if (path[0] === 'assets') {
      const input = z.object({ id: UUID,patch: z.object({ credit: z.string().max(500).optional(),rights: z.object({ authorized: z.boolean(),note: z.string().max(2000).optional() }).strict().optional() }).strict() }).strict().parse(body);
      return json((await editorialTransaction('runtime',async checkpoint => {
        const member = checkpoint.state.members.find(member => member.personId === checkpoint.state.sessionPersonId);
        if (!hasAnyRole(member,['editor','admin'])) throw new FlowError('CITATION_FORBIDDEN',403);
        const entry = checkpoint.imageAssets?.find(entry => entry.asset.id === input.id);
        if (!entry) throw new FlowError('IMAGE_UNAVAILABLE',404);
        entry.asset = { ...entry.asset,...input.patch };return entry.asset;
      },true,'reporter.edit',{ pipelines: false,items: { image_asset: [input.id] } })).value);
    }
    if (path[0] === 'images') return json(await importImage(body));
    if (path[0] === 'banners') return json(await saveBanner(body));
    if (path[0] === 'preview') {
      const content = bannerSchema.parse(body); await validateBannerSource(content);
      return file((await renderBanner(content,await bannerPhoto(content))).png,'image/png');
    }
  }
  throw new FlowError('NOT_FOUND',404);
}
