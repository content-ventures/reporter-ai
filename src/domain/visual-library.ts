import { stableStringify } from './text/hash.ts';

/** Editorial photo provenance is immutable; a licence is not a model/property release. */
export type StockProvider = 'openverse' | 'pexels' | 'unsplash' | 'pixabay';
export type StockImage = {
  provider: StockProvider; providerId: string; title: string; creator: string;
  sourceUrl: string; imageUrl: string; previewUrl: string; width: number; height: number;
  license: string; licenseUrl: string; attribution: string;
  creatorUrl?: string; downloadUrl?: string;
  /** Provider exposed only a reduced preview, not the original high-resolution download. */
  downloadLimited?: true;
};
export type LibraryImage = StockImage & {
  id: string; fileKey: string; bytes: number; createdAt: string; authorized: true;
  /** Read projection from the bound HTTP adapter; never a source-of-truth storage key. */
  fileUrl?: string;
};
/** Technical suitability for a landscape cover, not an aesthetic quality score. */
export function isCoverResolution(image: Pick<StockImage,'width'|'height'>) {
  return image.width >= 2400 && image.height >= 1350 && image.width > image.height;
}
/**
 * Banks whose originals reach an article. Pixabay stays out (its API keeps the originals locked and
 * its photos fell short) and Openverse has no cover-size floor; a bank shows only with its key.
 */
export const PHOTO_BANKS: readonly StockProvider[] = ['unsplash', 'pexels'];
/** The working banks of a library view, in preference order (none: the bank is not offered). */
export function photoBanks(view: Pick<VisualLibraryView,'providers'> | undefined): StockProvider[] {
  return PHOTO_BANKS.filter(id => view?.providers.some(provider => provider.id === id && provider.configured));
}
/** Saved photos the library offers: those of a bank it still uses. */
export function bankImages(images: readonly LibraryImage[]): LibraryImage[] {
  return images.filter(image => PHOTO_BANKS.includes(image.provider));
}
/** Keep author/licence internally; Pixabay does not require a published photo credit. */
export function publicationImageCredit(image: StockImage) { return image.provider === 'pixabay' ? '' : image.attribution; }
export const BANNER_FORMATS = {
  portrait: { label: 'Feed · 1080 × 1350', width: 1080, height: 1350 },
  square: { label: 'Quadrado · 1080 × 1080', width: 1080, height: 1080 },
  story: { label: 'Story · 1080 × 1920', width: 1080, height: 1920 },
  landscape: { label: 'Horizontal · 1200 × 630', width: 1200, height: 630 },
} as const;
export type BannerFormat = keyof typeof BANNER_FORMATS;
export type BannerTemplate = 'photo' | 'editorial' | 'quote';
export const BANNER_TEMPLATES: readonly { id: BannerTemplate; label: string }[] = [
  { id: 'photo', label: 'Capa fotográfica' },
  { id: 'editorial', label: 'Chamada editorial' },
  { id: 'quote', label: 'Destaque de citação' },
];
/** Creative data, not product UI tokens. Not the client's official brand guidelines. */
export const BANNER_PALETTES = {
  ocean: { label: 'Oceano', paper: '#F4F0E8', ink: '#092F38', accent: '#DDFF78' },
  ink: { label: 'Editorial', paper: '#F6F2E8', ink: '#1A1C21', accent: '#F0BD72' },
} as const;
export type BannerContent = {
  template: BannerTemplate; format: BannerFormat; palette: keyof typeof BANNER_PALETTES;
  brand: string; kicker: string; title: string; description: string; cta: string;
  imageId?: string; productionId?: string;
  /** Literal quote and its human-confirmed attribution, never generated evidence. */
  quote?: string; quoteCredit?: string;
};
export type BannerDraft = { id: string; revision: number; content: BannerContent; updatedAt: string };
/** PostgreSQL JSONB changes property order without changing a composition. */
export function bannerContentKey(content: BannerContent) { return stableStringify(content); }
export type VisualLibraryView = {
  images: LibraryImage[]; banners: BannerDraft[];
  providers: { id: StockProvider; label: string; configured: boolean; keyName?: string }[];
};
export function libraryImageUrl(id: string) { return `/api/reporter/visuals/images/${encodeURIComponent(id)}/file`; }
/** Unsplash originals must be hotlinked; local bytes are only used in derivative banners. */
export function libraryImageSource(image: LibraryImage,preview = false) {
  return image.provider === 'unsplash' ? preview ? image.previewUrl : image.imageUrl : image.fileUrl ?? libraryImageUrl(image.id);
}
export function imageCreditUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'unsplash.com' && !url.username && !url.password && !url.port
      && /^\/@[A-Za-z0-9_.-]+$/.test(url.pathname) ? url.href : undefined;
  } catch { return undefined; }
}
export function libraryImageNote(image: StockImage) {
  return `${image.attribution}\nOrigem: ${image.sourceUrl}\nLicença: ${image.licenseUrl}${image.creatorUrl ? '\nFotógrafo: '+image.creatorUrl : ''}\nImagem ilustrativa; conferir pessoas, marcas e contexto. Recorte ou tratamento deve ser indicado.`;
}
export function initialBanner(): BannerContent {
  return { template: 'photo', format: 'portrait', palette: 'ocean', brand: 'Seafood Brasil',
    kicker: 'Pescado em pauta', title: '', description: '', cta: 'Leia a matéria' };
}
