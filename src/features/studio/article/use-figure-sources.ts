'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AssetId } from '@/domain';
import type { FigureDisplay, FigureSources } from '@/editor';
import { useAssetLookup, useRuntime } from '@/state';

/**
 * What the studio's images show, per asset: the stored file's `blob:` URL (or the linked
 * address), the credit and the size. The editor takes it as display data (`figureSources`): it
 * never reaches the body, the history or the autosave. The map keeps its identity while nothing
 * shown changes, so the editor sees one display transaction per real change. `display(assetId)`
 * answers the same for an image stored a moment ago, so a new figure shows its picture at once.
 * An asset enters the map only once its address was looked up: until then its figures keep what
 * they show (a figure just inserted with its picture never blinks to "missing" and back).
 */

/** Per asset: its address, or `null` once looked up without one (missing from this browser). */
type Urls = ReadonlyMap<AssetId, string | null>;

const NO_URLS: Urls = new Map();

export type FigureSourcesState = {
  sources: FigureSources;
  display: (assetId: AssetId) => Promise<FigureDisplay>;
};

export function useFigureSources(assetIds: readonly AssetId[]): FigureSourcesState {
  const { runtime } = useRuntime();
  const store = runtime?.assets;
  const lookup = useAssetLookup();
  const key = useMemo(() => [...new Set(assetIds)].sort().join('\n'), [assetIds]);
  // Addresses are per asset and stable (created once by the store), so a new key keeps the old
  // ones while the new ids resolve: nothing on screen blinks.
  const [urls, setUrls] = useState<Urls>(NO_URLS);

  useEffect(() => {
    if (!store || !key) return undefined;
    let live = true;
    void (async () => {
      await store.ready();
      const found = await Promise.all(key.split('\n').map(async (id) => [id, await store.objectUrl(id)] as const));
      if (!live) return;
      setUrls((current) => {
        const next = new Map(current);
        let changed = false;
        for (const [id, url] of found) {
          const value = url ?? null;
          if (next.has(id) && next.get(id) === value) continue;
          next.set(id, value);
          changed = true;
        }
        return changed ? next : current;
      });
    })();
    return () => {
      live = false;
    };
    // `lookup` changes with the image metadata (index opened, image stored, reset): look again.
  }, [store, key, lookup]);

  const signature = useMemo(() => {
    if (!key) return '[]';
    const entries = key
      .split('\n')
      .filter((id) => urls.has(id))
      .map((id): [AssetId, FigureDisplay] => [id, displayOf(lookup(id), urls.get(id) ?? undefined)]);
    return JSON.stringify(entries.filter(([, display]) => Object.keys(display).length > 0));
  }, [key, lookup, urls]);
  const sources = useMemo<FigureSources>(() => new Map(JSON.parse(signature) as [AssetId, FigureDisplay][]), [signature]);

  const display = useCallback(
    async (assetId: AssetId): Promise<FigureDisplay> => {
      if (!store) return {};
      return displayOf(store.get(assetId), await store.objectUrl(assetId));
    },
    [store],
  );

  return useMemo(() => ({ sources, display }), [sources, display]);
}

function displayOf(asset: { credit?: string; width?: number; height?: number } | undefined, src: string | undefined): FigureDisplay {
  const display: FigureDisplay = {};
  if (src) display.src = src;
  if (asset?.credit) display.credit = asset.credit;
  if (asset?.width) display.width = asset.width;
  if (asset?.height) display.height = asset.height;
  return display;
}
