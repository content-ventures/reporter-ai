'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ArchiveImage } from '@/domain/hard-news';
import { BANK_LATENCY_MS, BANK_PHOTOS } from '../preview/image-bank';
import { useHardNews } from '../state/hard-news-provider';
import {
  bankSort,
  fromBank,
  IMAGE_PARAM_KEYS,
  parseImageParams,
  searchPhotos,
  serializeImageParams,
} from './images-model';
import type { BankProvider, ImageFilters, ImageParams, Photo } from './images-model';

export type SetImageParams = (patch: Partial<ImageParams>) => void;

/**
 * The bank's state in the address (`?q&fonte&orientacao&cor&tamanho&direitos&ordem&vista&pagina`,
 * so the caller renders inside `<Suspense>`): a search can be linked, and the way back from a photo
 * finds the same results. Writes replace the address; other parameters stay.
 */
export function useImageParams(): [ImageParams, SetImageParams] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const params = useMemo(() => parseImageParams(searchParams), [searchParams]);

  const setParams = useCallback<SetImageParams>(
    (patch) => {
      const current = new URLSearchParams(window.location.search);
      const search = new URLSearchParams(serializeImageParams({ ...parseImageParams(current), ...patch }));
      for (const [key, value] of current) if (!(IMAGE_PARAM_KEYS as readonly string[]).includes(key)) search.append(key, value);
      const query = search.toString();
      const url = query ? `${pathname}?${query}` : pathname;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url);
    },
    [pathname],
  );

  return [params, setParams];
}

/** Every preview bank photo, by bank, in each bank's featured order. */
export const BANK_POOL: Record<BankProvider, Photo[]> = {
  unsplash: BANK_PHOTOS.filter((photo) => photo.provider === 'unsplash').map(fromBank),
  pexels: BANK_PHOTOS.filter((photo) => photo.provider === 'pexels').map(fromBank),
};

export type BankResults = Record<BankProvider, Photo[]>;

/**
 * The banks' answer to a search, as a remote search behaves: it arrives after `BANK_LATENCY_MS`,
 * and the last answer stays on screen (`loading`) while the next one is on its way.
 */
export function useBankResults(query: string, filters: ImageFilters): { results?: BankResults; loading: boolean } {
  const { orientation, color, cover, rights } = filters;
  const key = [query, orientation ?? '', color ?? '', cover ? 'capa' : '', rights ?? ''].join('|');
  const [settled, setSettled] = useState<{ key: string; results: BankResults }>();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const wanted: ImageFilters = { orientation, color, cover, rights };
      const sort = bankSort(query);
      setSettled({
        key,
        results: {
          unsplash: searchPhotos(BANK_POOL.unsplash, query, wanted, sort),
          pexels: searchPhotos(BANK_POOL.pexels, query, wanted, sort),
        },
      });
    }, BANK_LATENCY_MS);
    return () => window.clearTimeout(timer);
  }, [key, query, orientation, color, cover, rights]);

  return { results: settled?.results, loading: settled?.key !== key };
}

// ── Sent photos (in memory) ──────────────────────────────────────────────────────────────────

/** Ids of the photos sent in this tab. */
export const UPLOAD_PREFIX = 'img-envio-';

let uploads: readonly ArchiveImage[] = [];
const NO_UPLOADS: readonly ArchiveImage[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * "Enviar fotos" keeps the files in this tab only (`blob:` addresses die with it), so they never
 * reach the stored desk. The backend will upload them to the archive.
 */
export function addUploads(images: readonly ArchiveImage[]): void {
  uploads = [...images, ...uploads];
  emit();
}

function useUploads(): readonly ArchiveImage[] {
  return useSyncExternalStore(subscribe, () => uploads, () => NO_UPLOADS);
}

/** The archive the bank shows (sent photos first) and how to save one of its photos. */
export function useArchive(): { images: ArchiveImage[]; ready: boolean; save: (image: ArchiveImage) => void } {
  const { state, ready, actions } = useHardNews();
  const sent = useUploads();
  const images = useMemo(() => [...sent, ...state.images], [sent, state.images]);
  const save = useCallback(
    (image: ArchiveImage) => {
      if (image.id.startsWith(UPLOAD_PREFIX)) {
        uploads = uploads.map((item) => (item.id === image.id ? image : item));
        emit();
        return;
      }
      actions.saveImage(image);
    },
    [actions],
  );
  return { images, ready, save };
}
