import type { AssetStore } from '../../ports/assets.ts';
import type { ServerImageAsset } from '../../ports/connected-workspace.ts';
import { libraryImageUrl } from '../../domain/visual-library.ts';
import { ok, refuse } from '../../domain/result.ts';
import { reporterRequest } from './reporter-client.ts';
import { contentHash } from '../../domain/text/hash.ts';
import type { AssetChange } from '../../ports/assets.ts';

/** Same asset contract for local uploads and server-owned photos, including real export bytes. */
export function withServerAssets(local: AssetStore,current: () => readonly ServerImageAsset[],refresh: () => Promise<void> = async () => {}): AssetStore & { adoptSnapshot(): void } {
  const listeners = new Set<(change: AssetChange) => void>();
  let signature = contentHash(current());
  const entry = (id: string) => current().find(entry => entry.asset.id === id);
  const source = (id: string) => {
    const image = entry(id)?.asset.provenance;
    if (!image) return undefined;
    const path = libraryImageUrl(image.libraryId);
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    return origin && origin !== 'null' ? new URL(path,origin).href : path;
  };
  return { ...local,
    get scope() { return local.scope; },
    subscribe(listener) { listeners.add(listener);const off = local.subscribe(listener);return () => { listeners.delete(listener);off(); }; },
    adoptSnapshot() {
      const next = contentHash(current());if (next === signature) return;signature = next;
      const change: AssetChange = { kind: 'loaded',assetIds: current().map(entry => entry.asset.id),productionIds: [...new Set(current().map(entry => entry.productionId))] };
      for (const listener of listeners) listener(change);
    },
    dispose() { listeners.clear();local.dispose(); },
    get: id => entry(id)?.asset ?? local.get(id),
    list: id => [...current().filter(entry => entry.productionId === id).map(entry => entry.asset),...local.list(id)],
    objectUrl: async id => source(id) ?? local.objectUrl(id),
    async blob(id) {
      const url = source(id);if (!url) return local.blob(id);
      try { const response = await fetch(url,{ signal: AbortSignal.timeout(20000) });return response.ok ? response.blob() : undefined; } catch { return undefined; }
    },
    async update(id,patch) {
      if (!entry(id)) return local.update(id,patch);
      try { const asset = await reporterRequest<ServerImageAsset['asset']>('/visuals/assets',{ id,patch });await refresh();return ok(asset); }
      catch (error) { return refuse('unavailable',error instanceof Error ? error.message : 'Não foi possível atualizar a imagem.'); }
    },
  };
}
