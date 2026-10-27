import assert from 'node:assert/strict';
import { test } from 'node:test';
import {defaultReporterTransport} from './reporter-client.ts';
import { withServerAssets } from './server-assets.ts';
import { createMemoryAssetStore } from '../local/assets/index.ts';
import type { ServerImageAsset } from '../../ports/connected-workspace.ts';
test('server photos resolve in a fresh browser without a prior IndexedDB record and emit asset changes', async () => {
  const local = createMemoryAssetStore({ clock: { now: () => '2026-10-13T12:00:00Z' },ids: { next: () => 'local' },workspaceId: 'workspace',actorId: () => 'editor' });
  let entries: ServerImageAsset[] = [];
  const assets = withServerAssets(local,() => entries),changes: string[] = [];
  assets.subscribe(change => changes.push(change.kind));await assets.ready();
  entries = [{ productionId: 'production',asset: { id: 'server-photo',kind: 'image',workspaceId: 'workspace',origin: { type: 'archive',archiveId: 'library' },rights: { authorized: true },createdAt: '2026-10-13T12:00:00Z',createdBy: 'editor',
    provenance: { libraryId: 'library',provider: 'pixabay',providerId: '1',title: 'Synthetic photo metadata',creator: 'Test',sourceUrl: 'https://example.com/photo',imageUrl: 'https://example.com/photo.jpg',previewUrl: 'https://example.com/preview.jpg',width: 3000,height: 2000,license: 'Pixabay Content License',licenseUrl: 'https://pixabay.com/service/license-summary/',attribution: 'Test / Pixabay' } } }];
  assets.adoptSnapshot();
  assert.equal(assets.get('server-photo')?.rights.authorized,true);assert.equal(assets.list('production').length,1);
  assert.equal(await assets.objectUrl('server-photo'),'/api/reporter/visuals/images/library/file');
  assert.ok(changes.includes('loaded'));
  assets.dispose();
});
test('uploaded server images resolve in a fresh browser with no local bytes',async()=>{
  const local=createMemoryAssetStore({clock:{now:()=>new Date().toISOString()},ids:{next:()=> 'unused'},workspaceId:'workspace',actorId:()=> 'editor'});
  const entries:ServerImageAsset[]=[{productionId:'production',fileKey:'a'.repeat(64)+'.image',asset:{id:'uploaded',kind:'image',workspaceId:'workspace',origin:{type:'upload',fileName:'photo.png'},rights:{authorized:true},createdAt:new Date().toISOString(),createdBy:'editor'}}];
  const assets=withServerAssets(local,()=>entries);await assets.ready();
  assert.equal(await assets.objectUrl('uploaded'),'/api/reporter/visuals/assets/uploaded/file');assert.equal(local.get('uploaded'),undefined);assert.equal(assets.list('production').length,1);assets.dispose();
});

test('context settlement waits for uploads and retains each unconfirmed file until its own retry succeeds',async()=>{
  const local=createMemoryAssetStore({clock:{now:()=>new Date().toISOString()},ids:{next:()=> 'unused'},workspaceId:'workspace',actorId:()=> 'editor'});
  const held=Promise.withResolvers<void>();let fail=true,refreshes=0;
  const transport={...defaultReporterTransport,async request<T>(path:string,body?:unknown):Promise<T>{
    assert.equal(path,'/visuals/assets/link');await held.promise;
    const url=(body as {url:string}).url;
    if(fail&&url.endsWith('/one.png'))throw new Error('Synthetic upload confirmation lost');
    return {id:url,workspaceId:'workspace'} as T;
  }};
  const assets=withServerAssets(local,()=>[],async()=>{refreshes++;},()=>true,transport),states:boolean[]=[];
  assets.subscribe(()=>states.push(assets.pending()));
  const meta={productionId:'production',authorized:true},first={type:'url' as const,url:'https://assets.invalid/one.png'},second={type:'url' as const,url:'https://assets.invalid/two.png'};
  const upload=assets.put(first,meta);assert.equal(assets.pending(),true);
  let settled=false;const settlement=assets.settle().then(result=>{settled=true;return result;});
  await Promise.resolve();assert.equal(settled,false,'context must remain until the held write responds');
  held.resolve();assert.equal((await upload).ok,false);assert.equal(await settlement,false);
  assert.equal(assets.health().status,'error');
  assert.equal((await assets.put(second,meta)).ok,true);assert.equal(await assets.settle(),false,'another successful file cannot hide the first failure');
  fail=false;assert.equal((await assets.put(first,meta)).ok,true);assert.equal(await assets.settle(),true);assert.equal(assets.health().status,'ok');
  assert.equal(refreshes,2);assert.ok(states.includes(true));assert.equal(states.at(-1),false);assets.dispose();
});
