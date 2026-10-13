import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { StockImage, StockProvider } from '../domain/visual-library';
import { isCoverResolution } from '../domain/visual-library';
import { FlowError } from './errors';

type Fetcher = typeof fetch;
const text = z.string().max(2000);
const safeUrl = z.string().url().max(3000);
const unsplashId = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/);
function trustedUrl(value: string, hosts: readonly string[]) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !hosts.includes(url.hostname)) throw new FlowError('STOCK_INVALID',502);
  return url.href;
}
/** Current Wikimedia standard 500px step; Openverse's thumbnail proxy can return 424. */
export function commonsPreview(value: string) {
  const url = new URL(trustedUrl(value,['upload.wikimedia.org']));
  const path = url.pathname.match(/^\/wikipedia\/commons\/([a-f0-9])\/([a-f0-9]{2})\/([^/]+\.(?:jpe?g|png|webp))$/i);
  if (!path || url.search || url.hash) throw new FlowError('STOCK_INVALID',502);
  return `https://thumb.wikimedia.org/wikipedia/commons/thumb/${path[1]}/${path[2]}/${path[3]}/500px-${path[3]}`;
}
export function normalizeOpenverse(value: unknown): StockImage {
  const image = z.object({ id: z.string().uuid(),title: text,creator: text.nullable(),foreign_landing_url: safeUrl,
    url: safeUrl,thumbnail: safeUrl,license: z.enum(['cc0','pdm','by']),license_version: z.string().max(16),
    license_url: safeUrl,source: z.literal('wikimedia'),mature: z.literal(false),
    width: z.number().positive().max(30000),height: z.number().positive().max(30000),filetype: z.enum(['jpg','jpeg','png','webp']) }).parse(value);
  const title = image.title.trim(), creator = image.creator?.trim() || 'Autoria não informada';
  if (!title || (image.license === 'by' && !image.creator?.trim())) throw new FlowError('STOCK_INVALID',502);
  const license = image.license === 'by' ? `CC BY ${image.license_version}` : image.license === 'cc0' ? 'CC0' : 'Domínio público';
  return { provider: 'openverse',providerId: image.id,title,creator,
    sourceUrl: trustedUrl(image.foreign_landing_url,['commons.wikimedia.org']),
    imageUrl: trustedUrl(image.url,['upload.wikimedia.org']),previewUrl: commonsPreview(image.url),
    licenseUrl: trustedUrl(image.license_url,['creativecommons.org']),license,
    width: image.width,height: image.height,attribution: `${title} — ${creator} / Wikimedia Commons · ${license}` };
}
export function normalizePexels(value: unknown): StockImage {
  const image = z.object({ id: z.number().int().positive(),width: z.number().positive().max(30000),height: z.number().positive().max(30000),
    url: safeUrl,photographer: text,alt: text,src: z.object({ original: safeUrl,large: safeUrl }) }).parse(value);
  if (!image.photographer.trim()) throw new FlowError('STOCK_INVALID',502);
  return { provider: 'pexels',providerId: String(image.id),title: image.alt || 'Fotografia de stock',creator: image.photographer,
    sourceUrl: trustedUrl(image.url,['www.pexels.com']),imageUrl: trustedUrl(image.src.original,['images.pexels.com']),
    previewUrl: trustedUrl(image.src.large,['images.pexels.com']),license: 'Pexels License',licenseUrl: 'https://www.pexels.com/license/',
    attribution: `${image.photographer} / Pexels`,width: image.width,height: image.height };
}
function unsplashReferral(value: string) {
  const url = new URL(trustedUrl(value,['unsplash.com']));
  url.search = '';url.hash = '';
  url.searchParams.set('utm_source','reporter_ai');url.searchParams.set('utm_medium','referral');return url.href;
}
/** Preserve the API's view identifier when resizing; never proxy an unchanged photo preview. */
export function unsplashImageUrl(value: string,width: number) {
  const original = new URL(trustedUrl(value,['images.unsplash.com']));
  if (!/^\/photo-[A-Za-z0-9_.-]+$/.test(original.pathname) || !original.searchParams.get('ixid')) throw new FlowError('STOCK_INVALID',502);
  const url = new URL(original.origin+original.pathname);
  for (const key of ['ixid','ixlib']) { const item = original.searchParams.get(key);if (item) url.searchParams.set(key,item); }
  url.searchParams.set('w',String(Math.min(3840,Math.max(1,Math.round(width)))));
  url.searchParams.set('fm','jpg');url.searchParams.set('fit','max');url.searchParams.set('q','90');return url.href;
}
export function normalizeUnsplash(value: unknown): StockImage {
  const image = z.object({ id: unsplashId,width: z.number().int().positive().max(30000),height: z.number().int().positive().max(30000),
    description: text.nullable(),alt_description: text.nullable(),premium: z.literal(false).optional(),plus: z.literal(false).optional(),
    urls: z.object({ raw: safeUrl }),links: z.object({ html: safeUrl,download_location: safeUrl }),
    user: z.object({ name: text,links: z.object({ html: safeUrl }) }) }).parse(value);
  const creator = image.user.name.trim(),creatorUrl = unsplashReferral(image.user.links.html);
  const downloadUrl = trustedUrl(image.links.download_location,['api.unsplash.com']);
  if (!creator || !/^\/@[A-Za-z0-9_.-]+$/.test(new URL(creatorUrl).pathname)
    || new URL(downloadUrl).pathname !== '/photos/'+image.id+'/download'
    || [...new URL(downloadUrl).searchParams.keys()].some(key => key !== 'ixid')) throw new FlowError('STOCK_INVALID',502);
  return { provider: 'unsplash',providerId: image.id,title: image.alt_description?.trim() || image.description?.trim() || 'Fotografia editorial',creator,creatorUrl,
    sourceUrl: unsplashReferral(image.links.html),downloadUrl,imageUrl: unsplashImageUrl(image.urls.raw,Math.min(image.width,3840)),
    previewUrl: unsplashImageUrl(image.urls.raw,Math.min(image.width,1080)),width: image.width,height: image.height,
    license: 'Unsplash License',licenseUrl: unsplashReferral('https://unsplash.com/license'),attribution: `${creator} / Unsplash` };
}
/** Only the free photo API. No sponsored providers, vector art, invented originals or upscaling. */
export function normalizePixabay(value: unknown): StockImage {
  const image = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),type: z.literal('photo'),tags: text,
    pageURL: safeUrl,webformatURL: safeUrl,largeImageURL: safeUrl,imageURL: safeUrl.optional(),
    imageWidth: z.number().int().positive().max(30000),imageHeight: z.number().int().positive().max(30000),
    user: text,user_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).parse(value);
  const sourceUrl = new URL(trustedUrl(image.pageURL,['pixabay.com']));
  if (!/^\/(?:[a-z]{2}\/)?photos\/[^/]+\/$/.test(sourceUrl.pathname) || !sourceUrl.pathname.endsWith('-'+image.id+'/')) throw new FlowError('STOCK_INVALID',502);
  sourceUrl.search = '';sourceUrl.hash = '';
  const mediaUrl = (value: string) => {
    const url = new URL(trustedUrl(value,['pixabay.com','cdn.pixabay.com']));
    if (url.search || url.hash || !(url.hostname === 'pixabay.com' ? /^\/get\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i : /^\/photo\/[A-Za-z0-9/_-]+\.(?:jpe?g|png|webp)$/i).test(url.pathname)) throw new FlowError('STOCK_INVALID',502);
    return url.href;
  };
  const previewUrl = mediaUrl(image.webformatURL),imageUrl = mediaUrl(image.imageURL ?? image.largeImageURL);
  return { provider: 'pixabay',providerId: String(image.id),title: image.tags.split(',').map(tag => tag.trim()).filter(Boolean).slice(0,3).join(', ') || 'Fotografia do Pixabay',creator: image.user.trim() || 'Autoria não informada',
    sourceUrl: sourceUrl.href,previewUrl,imageUrl,width: image.imageWidth,height: image.imageHeight,
    license: 'Pixabay Content License',licenseUrl: 'https://pixabay.com/service/license-summary/',attribution: `${image.user.trim() || 'Autoria não informada'} / Pixabay`,
    ...(image.imageURL ? {} : { downloadLimited: true as const }) };
}
export function stockProviders() {
  return [{ id: 'pixabay' as const,label: 'Pixabay',configured: Boolean(process.env.PIXABAY_API_KEY?.trim()),keyName: 'PIXABAY_API_KEY' },
    { id: 'openverse' as const,label: 'Openverse / Commons',configured: true },
    { id: 'unsplash' as const,label: 'Unsplash (legado)',configured: Boolean(process.env.UNSPLASH_ACCESS_KEY?.trim()),keyName: 'UNSPLASH_ACCESS_KEY' },
    { id: 'pexels' as const,label: 'Pexels (legado)',configured: Boolean(process.env.PEXELS_API_KEY?.trim()),keyName: 'PEXELS_API_KEY' }];
}
function providerHeaders(provider: StockProvider): Record<string,string> {
  if (provider === 'openverse') return {};
  if (provider === 'pixabay') { pixabayKey();return {}; }
  const key = (provider === 'unsplash' ? process.env.UNSPLASH_ACCESS_KEY : process.env.PEXELS_API_KEY)?.trim();
  if (!key) throw new FlowError(provider === 'unsplash' ? 'UNSPLASH_KEY_MISSING' : 'PEXELS_KEY_MISSING',503);
  return provider === 'unsplash' ? { Authorization: 'Client-ID '+key,'Accept-Version': 'v1' } : { Authorization: key };
}
function pixabayKey() {
  const key = process.env.PIXABAY_API_KEY?.trim();
  if (!key) throw new FlowError('PIXABAY_KEY_MISSING',503);return key;
}
const pixabayResponses = new Map<string,{ until: number; value: unknown }>();
/** Only fixed provider endpoints; caller-supplied image URLs are never fetched. */
async function request(provider: StockProvider,path: string,fetcher: Fetcher) {
  const auth = providerHeaders(provider);
  const base = provider === 'pixabay' ? 'https://pixabay.com/api/' : provider === 'unsplash' ? 'https://api.unsplash.com/' : provider === 'pexels' ? 'https://api.pexels.com/v1/' : 'https://api.openverse.org/v1/images/';
  const url = new URL(base+path);
  const cacheKey = provider === 'pixabay' ? createHash('sha256').update(pixabayKey()).digest('hex')+':'+path : undefined;
  const cached = cacheKey && pixabayResponses.get(cacheKey);
  if (cached && cached.until > Date.now()) return cached.value as Record<string,unknown>;
  if (provider === 'pixabay') url.searchParams.set('key',pixabayKey()); // Server only; never reflected or logged.
  let response: Response;
  try { response = await fetcher(url.href,
    { headers: { ...auth,Accept: 'application/json','User-Agent': 'ReporterAI/1.0 (local editorial image selection)' },redirect: 'error',signal: AbortSignal.timeout(15000) }); }
  catch { throw new FlowError('STOCK_UNAVAILABLE',502); }
  if (response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new FlowError('STOCK_RATE_LIMIT',429);
  if ([401,403].includes(response.status)) throw new FlowError('STOCK_ACCESS_DENIED',503);
  if (provider === 'pixabay' && response.status === 400) throw new FlowError('STOCK_ACCESS_DENIED',503);
  if (!response.ok) throw new FlowError('STOCK_UNAVAILABLE',502);
  const value = await response.json();
  if (cacheKey) {
    if (pixabayResponses.size >= 100) pixabayResponses.delete(pixabayResponses.keys().next().value!);
    pixabayResponses.set(cacheKey,{ until: Date.now()+24*3600000,value });
  }
  return value;
}
const cache = new Map<string,{ until: number; value: { images: StockImage[]; hasMore: boolean } }>();
const nextSearch = new Map<StockProvider,number>();
export async function searchStock(provider: StockProvider,query: string,page: number,fetcher: Fetcher = fetch,curated = true) {
  providerHeaders(provider); // A removed key cannot be masked by a previous cached search.
  const key = `${provider}:${query}:${page}:${curated}:${provider === 'pixabay' ? createHash('sha256').update(pixabayKey()).digest('hex') : ''}`, saved = cache.get(key);
  if (saved && saved.until > Date.now()) return saved.value;
  if (Date.now() < (nextSearch.get(provider) ?? 0)) throw new FlowError('STOCK_RATE_LIMIT',429);
  nextSearch.set(provider,Date.now()+1000);
  const params = new URLSearchParams(provider === 'pixabay'
    ? { q: query,page: String(page),per_page: '24',image_type: 'photo',orientation: 'horizontal',min_width: '2400',min_height: '1350',order: 'popular',safesearch: 'true',editors_choice: String(curated) }
    : provider === 'unsplash'
    ? { query,page: String(page),per_page: '24',orientation: 'landscape',order_by: 'relevant',content_filter: 'high' }
    : provider === 'pexels'
    ? { query,page: String(page),per_page: '24',locale: 'pt-BR',orientation: 'landscape',size: 'small' }
    : { q: query,page: String(page),page_size: '12',source: 'wikimedia',license: 'cc0,pdm,by',mature: 'false' });
  const payload = await request(provider,(provider === 'unsplash' ? 'search/photos' : provider === 'pexels' ? 'search' : '')+'?'+params,fetcher);
  const items: unknown[] = Array.isArray(payload.hits) && provider === 'pixabay' ? payload.hits : Array.isArray(payload.photos) ? payload.photos : Array.isArray(payload.results) ? payload.results : [];
  // Pexels "small" means at least 4MP; additionally verify cover dimensions locally.
  // Keep the provider's relevance order. Resolution does not establish visual quality.
  const images = items.slice(0,provider === 'openverse' ? 12 : 24).flatMap(value => {
    try {
      const image = provider === 'pixabay' ? normalizePixabay(value) : provider === 'unsplash' ? normalizeUnsplash(value) : provider === 'pexels' ? normalizePexels(value) : normalizeOpenverse(value);
      return provider !== 'openverse' && !isCoverResolution(image) ? [] : [image];
    } catch { return []; }
  });
  const value = { images,hasMore: provider === 'pixabay' ? page*24 < Math.min(500,Number(payload.totalHits)) : provider === 'unsplash' ? page < Number(payload.total_pages) : provider === 'pexels' ? Boolean(payload.next_page) : page < Number(payload.page_count) };
  if (cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key,{ until: Date.now()+24*3600000,value });
  return value;
}
export async function stockDetails(provider: StockProvider,id: string,fetcher: Fetcher = fetch): Promise<StockImage> {
  if (provider === 'pexels' && !/^[1-9][0-9]{0,14}$/.test(id)) throw new FlowError('INVALID_INPUT',422);
  if (provider === 'openverse' && !z.string().uuid().safeParse(id).success) throw new FlowError('INVALID_INPUT',422);
  if (provider === 'unsplash' && !unsplashId.safeParse(id).success) throw new FlowError('INVALID_INPUT',422);
  if (provider === 'pixabay' && !/^[1-9][0-9]{0,14}$/.test(id)) throw new FlowError('INVALID_INPUT',422);
  const value = await request(provider,provider === 'pixabay' ? '?id='+id+'&image_type=photo&safesearch=true' : provider === 'openverse' ? id+'/' : 'photos/'+id,fetcher);
  try {
    const image = provider === 'pixabay' ? normalizePixabay(Array.isArray(value.hits) && value.hits.length === 1 ? value.hits[0] : undefined) : provider === 'unsplash' ? normalizeUnsplash(value) : provider === 'pexels' ? normalizePexels(value) : normalizeOpenverse(value);
    if (image.providerId !== id) throw new FlowError('STOCK_INVALID',502);return image;
  }
  catch { throw new FlowError('STOCK_INVALID',502); }
}
/** Only human-confirmed selections/reuses count, never searches, hover or preview refreshes. */
export async function trackStockSelection(image: StockImage,fetcher: Fetcher = fetch) {
  if (image.provider !== 'unsplash') return;
  if (!unsplashId.safeParse(image.providerId).success || !image.downloadUrl) throw new FlowError('STOCK_INVALID',502);
  const url = new URL(trustedUrl(image.downloadUrl,['api.unsplash.com']));
  if (url.pathname !== '/photos/'+image.providerId+'/download' || [...url.searchParams.keys()].some(key => key !== 'ixid')) throw new FlowError('STOCK_INVALID',502);
  await request('unsplash',url.pathname.slice(1)+url.search,fetcher);
}
export async function downloadStock(image: StockImage,fetcher: Fetcher = fetch): Promise<Buffer> {
  if (image.provider === 'pixabay' && (image.downloadLimited || !isCoverResolution(image))) throw new FlowError('PIXABAY_ORIGINAL_REQUIRED',422);
  const url = trustedUrl(image.imageUrl,image.provider === 'pixabay' ? ['pixabay.com','cdn.pixabay.com'] : image.provider === 'unsplash' ? ['images.unsplash.com'] : image.provider === 'pexels' ? ['images.pexels.com'] : ['upload.wikimedia.org']);
  const response = await fetcher(url,{ redirect: 'error',signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body || !/^image\/(jpeg|png|webp)(;|$)/i.test(response.headers.get('content-type') ?? '')) throw new FlowError('STOCK_INVALID',502);
  if (Number(response.headers.get('content-length')) > 10*1024**2) { await response.body.cancel(); throw new FlowError('IMAGE_TOO_LARGE',422); }
  const chunks: Uint8Array[] = [], reader = response.body.getReader(); let size = 0;
  try {
    for (;;) { const { done,value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 10*1024**2) { await reader.cancel(); throw new FlowError('IMAGE_TOO_LARGE',422); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new FlowError('STOCK_INVALID',502);
  return Buffer.concat(chunks);
}
