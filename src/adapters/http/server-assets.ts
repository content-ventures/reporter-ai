import type { AssetStore } from '../../ports/assets.ts';
import type { ServerImageAsset } from '../../ports/connected-workspace.ts';
import { libraryImageUrl } from '../../domain/visual-library.ts';
import { ok, refuse } from '../../domain/result.ts';
import { isForbidden, defaultReporterTransport, type ReporterTransport } from './reporter-client.ts';
import { contentHash } from '../../domain/text/hash.ts';
import type { AssetChange, AssetHealth } from '../../ports/assets.ts';
import { validateImageFile } from '../../domain/asset.ts';

/** Same asset contract for local uploads and server-owned photos, including real export bytes. */
export function withServerAssets(local: AssetStore,current: () => readonly ServerImageAsset[],refresh: () => Promise<void> = async () => {},remoteUploads: () => boolean = () => false,http: ReporterTransport = defaultReporterTransport): AssetStore & { adoptSnapshot(): void; pending(): boolean; settle(): Promise<boolean> } {
  const listeners = new Set<(change: AssetChange) => void>();
  let signature = contentHash(current());
  const pendingWrites = new Set<Promise<unknown>>();
  const unconfirmed = new Map<string,AssetHealth>();
  const changed = () => { for (const listener of listeners) listener({kind:'health',assetIds:[],productionIds:[]}); };
  const track = <T extends {ok:boolean;refusal?:{code:string;message:string}}>(operation:(identify:(key:string)=>void)=>Promise<T>):Promise<T> => {
    let key=crypto.randomUUID() as string;
    const promise = operation(value=>{key=value;}).then(result=>{
      if(result.ok)unconfirmed.delete(key);
      else if(result.refusal?.code==='unavailable')unconfirmed.set(key,{status:'error',code:'unavailable',message:result.refusal.message});
      return result;
    }).catch(error=>{
      unconfirmed.set(key,{status:'error',code:'unavailable',message:'Não foi possível confirmar o envio da imagem.'});throw error;
    }).finally(()=>{pendingWrites.delete(promise);changed();});
    pendingWrites.add(promise);changed();return promise;
  };

  const entry = (id: string) => current().find(entry => entry.asset.id === id);
  const source = (id: string) => {
    const image = entry(id)?.asset.provenance;
    const item = entry(id);
    if (!image && !item?.fileKey) return item?.asset.origin.type === 'url' ? item.asset.origin.url : undefined;
    const path = http.url(item?.fileKey ? '/visuals/assets/'+encodeURIComponent(id)+'/file' : libraryImageUrl(image!.libraryId).slice('/api/reporter'.length));
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    return origin && origin !== 'null' ? new URL(path,origin).href : path;
  };
  return { ...local,
    put(input,meta) { return track(async identify=>{
      if (!remoteUploads()) return local.put(input,meta);
      try {
        let asset:ServerImageAsset['asset'];
        if (input.type === 'url') {identify(JSON.stringify(['link',meta.productionId,input.url]));asset = await http.request('/visuals/assets/link',{url:input.url,meta});}
        else {
          const fileName=input.type==='upload'?input.fileName:'imagem-gerada.jpg';
          const valid=validateImageFile({name:fileName,type:input.file.type,size:input.file.size});if(!valid.ok)return valid;
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',await input.file.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
          identify(JSON.stringify(['put',meta.productionId,hash]));
          const prepared=await http.request<{url:string;token:string}>('/visuals/assets/prepare',{id:crypto.randomUUID(),fileName,mime:valid.value.mime,size:input.file.size,hash,meta,
            ...(input.type==='generated'?{prompt:input.prompt}:{})});
          const uploaded=await fetch(prepared.url,{method:'PUT',headers:{'content-type':valid.value.mime},body:input.file,signal:AbortSignal.timeout(120000)});
          if(!uploaded.ok)throw new Error('Não foi possível enviar a imagem. Tente novamente.');
          asset=await http.request('/visuals/assets/complete',{token:prepared.token});
        }
        await refresh();return ok(asset);
      }catch(error){return refuse(isForbidden(error)?'forbidden':'unavailable',error instanceof Error?error.message:'Não foi possível salvar a imagem no servidor.');}
    }); },
    pending:()=>pendingWrites.size>0,
    async settle(){while(pendingWrites.size)await Promise.allSettled([...pendingWrites]);return unconfirmed.size===0&&local.health().status!=='error';},
    health:()=>unconfirmed.values().next().value??local.health(),
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
    update(id,patch) { return track(async identify=>{
      identify(JSON.stringify(['update',id]));
      if (!entry(id)) return local.update(id,patch);
      try { const asset = await http.request<ServerImageAsset['asset']>('/visuals/assets',{ id,patch });await refresh();return ok(asset); }
      catch (error) { return refuse(isForbidden(error) ? 'forbidden' : 'unavailable',error instanceof Error ? error.message : 'Não foi possível atualizar a imagem.'); }
    }); },
  };
}
