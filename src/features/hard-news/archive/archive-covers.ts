import type { ArchiveArticle } from '@/domain/hard-news';
import type { BankProvider } from '../images/images-model';
import { bankPhoto } from '../preview/image-bank';

/**
 * Preview covers of the published articles: the CMS keeps each article's featured image, which the
 * backend will bring with the article. Until then, the Acervo borrows a photo of the preview bank
 * that fits the subject (hotlinked, never downloaded).
 */

export type ArchiveCover = { src: string; alt: string };

const COVERS: Readonly<Record<string, readonly [BankProvider, string]>> = {
  'a-semester': ['pexels', '31636077'],
  'a-air-routes': ['unsplash', 'GIpcS2IXsdc'],
  'a-glazing': ['unsplash', 'iWBiMUhtCxM'],
  'a-energy': ['unsplash', 't4fAcYnJwBg'],
  'a-cooperative': ['unsplash', 'DAJ4pKrRnzI'],
  'a-reefer': ['unsplash', 'sWOvgOOFk1g'],
  'a-white-spot': ['pexels', '25014833'],
  'a-credit-2025': ['pexels', '7509424'],
  'a-salmon': ['unsplash', '2p76q_wVZF4'],
  'a-traceability': ['unsplash', 'RySd8U4BsUo'],
  'a-fair': ['unsplash', 'iBRBBco41QE'],
  'a-shrimp-price': ['unsplash', '3cjbDO3QJJo'],
  'a-us-fillet': ['pexels', '14062100'],
  'a-feed': ['unsplash', 'Ess6MBIzuhs'],
  'a-sardine': ['pexels', '2138116'],
  'a-sif': ['pexels', '19034282'],
};

/** Each editoria's shelf has its own photo, none of them an article's cover. */
const SHELF_COVERS: Readonly<Record<string, readonly [BankProvider, string]>> = {
  Mercado: ['unsplash', 'ryW1w1lUZOs'],
  Aquicultura: ['unsplash', 'pTabFJI2hK8'],
  Indústria: ['pexels', '8352014'],
  Regulação: ['unsplash', 'XpjMlcMR6xQ'],
  Logística: ['pexels', '7519262'],
  Eventos: ['pexels', '33939170'],
  Pesca: ['unsplash', 'rZhKZDyEWt4'],
};

function cover(entry: readonly [BankProvider, string] | undefined): ArchiveCover | undefined {
  const photo = entry ? bankPhoto(entry[0], entry[1]) : undefined;
  return photo ? { src: photo.previewUrl, alt: photo.title } : undefined;
}

/** The article's cover, or none (the frame then shows "Imagem indisponível"). */
export function coverOf(article: Pick<ArchiveArticle, 'id'>): ArchiveCover | undefined {
  return cover(COVERS[article.id]);
}

/** The editoria's shelf photo; the backend will take the portal's category image. */
export function shelfCoverOf(editoria: string): ArchiveCover | undefined {
  return cover(SHELF_COVERS[editoria]);
}
