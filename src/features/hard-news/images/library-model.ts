import { libraryImageSource } from '../../../domain/visual-library.ts';
import type { LibraryImage, StockImage } from '../../../domain/visual-library.ts';
import type { ArchiveImage } from '../../../domain/hard-news.ts';
import { archiveCopy, BANK_PROVIDERS } from './images-model.ts';
import type { BankPhoto, BankProvider } from './images-model.ts';

/**
 * The R1 visual library (`VisualLibrary` port) read as the R2 image bank: a bank result becomes a
 * bank photo, and a photo the library kept becomes an archive photo, credited as the portal
 * publishes it ("Nome/Unsplash"), licensed as a bank photo and linked to its origin. The banks the
 * R2 bank does not show (Openverse, Pixabay) keep their own attribution and no origin.
 */

function isBank(provider: string): provider is BankProvider {
  return (BANK_PROVIDERS as readonly string[]).includes(provider);
}

/** A result of the library's bank search, or undefined for a bank the R2 bank does not show. */
export function bankPhotoOf(image: StockImage): BankPhoto | undefined {
  const provider = image.provider;
  if (!isBank(provider)) return undefined;
  return {
    provider,
    providerId: image.providerId,
    title: image.title,
    creator: image.creator,
    ...(image.creatorUrl ? { creatorUrl: image.creatorUrl } : {}),
    sourceUrl: image.sourceUrl,
    previewUrl: image.previewUrl,
    imageUrl: image.imageUrl,
    width: image.width,
    height: image.height,
    tags: [],
  };
}

/** A photo the library kept, as an archive photo: always cleared, since R1 keeps only authorized ones. */
export function archiveImageOf(image: LibraryImage): ArchiveImage {
  const src = libraryImageSource(image);
  const takenOn = image.createdAt.slice(0, 10);
  const bank = bankPhotoOf(image);
  if (bank) return { ...archiveCopy(bank, image.id), src, takenOn };
  return {
    id: image.id,
    src,
    width: image.width,
    height: image.height,
    caption: image.title,
    credit: image.attribution,
    license: 'stock',
    tags: [],
    uses: 0,
    takenOn,
  };
}

/** The library photo kept from this bank photo, if any (saving twice keeps one copy). */
export function keptFrom(images: readonly LibraryImage[], provider: BankProvider, providerId: string): LibraryImage | undefined {
  return images.find((image) => image.provider === provider && image.providerId === providerId);
}
