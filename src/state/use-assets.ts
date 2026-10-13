'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { NO_ASSETS } from '../domain/asset.ts';
import type { AssetLookup, ImageAsset } from '../domain/asset.ts';
import type { AssetId, ProductionId } from '../domain/ids.ts';
import type { AssetLimits } from '../ports/assets.ts';
import { assetQuery, assetsQuery, assetUrlQuery } from './query-specs.ts';
import type { QueryState } from './query-state.ts';
import { useQuery } from './use-queries.ts';
import { useRuntime } from './use-runtime.ts';

/**
 * Article images: metadata and display URLs as query state (like every other read), plus a
 * synchronous lookup for checks and diffs computed on screen. Writes go through
 * `useCommands().assets` (`put`, `update`).
 */

type Missing = null | undefined;

/** Images added to a production, newest first. */
export function useAssets(productionId: ProductionId | Missing): QueryState<ImageAsset[]> {
  return useQuery(productionId ? assetsQuery(productionId) : null);
}

/** One image's metadata (credit, rights, origin, size); `not_found` when it is not in this browser. */
export function useAsset(assetId: AssetId | Missing): QueryState<ImageAsset> {
  return useQuery(assetId ? assetQuery(assetId) : null);
}

/** URL for an `img`/`Image` source: the stored file's `blob:` URL, or a linked image's address. */
export function useAssetUrl(assetId: AssetId | Missing): QueryState<string> {
  return useQuery(assetId ? assetUrlQuery(assetId) : null);
}

const noopUnsubscribe = () => () => {};
const zero = () => 0;

/**
 * Synchronous metadata lookup for `runChecks({ assets })` and `diffArticles(…, { assets })` on
 * screen. A new function whenever image metadata changes, so memoised results recompute.
 */
export function useAssetLookup(): AssetLookup {
  const { runtime } = useRuntime();
  const store = runtime?.assets;
  // A stable counter box: bumped by image changes, read as the external-store snapshot.
  const [revision] = useState(() => ({ value: 0 }));
  const subscribe = useCallback(
    (onChange: () => void) =>
      store
        ? store.subscribe((change) => {
            if (change.kind === 'health') return;
            revision.value += 1;
            onChange();
          })
        : noopUnsubscribe(),
    [store, revision],
  );
  const version = useSyncExternalStore(subscribe, () => revision.value, zero);
  return useMemo<AssetLookup>(() => {
    void version;
    return store ? (assetId) => store.get(assetId) : NO_ASSETS;
  }, [store, version]);
}

/** Dropzone limits ("JPG, PNG, WebP ou GIF, até 10 MB."); undefined until the runtime exists. */
export function useAssetLimits(): AssetLimits | undefined {
  return useRuntime().runtime?.assets.limits;
}
