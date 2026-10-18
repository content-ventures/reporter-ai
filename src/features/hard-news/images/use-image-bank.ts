'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ArchiveImage } from '@/domain/hard-news';
import { bankImages, photoBanks } from '@/domain/visual-library';
import type { VisualLibraryView } from '@/domain/visual-library';
import type { VisualLibrary } from '@/ports/visual-library';
import { useRuntime } from '@/state';
import { notifyRefusal, refusalOf } from '@/ui/permission-dialog';
import { BANK_LATENCY_MS, BANK_PHOTOS } from '../preview/image-bank';
import { useHardNews } from '../state/hard-news-provider';
import {
  BANK_PROVIDERS,
  bankSort,
  fromBank,
  IMAGE_PARAM_KEYS,
  matchesFilters,
  parseImageParams,
  searchPhotos,
  serializeImageParams,
} from './images-model';
import type { BankPhoto, BankProvider, ImageFilters, ImageParams, Photo } from './images-model';
import { archiveImageOf, bankPhotoOf, keptFrom } from './library-model';

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

const NO_RESULTS: BankResults = { unsplash: [], pexels: [] };
/** The library's bank search needs a word or more (the R1 browser asks the same). */
const MIN_QUERY = 2;

// ── The R1 visual library (connected build) ───────────────────────────────────────────────────

/**
 * The R1 visual library (`VisualLibrary` port). Only the connected build has it; the R2 preview
 * runs on fixtures and keeps reading the preview archive and banks.
 */
function useVisuals(): VisualLibrary | undefined {
  return useRuntime().runtime?.visuals;
}

type LibraryState = { view?: VisualLibraryView; loading: boolean; failure?: string };

const IDLE_LIBRARY: LibraryState = { loading: false };
let library: LibraryState = IDLE_LIBRARY;
const libraryListeners = new Set<() => void>();

function setLibrary(next: LibraryState) {
  library = next;
  for (const listener of libraryListeners) listener();
}

function subscribeLibrary(listener: () => void) {
  libraryListeners.add(listener);
  return () => {
    libraryListeners.delete(listener);
  };
}

async function loadLibrary(port: VisualLibrary) {
  setLibrary({ ...library, loading: true });
  try {
    setLibrary({ view: await port.get(), loading: false });
  } catch (error) {
    setLibrary({ ...library, loading: false, failure: refusalOf(error, 'Não foi possível abrir o acervo.').message });
  }
}

/** The library as every screen of the bank sees it (one load, refreshed after a save). */
function useLibrary(port: VisualLibrary | undefined): LibraryState {
  const state = useSyncExternalStore(subscribeLibrary, () => library, () => IDLE_LIBRARY);
  useEffect(() => {
    if (port && !state.view && !state.loading && !state.failure) void loadLibrary(port);
  }, [port, state.view, state.loading, state.failure]);
  return state;
}

/** Bank photos the library's search answered in this tab, so a photo's page finds what was clicked. */
let seen: readonly BankPhoto[] = [];
const seenListeners = new Set<() => void>();

function remember(photos: readonly BankPhoto[]) {
  const known = new Set(seen.map((photo) => `${photo.provider}:${photo.providerId}`));
  const fresh = photos.filter((photo) => !known.has(`${photo.provider}:${photo.providerId}`));
  if (fresh.length === 0) return;
  seen = [...seen, ...fresh];
  for (const listener of seenListeners) listener();
}

function subscribeSeen(listener: () => void) {
  seenListeners.add(listener);
  return () => {
    seenListeners.delete(listener);
  };
}

const NO_SEEN: readonly BankPhoto[] = [];

/** The bank photos a page can resolve: the preview's, or those the library's search answered. */
export function useBankPhotos(): readonly BankPhoto[] {
  const port = useVisuals();
  const answered = useSyncExternalStore(subscribeSeen, () => seen, () => NO_SEEN);
  return port ? answered : BANK_PHOTOS;
}

/** Every bank photo at hand, by bank (suggested searches, similar photos). */
export function useBankPool(): BankResults {
  const port = useVisuals();
  const photos = useBankPhotos();
  return useMemo(() => (port
    ? { unsplash: photos.filter((photo) => photo.provider === 'unsplash').map(fromBank), pexels: photos.filter((photo) => photo.provider === 'pexels').map(fromBank) }
    : BANK_POOL), [port, photos]);
}

/**
 * The banks' answer to a search. In the connected build it is the library's search, in the banks
 * it has a key for; in the preview it arrives after `BANK_LATENCY_MS` from the preview photos. The
 * last answer stays on screen (`loading`) while the next one is on its way.
 */
export function useBankResults(query: string, filters: ImageFilters): { results?: BankResults; loading: boolean } {
  const { orientation, color, cover, rights } = filters;
  const port = useVisuals();
  const { view } = useLibrary(port);
  const banks = useMemo(() => photoBanks(view).filter((bank): bank is BankProvider => (BANK_PROVIDERS as readonly string[]).includes(bank)), [view]);
  const key = [query, orientation ?? '', color ?? '', cover ? 'capa' : '', rights ?? '', port ? banks.join(',') : 'preview'].join('|');
  const [settled, setSettled] = useState<{ key: string; results: BankResults }>();
  // The library's search needs a word, and a bank with a key: until then the banks answer nothing.
  const idle = Boolean(port) && (query.trim().length < MIN_QUERY || banks.length === 0);

  useEffect(() => {
    const wanted: ImageFilters = { orientation, color, cover, rights };
    if (!port) {
      const timer = window.setTimeout(() => {
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
    }
    if (idle) return undefined;
    const term = query.trim();
    const controller = new AbortController();
    void Promise.all(banks.map(async (bank) => {
      const answer = await port.search(bank, term, 1, { signal: controller.signal });
      return [bank, answer.images.flatMap((image) => bankPhotoOf(image) ?? [])] as const;
    })).then((answers) => {
      if (controller.signal.aborted) return;
      const results: BankResults = { ...NO_RESULTS };
      for (const [bank, photos] of answers) {
        remember(photos);
        results[bank] = photos.map(fromBank).filter((photo) => matchesFilters(photo, wanted));
      }
      setSettled({ key, results });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      notifyRefusal('Não foi possível buscar nos bancos', refusalOf(error, 'Tente de novo em instantes.'));
      setSettled({ key, results: NO_RESULTS });
    });
    return () => controller.abort();
  }, [key, query, orientation, color, cover, rights, port, banks, idle]);

  if (idle) return { results: NO_RESULTS, loading: false };
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

export type Archive = {
  images: ArchiveImage[];
  ready: boolean;
  /** Saves a photo: a bank photo into the archive, or new credit and license. Resolves `false` when it failed. */
  save: (image: ArchiveImage) => Promise<boolean>;
  /** Whether a photo's credit and license can change here (R1 keeps a library photo's as the bank gave them). */
  editable: (image: ArchiveImage) => boolean;
};

/**
 * The archive the bank shows (sent photos first) and how to save one of its photos. In the
 * connected build it is the R1 visual library: saving a bank photo keeps it there (`importImage`);
 * in the preview it is the desk's archive.
 */
export function useArchive(): Archive {
  const { state, ready, actions } = useHardNews();
  const sent = useUploads();
  const port = useVisuals();
  const kept = useLibrary(port);
  const keptImages = kept.view?.images;
  const images = useMemo(
    () => [...sent, ...(port ? bankImages(keptImages ?? []).map(archiveImageOf) : state.images)],
    [sent, port, keptImages, state.images],
  );
  const save = useCallback(
    async (image: ArchiveImage) => {
      if (image.id.startsWith(UPLOAD_PREFIX)) {
        uploads = uploads.map((item) => (item.id === image.id ? image : item));
        emit();
        return true;
      }
      if (!port) {
        actions.saveImage(image);
        return true;
      }
      const origin = image.origin;
      if (!origin || keptFrom(keptImages ?? [], origin.provider, origin.providerId)) return true;
      try {
        await port.importImage(origin.provider, origin.providerId, true);
        setLibrary({ view: await port.get(), loading: false });
        return true;
      } catch (error) {
        notifyRefusal('Não foi possível guardar a imagem', refusalOf(error, 'Tente de novo em instantes.'));
        return false;
      }
    },
    [actions, port, keptImages],
  );
  const editable = useCallback((image: ArchiveImage) => !port || image.id.startsWith(UPLOAD_PREFIX), [port]);
  return { images, ready: port ? Boolean(kept.view || kept.failure) : ready, save, editable };
}
