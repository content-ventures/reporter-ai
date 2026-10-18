import type { SelectOption, Tone } from '@content-ventures/design-system/v3';
import { IMAGE_LICENSE_LABELS, imageUsable } from '../../../domain/hard-news.ts';
import type { ArchiveImage, ImageLicense, ImageOrigin } from '../../../domain/hard-news.ts';
import { isCoverResolution } from '../../../domain/visual-library.ts';
import { formatCount } from '../../../ui/format.ts';

/**
 * Pure rules of the R2 image bank (F2.9): one search over the portal's own archive and the photo
 * banks (Unsplash, Pexels), the filters and order of a real bank, the mosaic columns and the rights
 * of each photo (REQ-2.9). No React, no clock: the server and the browser draw the same thing.
 */

// ── Sources ──────────────────────────────────────────────────────────────────────────────────

export type BankProvider = ImageOrigin['provider'];
export type PhotoSource = 'own' | BankProvider;
export type SourceTab = 'all' | PhotoSource;

export const BANK_PROVIDERS: readonly BankProvider[] = ['unsplash', 'pexels'];

export const SOURCE_LABELS: Record<PhotoSource, string> = { own: 'Acervo próprio', unsplash: 'Unsplash', pexels: 'Pexels' };

/** The organization behind the archive (its BrandMark); the banks are named by their own label. */
export const PORTAL_NAME = 'Portal do Pescado';

export const BANK_LICENSES: Record<BankProvider, { label: string; url: string }> = {
  unsplash: { label: 'Licença Unsplash', url: 'https://unsplash.com/license' },
  pexels: { label: 'Licença Pexels', url: 'https://www.pexels.com/license/' },
};

/** One result of a photo bank, as the bank describes it (title and themes in pt-BR). */
export type BankPhoto = {
  provider: BankProvider;
  providerId: string;
  title: string;
  creator: string;
  creatorUrl?: string;
  sourceUrl: string;
  /** About 800 px wide, for the mosaic. */
  previewUrl: string;
  /** About 2000 px wide, for the photo page. */
  imageUrl: string;
  /** The original's size. */
  width: number;
  height: number;
  tags: string[];
  topic?: string;
  /** Dominant color word (pt-BR). */
  color?: string;
};

/** A photo of the bank view, from the archive or from a bank. */
export type Photo = {
  /** `own:img-x`, `unsplash:abc`, `pexels:123`: the address of its page. */
  key: string;
  source: PhotoSource;
  /** Archive id or the bank's id. */
  id: string;
  title: string;
  preview: string;
  full: string;
  width: number;
  height: number;
  credit: string;
  creator?: string;
  creatorUrl?: string;
  sourceUrl?: string;
  licenseUrl?: string;
  tags: string[];
  color?: string;
  takenOn?: string;
  uses: number;
  /** Archive photos only. */
  image?: ArchiveImage;
  /** Bank photos only. */
  bank?: BankPhoto;
};

const SOURCES: readonly PhotoSource[] = ['own', ...BANK_PROVIDERS];

function isSource(value: string): value is PhotoSource {
  return (SOURCES as readonly string[]).includes(value);
}

export function photoKey(source: PhotoSource, id: string): string {
  return `${source}:${id}`;
}

export function parsePhotoKey(key: string): { source: PhotoSource; id: string } | undefined {
  const at = key.indexOf(':');
  if (at <= 0) return undefined;
  const source = key.slice(0, at);
  const id = key.slice(at + 1);
  return id && isSource(source) ? { source, id } : undefined;
}

export const IMAGES_HREF = '/images';

/** The bank with a search state (`q=tilápia&fonte=acervo`), or the bare page. */
export function imagesHref(search = ''): string {
  return search ? `${IMAGES_HREF}?${search}` : IMAGES_HREF;
}

/** The page of one photo; `search` keeps the bank's state for the way back. */
export function photoHref(key: string, search = ''): string {
  return `${IMAGES_HREF}/${encodeURIComponent(key)}${search ? `?${search}` : ''}`;
}

const RESIZABLE_HOSTS = new Set(['images.unsplash.com', 'images.pexels.com']);
export const PREVIEW_WIDTH = 800;

/** The same bank photo at another width (both CDNs resize by `w`); other addresses stay as they are. */
export function sizedUrl(url: string, width: number): string {
  try {
    const parsed = new URL(url);
    if (!RESIZABLE_HOSTS.has(parsed.hostname)) return url;
    parsed.searchParams.set('w', String(width));
    return parsed.toString();
  } catch {
    return url;
  }
}

export function bankCredit(creator: string, provider: BankProvider): string {
  return `${creator}/${SOURCE_LABELS[provider]}`;
}

export function fromArchive(image: ArchiveImage): Photo {
  const origin = image.origin;
  return {
    key: photoKey('own', image.id),
    source: 'own',
    id: image.id,
    title: image.caption,
    preview: sizedUrl(image.src, PREVIEW_WIDTH),
    full: image.src,
    width: image.width,
    height: image.height,
    credit: image.credit,
    creator: origin?.creator,
    creatorUrl: origin?.creatorUrl,
    sourceUrl: origin?.sourceUrl,
    licenseUrl: origin?.licenseUrl,
    tags: image.tags,
    color: image.color,
    takenOn: image.takenOn,
    uses: image.uses,
    image,
  };
}

export function fromBank(photo: BankPhoto): Photo {
  return {
    key: photoKey(photo.provider, photo.providerId),
    source: photo.provider,
    id: photo.providerId,
    title: photo.title,
    preview: photo.previewUrl,
    full: photo.imageUrl,
    width: photo.width,
    height: photo.height,
    credit: bankCredit(photo.creator, photo.provider),
    creator: photo.creator,
    creatorUrl: photo.creatorUrl,
    sourceUrl: photo.sourceUrl,
    licenseUrl: BANK_LICENSES[photo.provider].url,
    tags: photo.tags,
    color: photo.color,
    uses: 0,
    bank: photo,
  };
}

/** "Salvar no acervo": the archive copy of a bank photo, credited, licensed and linked to its origin. */
export function archiveCopy(photo: BankPhoto, id: string): ArchiveImage {
  return {
    id,
    src: photo.imageUrl,
    width: photo.width,
    height: photo.height,
    caption: photo.title,
    credit: bankCredit(photo.creator, photo.provider),
    license: 'stock',
    tags: [...photo.tags],
    uses: 0,
    origin: {
      provider: photo.provider,
      providerId: photo.providerId,
      sourceUrl: photo.sourceUrl,
      licenseUrl: BANK_LICENSES[photo.provider].url,
      creator: photo.creator,
      ...(photo.creatorUrl ? { creatorUrl: photo.creatorUrl } : {}),
    },
    ...(photo.color ? { color: photo.color } : {}),
  };
}

/** The bank key of an archive photo saved from a bank (`unsplash:abc`). */
export function originKey(image: Pick<ArchiveImage, 'origin'>): string | undefined {
  return image.origin ? photoKey(image.origin.provider, image.origin.providerId) : undefined;
}

/** The photo of a page address: an archive id, or a bank photo (its archive copy once it was saved). */
export function resolvePhoto(key: string, archive: readonly ArchiveImage[], bank: readonly BankPhoto[]): Photo | undefined {
  const parsed = parsePhotoKey(key);
  if (!parsed) return undefined;
  if (parsed.source === 'own') {
    const image = archive.find((item) => item.id === parsed.id);
    return image ? fromArchive(image) : undefined;
  }
  const saved = archive.find((item) => originKey(item) === key);
  if (saved) return fromArchive(saved);
  const found = bank.find((item) => item.provider === parsed.source && item.providerId === parsed.id);
  return found ? fromBank(found) : undefined;
}

// ── Rights (REQ-2.9) ─────────────────────────────────────────────────────────────────────────

/** `bank`: not in the archive yet. The others are archive photos. */
export type PhotoState = 'ready' | 'pending' | 'uncredited' | 'bank';

export function photoState(photo: Pick<Photo, 'image'>): PhotoState {
  const image = photo.image;
  if (!image) return 'bank';
  if (image.license === 'pending') return 'pending';
  return imageUsable(image) ? 'ready' : 'uncredited';
}

/** The status of a photo: its license when it can go into an article, else why it cannot. */
export function rightsBadge(photo: Pick<Photo, 'image' | 'source'>): { label: string; tone: Tone } {
  const state = photoState(photo);
  if (state === 'bank') return { label: BANK_LICENSES[photo.source === 'pexels' ? 'pexels' : 'unsplash'].label, tone: 'gray' };
  if (state === 'pending') return { label: IMAGE_LICENSE_LABELS.pending, tone: 'amber' };
  if (state === 'uncredited') return { label: 'Sem crédito', tone: 'red' };
  return { label: IMAGE_LICENSE_LABELS[photo.image?.license ?? 'own'], tone: 'green' };
}

/** The note under a mosaic tile: only for an archive photo that cannot go into an article. */
export function tileNote(photo: Pick<Photo, 'image'>): { tone: 'amber' | 'red'; note: string } | undefined {
  const state = photoState(photo);
  if (state === 'pending') return { tone: 'amber', note: IMAGE_LICENSE_LABELS.pending };
  if (state === 'uncredited') return { tone: 'red', note: 'Sem crédito' };
  return undefined;
}

/** The bank a photo came from (an archive photo saved from a bank keeps it); none for the portal's own. */
export function providerOf(photo: Pick<Photo, 'source' | 'image'>): BankProvider | undefined {
  return photo.image ? photo.image.origin?.provider : photo.source === 'own' ? undefined : photo.source;
}

/** The organization behind a photo, for its BrandMark: the bank, or the portal. */
export function markName(photo: Pick<Photo, 'source' | 'image'>): string {
  const provider = providerOf(photo);
  return provider ? SOURCE_LABELS[provider] : PORTAL_NAME;
}

/** "Licença Unsplash", "Própria", "Direitos a confirmar". */
export function licenseLabel(photo: Pick<Photo, 'source' | 'image'>): string {
  const provider = providerOf(photo);
  if (photo.image && (photo.image.license !== 'stock' || !provider)) return IMAGE_LICENSE_LABELS[photo.image.license];
  return provider ? BANK_LICENSES[provider].label : IMAGE_LICENSE_LABELS.stock;
}

/** Why "Usar em artigo" does not run (the visible reason of the blocked action). */
export function blockedReason(state: PhotoState): string | undefined {
  if (state === 'pending') return 'Confirme os direitos para usar.';
  if (state === 'uncredited') return 'Informe o crédito para usar.';
  return undefined;
}

// ── Search, filters and order ────────────────────────────────────────────────────────────────

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function queryWords(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

function wordsOf(text: string): string[] {
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const hits = (words: readonly string[], word: string) => words.some((candidate) => candidate.startsWith(word));

/**
 * How well a photo answers a search, ignoring accents and case: every word of the search must
 * start a word of the themes, the title or the credit ("tilapia" finds "Tilápias"), else 0. A theme
 * weighs more than the title, the title more than the credit, and a theme equal to the search most.
 */
export function matchScore(photo: Pick<Photo, 'title' | 'credit' | 'tags'>, words: readonly string[]): number {
  if (words.length === 0) return 1;
  const tagWords = photo.tags.flatMap(wordsOf);
  const titleWords = wordsOf(photo.title);
  const creditWords = wordsOf(photo.credit);
  let score = 0;
  for (const word of words) {
    const inTags = hits(tagWords, word);
    const inTitle = hits(titleWords, word);
    const inCredit = hits(creditWords, word);
    if (!inTags && !inTitle && !inCredit) return 0;
    score += (inTags ? 3 : 0) + (inTitle ? 2 : 0) + (inCredit ? 1 : 0);
  }
  return photo.tags.map(normalize).includes(words.join(' ')) ? score + 3 : score;
}

export type Orientation = 'landscape' | 'portrait' | 'square';
export type RightsFilter = 'ready' | 'pending' | 'uncredited';

/** The "Filtros" band. Absent = any. */
export type ImageFilters = { orientation?: Orientation; color?: string; cover?: boolean; rights?: RightsFilter };

export function orientationOf(photo: Pick<Photo, 'width' | 'height'>): Orientation {
  const ratio = photo.width / photo.height;
  if (ratio > 1.05) return 'landscape';
  if (ratio < 0.95) return 'portrait';
  return 'square';
}

/** A bank photo counts as ready (free license); "Direitos a confirmar" and "Sem crédito" are archive states. */
export function matchesFilters(photo: Photo, filters: ImageFilters): boolean {
  if (filters.orientation && orientationOf(photo) !== filters.orientation) return false;
  if (filters.color && photo.color !== filters.color) return false;
  if (filters.cover && !isCoverResolution(photo)) return false;
  if (filters.rights) {
    const state = photoState(photo);
    if (state === 'bank' ? filters.rights !== 'ready' : state !== filters.rights) return false;
  }
  return true;
}

export function filterCount(filters: ImageFilters): number {
  return [filters.orientation, filters.color, filters.cover, filters.rights].filter(Boolean).length;
}

export type SortOrder = 'relevance' | 'recent' | 'used';

/** Without a choice: relevance while searching, the most recent otherwise. */
export function effectiveSort(sort: SortOrder | undefined, query: string): SortOrder {
  return sort ?? (queryWords(query).length > 0 ? 'relevance' : 'recent');
}

/**
 * Search, filters and order of one source. "Mais recentes" keeps the source's order (the archive
 * lists the last saved first; a bank, its own ranking); "Mais usadas" orders by uses.
 */
export function searchPhotos(photos: readonly Photo[], query: string, filters: ImageFilters, sort: SortOrder): Photo[] {
  const words = queryWords(query);
  const found = photos
    .map((photo, index) => ({ photo, index, score: matchScore(photo, words) }))
    .filter((entry) => entry.score > 0 && matchesFilters(entry.photo, filters));
  if (sort === 'relevance' && words.length > 0) found.sort((a, b) => b.score - a.score || a.index - b.index);
  if (sort === 'used') found.sort((a, b) => b.photo.uses - a.photo.uses || a.index - b.index);
  return found.map((entry) => entry.photo);
}

/** Banks rank by relevance while searching and keep their featured order otherwise; "Mais usadas" is the archive's. */
export function bankSort(query: string): SortOrder {
  return queryWords(query).length > 0 ? 'relevance' : 'recent';
}

// ── Merging the sources ──────────────────────────────────────────────────────────────────────

export type SourceResults = Record<PhotoSource, Photo[]>;

/** One of each, in turn, while both last; then the rest. */
export function interleave<T>(first: readonly T[], second: readonly T[]): T[] {
  const merged: T[] = [];
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    if (index < first.length) merged.push(first[index] as T);
    if (index < second.length) merged.push(second[index] as T);
  }
  return merged;
}

function savedByOrigin(archive: readonly ArchiveImage[]): Map<string, Photo> {
  const saved = new Map<string, Photo>();
  for (const image of archive) {
    const key = originKey(image);
    if (key && !saved.has(key)) saved.set(key, fromArchive(image));
  }
  return saved;
}

/**
 * The photos of a source tab. "Todas" = the archive, then Unsplash and Pexels alternating. A bank
 * photo already saved shows once, as the archive photo.
 */
export function photosFor(tab: SourceTab, results: SourceResults, archive: readonly ArchiveImage[]): Photo[] {
  if (tab === 'own') return results.own;
  const saved = savedByOrigin(archive);
  if (tab === 'all') {
    const fresh = (photos: Photo[]) => photos.filter((photo) => !saved.has(photo.key));
    return [...results.own, ...interleave(fresh(results.unsplash), fresh(results.pexels))];
  }
  return results[tab].map((photo) => saved.get(photo.key) ?? photo);
}

export function sourceCounts(results: SourceResults, archive: readonly ArchiveImage[]): Record<SourceTab, number> {
  return {
    all: photosFor('all', results, archive).length,
    own: results.own.length,
    unsplash: results.unsplash.length,
    pexels: results.pexels.length,
  };
}

// ── Suggested searches ───────────────────────────────────────────────────────────────────────

export type Suggestion = { value: string; label: string; count: number };

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

/** How many photos of `pool` a search finds. */
export function searchCount(pool: readonly Photo[], query: string): number {
  const words = queryWords(query);
  return pool.filter((photo) => matchScore(photo, words) > 0).length;
}

/**
 * The searches under the field. Without a search: the themes that find the most photos in `pool`.
 * With one: the search itself when it is a theme (shown pressed), then the themes that come with it
 * most often in `results`. `count` is what each search finds in `pool`.
 */
export function suggestedSearches(pool: readonly Photo[], results: readonly Photo[], query: string, max = 8): Suggestion[] {
  const current = normalize(query);
  const themes = new Map<string, { tag: string; together: number }>();
  for (const photo of current ? results : pool) {
    for (const tag of photo.tags) {
      const key = normalize(tag);
      const entry = themes.get(key) ?? { tag, together: 0 };
      entry.together += 1;
      themes.set(key, entry);
    }
  }
  const ranked = [...themes.entries()]
    .map(([key, entry]) => ({ key, tag: entry.tag, together: entry.together, count: searchCount(pool, entry.tag) }))
    .sort((a, b) => (current ? b.together - a.together : b.count - a.count) || b.together - a.together || a.key.localeCompare(b.key, 'pt-BR'));
  const head = ranked.filter((entry) => entry.key === current);
  const rest = ranked.filter((entry) => entry.key !== current);
  return [...head, ...rest].slice(0, max).map((entry) => ({ value: entry.tag, label: capitalize(entry.tag), count: entry.count }));
}

/** The suggestion that is the current search (pressed), if any. */
export function pressedSuggestion(suggestions: readonly Suggestion[], query: string): string | null {
  const current = normalize(query);
  return suggestions.find((item) => normalize(item.value) === current)?.value ?? null;
}

// ── Mosaic and pages ─────────────────────────────────────────────────────────────────────────

/** The gap under a tile, in tile widths (8 px on a ~280 px column). */
const TILE_GAP = 0.03;

/**
 * Masonry without measuring: each photo, in order, goes to the shortest column (heights summed in
 * column widths). The server and the browser get the same columns.
 */
export function distribute<T extends { width: number; height: number }>(items: readonly T[], columns: number): T[][] {
  const count = Math.max(1, Math.floor(columns));
  const result: T[][] = Array.from({ length: count }, () => []);
  const heights: number[] = Array.from({ length: count }, () => 0);
  for (const item of items) {
    let target = 0;
    for (let index = 1; index < count; index += 1) {
      if ((heights[index] ?? 0) < (heights[target] ?? 0) - 1e-9) target = index;
    }
    result[target]?.push(item);
    heights[target] = (heights[target] ?? 0) + item.height / Math.max(1, item.width) + TILE_GAP;
  }
  return result;
}

export const PAGE_SIZE = 40;

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageSlice<T>(items: readonly T[], page: number, size = PAGE_SIZE): T[] {
  const current = Math.min(Math.max(1, page), pageCount(items.length, size));
  return items.slice((current - 1) * size, current * size);
}

// ── Similar photos ───────────────────────────────────────────────────────────────────────────

function sameOrigin(a: Photo, b: Photo): boolean {
  return a.key === b.key || (a.image ? originKey(a.image) === b.key : false) || (b.image ? originKey(b.image) === a.key : false);
}

/** "Imagens parecidas": photos sharing themes (whole themes weigh more than shared words). */
export function similarPhotos(photo: Photo, pool: readonly Photo[], max = 12): Photo[] {
  const tags = new Set(photo.tags.map(normalize));
  const words = new Set([...tags].flatMap((tag) => tag.split(/\s+/)).filter((word) => word.length >= 4));
  return pool
    .filter((other) => !sameOrigin(photo, other))
    .map((other, index) => {
      const own = other.tags.map(normalize);
      const shared = own.filter((tag) => tags.has(tag)).length;
      const near = own.flatMap((tag) => tag.split(/\s+/)).filter((word) => words.has(word)).length;
      return { other, index, score: shared * 3 + near };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map((entry) => entry.other);
}

// ── Details ──────────────────────────────────────────────────────────────────────────────────

export const ORIENTATION_LABELS: Record<Orientation, string> = { landscape: 'Horizontal', portrait: 'Vertical', square: 'Quadrada' };

/** "6.000 × 4.000 px" (no `Intl`: the server and the browser agree). */
export function formatPixels(photo: Pick<Photo, 'width' | 'height'>): string {
  return `${formatCount(photo.width)} × ${formatCount(photo.height)} px`;
}

// ── Address (URL) state ──────────────────────────────────────────────────────────────────────

export type ViewMode = 'mosaic' | 'grid';

export type ImageParams = {
  q: string;
  source: SourceTab;
  filters: ImageFilters;
  /** Absent: `effectiveSort`. */
  sort?: SortOrder;
  view: ViewMode;
  page: number;
};

export const DEFAULT_IMAGE_PARAMS: ImageParams = { q: '', source: 'all', filters: {}, view: 'mosaic', page: 1 };

/** The parameters this page owns; any other one in the address is kept. */
export const IMAGE_PARAM_KEYS = ['q', 'fonte', 'orientacao', 'cor', 'tamanho', 'direitos', 'ordem', 'vista', 'pagina'] as const;

const SOURCE_PARAM: Record<SourceTab, string> = { all: 'todas', own: 'acervo', unsplash: 'unsplash', pexels: 'pexels' };
const ORIENTATION_PARAM: Record<Orientation, string> = { landscape: 'horizontal', portrait: 'vertical', square: 'quadrada' };
const RIGHTS_PARAM: Record<RightsFilter, string> = { ready: 'prontas', pending: 'a-confirmar', uncredited: 'sem-credito' };
const SORT_PARAM: Record<SortOrder, string> = { relevance: 'relevancia', recent: 'recentes', used: 'usadas' };

export const COLORS: readonly { value: string; label: string }[] = [
  { value: 'azul', label: 'Azul' },
  { value: 'verde', label: 'Verde' },
  { value: 'cinza', label: 'Cinza' },
  { value: 'branco', label: 'Branco' },
  { value: 'preto', label: 'Preto' },
  { value: 'vermelho', label: 'Vermelho' },
  { value: 'laranja', label: 'Laranja' },
  { value: 'amarelo', label: 'Amarelo' },
];

function lookup<T extends string>(table: Record<T, string>, value: string | null): T | undefined {
  if (!value) return undefined;
  return (Object.keys(table) as T[]).find((key) => table[key] === value);
}

type ParamReader = { get(name: string): string | null };

export function parseImageParams(search: ParamReader): ImageParams {
  const color = search.get('cor');
  const page = Number(search.get('pagina'));
  const sort = lookup(SORT_PARAM, search.get('ordem'));
  const filters: ImageFilters = {};
  const orientation = lookup(ORIENTATION_PARAM, search.get('orientacao'));
  if (orientation) filters.orientation = orientation;
  if (color && COLORS.some((item) => item.value === color)) filters.color = color;
  if (search.get('tamanho') === 'capa') filters.cover = true;
  const rights = lookup(RIGHTS_PARAM, search.get('direitos'));
  if (rights) filters.rights = rights;
  return {
    q: (search.get('q') ?? '').trim(),
    source: lookup(SOURCE_PARAM, search.get('fonte')) ?? 'all',
    filters,
    ...(sort ? { sort } : {}),
    view: search.get('vista') === 'grade' ? 'grid' : 'mosaic',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/** The address form of the state, without the defaults (`q=tilápia&fonte=acervo`). */
export function serializeImageParams(params: ImageParams): string {
  const search = new URLSearchParams();
  if (params.q.trim()) search.set('q', params.q.trim());
  if (params.source !== 'all') search.set('fonte', SOURCE_PARAM[params.source]);
  if (params.filters.orientation) search.set('orientacao', ORIENTATION_PARAM[params.filters.orientation]);
  if (params.filters.color) search.set('cor', params.filters.color);
  if (params.filters.cover) search.set('tamanho', 'capa');
  if (params.filters.rights) search.set('direitos', RIGHTS_PARAM[params.filters.rights]);
  if (params.sort) search.set('ordem', SORT_PARAM[params.sort]);
  if (params.view === 'grid') search.set('vista', 'grade');
  if (params.page > 1) search.set('pagina', String(params.page));
  return search.toString();
}

// ── Options ──────────────────────────────────────────────────────────────────────────────────

const ANY = 'all';

export const ORIENTATION_OPTIONS: SelectOption[] = [
  { value: ANY, label: 'Todas as orientações' },
  ...(Object.keys(ORIENTATION_LABELS) as Orientation[]).map((value) => ({ value, label: ORIENTATION_LABELS[value] })),
];

export const COLOR_OPTIONS: SelectOption[] = [{ value: ANY, label: 'Qualquer cor' }, ...COLORS];

export const SIZE_OPTIONS: SelectOption[] = [
  { value: ANY, label: 'Qualquer tamanho' },
  { value: 'cover', label: 'Para capa', description: 'Horizontal, 2400 × 1350 px ou mais' },
];

export const RIGHTS_LABELS: Record<RightsFilter, string> = { ready: 'Prontas para usar', pending: IMAGE_LICENSE_LABELS.pending, uncredited: 'Sem crédito' };

export const RIGHTS_OPTIONS: SelectOption[] = [
  { value: ANY, label: 'Todos os direitos' },
  ...(Object.keys(RIGHTS_LABELS) as RightsFilter[]).map((value) => ({ value, label: RIGHTS_LABELS[value] })),
];

export const SORT_LABELS: Record<SortOrder, string> = { relevance: 'Relevância', recent: 'Mais recentes', used: 'Mais usadas' };

export const SORT_OPTIONS: SelectOption[] = (Object.keys(SORT_LABELS) as SortOrder[]).map((value) => ({ value, label: SORT_LABELS[value] }));

/** Option value → filter value (`all` clears it). */
export function orientationValue(value: string): Orientation | undefined {
  return Object.hasOwn(ORIENTATION_LABELS, value) ? (value as Orientation) : undefined;
}

export function rightsValue(value: string): RightsFilter | undefined {
  return Object.hasOwn(RIGHTS_LABELS, value) ? (value as RightsFilter) : undefined;
}

export function sortValue(value: string): SortOrder | undefined {
  return Object.hasOwn(SORT_LABELS, value) ? (value as SortOrder) : undefined;
}

/** The chips of the applied filters, while the band is closed. */
export function appliedFilters(filters: ImageFilters): { id: keyof ImageFilters; label: string; value: string }[] {
  const applied: { id: keyof ImageFilters; label: string; value: string }[] = [];
  if (filters.orientation) applied.push({ id: 'orientation', label: 'Orientação', value: ORIENTATION_LABELS[filters.orientation] });
  if (filters.color) applied.push({ id: 'color', label: 'Cor', value: COLORS.find((item) => item.value === filters.color)?.label ?? filters.color });
  if (filters.cover) applied.push({ id: 'cover', label: 'Tamanho', value: 'Para capa' });
  if (filters.rights) applied.push({ id: 'rights', label: 'Direitos', value: RIGHTS_LABELS[filters.rights] });
  return applied;
}

// ── License editing (ImageDrawer) ────────────────────────────────────────────────────────────

const LICENSES = Object.keys(IMAGE_LICENSE_LABELS) as ImageLicense[];

export const LICENSE_OPTIONS: SelectOption[] = LICENSES.map((license) => ({ value: license, label: IMAGE_LICENSE_LABELS[license] }));

export function isLicense(value: string): value is ImageLicense {
  return (LICENSES as string[]).includes(value);
}
