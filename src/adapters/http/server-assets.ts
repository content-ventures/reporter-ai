import type { AssetStore } from '../../ports/assets.ts';
import type { ServerImageAsset } from '../../ports/connected-workspace.ts';
import { libraryImageUrl } from '../../domain/visual-library.ts';
import { ok, refuse } from '../../domain/result.ts';
import { isForbidden, reporterRequest } from './reporter-client.ts';
import { contentHash } from '../../domain/text/hash.ts';
import type { AssetChange } from '../../ports/assets.ts';
import { validateImageFile } from '../../domain/asset.ts';

/** Same asset contract for local uploads and server-owned photos, including real export bytes. */
export function withServerAssets(local: AssetStore,current: () => readonly ServerImageAsset[],refresh: () => Promise<void> = async () => {},remoteUploads: () => boolean = () => false): AssetStore & { adoptSnapshot(): void } {
  const listeners = new Set<(change: AssetChange) => void>();
  let signature = contentHash(current());
  const entry = (id: string) => current().find(entry => entry.asset.id === id);
  const source = (id: string) => {
    const image = entry(id)?.asset.provenance;
    const item = entry(id);
    if (!image && !item?.fileKey) return item?.asset.origin.type === 'url' ? item.asset.origin.url : undefined;
    const path = item?.fileKey ? '/api/reporter/visuals/assets/'+id+'/file' : libraryImageUrl(image!.libraryId);
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    return origin && origin !== 'null' ? new URL(path,origin).href : path;
  };
  return { ...local,
    async put(input,meta) {
      if (!remoteUploads()) return local.put(input,meta);
      try {
        let asset:ServerImageAsset['asset'];
        if (input.type === 'url') asset = await reporterRequest('/visuals/assets/link',{url:input.url,meta});
        else {
          const fileName=input.type==='upload'?input.fileName:'imagem-gerada.jpg';
          const valid=validateImageFile({name:fileName,type:input.file.type,size:input.file.size});if(!valid.ok)return valid;
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',await input.file.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
          const prepared=await reporterRequest<{url:string;token:string}>('/visuals/assets/prepare',{id:crypto.randomUUID(),fileName,mime:valid.value.mime,size:input.file.size,hash,meta,
            ...(input.type==='generated'?{prompt:input.prompt}:{})});
          const uploaded=await fetch(prepared.url,{method:'PUT',headers:{'content-type':valid.value.mime},body:input.file,signal:AbortSignal.timeout(120000)});
          if(!uploaded.ok)throw new Error('Não foi possível enviar a imagem. Tente novamente.');
          asset=await reporterRequest('/visuals/assets/complete',{token:prepared.token});
        }
        await refresh();return ok(asset);
      }catch(error){return refuse(isForbidden(error)?'forbidden':'unavailable',error instanceof Error?error.message:'Não foi possível salvar a imagem no servidor.');}
    },
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
      catch (error) { return refuse(isForbidden(error) ? 'forbidden' : 'unavailable',error instanceof Error ? error.message : 'Não foi possível atualizar a imagem.'); }
    },
  };
}
