'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AssetId, ImageAsset } from '@/domain';
import type { FigureDisplay, FigureSources } from '@/editor';
import { useAssetLookup, useRuntime } from '@/state';

/**
 * What a read-only screen needs to show the images of an article version: the address of each
 * image (the stored file's `blob:` URL, or a linked image's address), its metadata (credit,
 * rights, size) and, for the read-only editor, the figures' display data. Addresses are created
 * once per asset by the AssetStore (revoked when the runtime closes), so they stay valid while
 * the screen is open; an image missing from this browser simply has no address.
 */

export type ImageSources = {
  /** Display data for `useArticleReader({ figureSources })`. */
  figures: FigureSources;
  url: (assetId: AssetId) => string | undefined;
  asset: (assetId: AssetId) => ImageAsset | undefined;
  /** Every requested address was looked up (an absent one is then really missing). */
  ready: boolean;
};

type Urls = { key: string; map: ReadonlyMap<AssetId, string> };

const NO_URLS: ReadonlyMap<AssetId, string> = new Map();

export function useImageSources(assetIds: readonly AssetId[]): ImageSources {
  const { runtime } = useRuntime();
  const store = runtime?.assets;
  const lookup = useAssetLookup();
  const key = [...new Set(assetIds)].sort().join('\u0001');
  const [urls, setUrls] = useState<Urls>({ key: '', map: NO_URLS });

  // Looked up again when image metadata changes (the stored index finished opening, a reset).
  useEffect(() => {
    if (!store || !key) return undefined;
    let live = true;
    void (async () => {
      await store.ready();
      const ids = key.split('\u0001');
      const found = await Promise.all(ids.map(async (id) => [id, await store.objectUrl(id)] as const));
      if (!live) return;
      const map = new Map<AssetId, string>();
      for (const [id, url] of found) if (url) map.set(id, url);
      setUrls({ key, map });
    })();
    return () => {
      live = false;
    };
  }, [store, key, lookup]);

  const current = urls.key === key ? urls.map : NO_URLS;
  const figures = useMemo<FigureSources>(() => {
    const map = new Map<AssetId, FigureDisplay>();
    if (!key) return map;
    for (const id of key.split('\u0001')) {
      const asset = lookup(id);
      const display: FigureDisplay = {};
      const src = current.get(id);
      if (src) display.src = src;
      if (asset?.credit) display.credit = asset.credit;
      if (asset?.width) display.width = asset.width;
      if (asset?.height) display.height = asset.height;
      map.set(id, display);
    }
    return map;
  }, [key, lookup, current]);

  return {
    figures,
    url: (assetId) => current.get(assetId),
    asset: lookup,
    ready: !key || urls.key === key,
  };
}
