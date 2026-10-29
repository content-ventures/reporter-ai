import { createEditorialEngine, editorialLocalRoleProfiles, emptyEditorialCheckpoint, LOCAL_OPERATOR, LOCAL_WORKSPACE } from './editorial-engine.ts';
import { applyWorkspaceDelta } from './editorial-sync.ts';
import { ASSET_DB_NAME, createIndexedDbAssetStore,createMemoryAssetStore } from '../adapters/local/assets/index.ts';
import { createLocalAudit } from '../adapters/local/audit/index.ts';
import { createLocalExportService } from '../adapters/local/export/index.ts';
import { createHttpExportService } from '../adapters/http/export.ts';
import { assetCoverLoader, createLocalRenderService, servedCoverLoader,decodeBitmap } from '../adapters/local/render/index.ts';
import type {CoverLoader} from '../adapters/local/render/index.ts';
import type {RenderService} from '../ports/render.ts';
import type {CarouselTemplate} from '../domain/carousel.ts';
import type {WorkspaceTemplateConfiguration} from '../domain/workspace-templates.ts';
import {workspaceTemplateHash} from '../domain/workspace-templates.ts';
import {isPreservedPilot} from '../domain/workspace-pilot.ts';
import {workspaceTemplateLibrary} from './workspace-templates.ts';
import { isForbidden, ReporterHttpError, createReporterTransport, requestWorkspace, createHttpGeneration, createHttpIngest } from '../adapters/http/reporter-client.ts';
import { avatarImage } from '../adapters/local/assets/avatar-image.ts';
import { createHttpImageGenerator, createHttpVisualLibrary } from '../adapters/http/visual-library.ts';
import { createHttpCitationLibrary } from '../adapters/http/citation-library.ts';
import { createHttpMemoryLibrary } from '../adapters/http/editorial-memory.ts';
import { createHttpNewsIntake } from '../adapters/http/news-intake.ts';
import {createHttpWorkspaceAdministration} from '../adapters/http/workspace-management.ts';
import {createHttpWorkspaceDirectory} from '../adapters/http/workspace-directory.ts';
import {createHttpMemberViewing} from '../adapters/http/member-view.ts';
import { withServerAssets } from '../adapters/http/server-assets.ts';
import { committedCommand } from '../adapters/http/committed-command.ts';
import { createWorkspaceRefresh } from '../adapters/http/workspace-refresh.ts';
import { contentHash } from '../domain/text/hash.ts';
import { createFixtures } from '../fixtures/index.ts';
import { usedAssetIds } from '../domain/record.ts';
import { creditLine } from '../domain/asset.ts';
import { ok, refuse } from '../domain/result.ts';
import type { Result } from '../domain/result.ts';
import { validateProfilePatch, type ProfileRefusal } from '../domain/profile.ts';
import type { SessionMember } from '../ports/session.ts';
import type { ConnectedWorkspace } from '../ports/connected-workspace.ts';
import type { SaveState } from '../ports/save-status.ts';
import type { ProductionCommands } from '../ports/production-commands.ts';
import type { ProductionQueries } from '../ports/production-queries.ts';
import type { Runtime } from './runtime.ts';
import type { PipelineView } from '../domain/pipeline.ts';
import type { WritingRunDetails } from '../ports/pipeline-settings.ts';
import { isRunActive } from '../domain/run.ts';

/** Approved screens, server-owned state, real Groq jobs. Demo snapshots remain untouched. */
export function createConnectedRuntime(options: { typefaces?: Readonly<Record<string,string>>; workspaceSlug?: string;viewId?:string } = {}): Runtime {
  const contextListeners=new Set<()=>void>();
  const invalidate=()=>{for(const listener of [...contextListeners])listener();};
  const http = createReporterTransport(options.workspaceSlug,{requireAccount:true,onInvalidated:invalidate,viewId:options.viewId});
  const directoryHttp=createReporterTransport(undefined,{requireAccount:true,onInvalidated:invalidate});
  const clock = { now: () => new Date().toISOString() },ids = { next: () => crypto.randomUUID() };
  let current: ConnectedWorkspace = { ...emptyEditorialCheckpoint(),revision: -1,model: '',workerOnline: false };
  // The engine reads image assets through this object, kept in step with every refresh.
  const engineCheckpoint = { ...current };
  const templates:CarouselTemplate[]=[];
  const ports = createEditorialEngine(engineCheckpoint,ids,templates);
  let disposed = false;
  const activeTab = Object.freeze({ status: 'active' as const });
  let lastRefresh = 0;
  let save: SaveState = { scope: 'remote',status: 'idle' };
  const saveListeners = new Set<(state: SaveState) => void>();
  const setSave = (state: SaveState) => { save = state; for (const listener of saveListeners) listener(readSave()); };
  let resolveAssetNamespace!: (name:string)=>void, rejectAssetNamespace!: (error:unknown)=>void;
  const databaseName = new Promise<string>((resolve,reject)=>{resolveAssetNamespace=resolve;rejectAssetNamespace=reject;});
  void databaseName.catch(()=>{});
  const assetOptions={clock,ids,workspaceId:()=>current.state.workspace.id,actorId:()=>current.navigation?.accountId??current.state.sessionPersonId,reset:false};
  // Support viewing never leaves private files in a persistent browser database.
  const localAssets=options.viewId?createMemoryAssetStore(assetOptions):createIndexedDbAssetStore({...assetOptions,databaseName});
  const assets = withServerAssets(localAssets,() => current.imageAssets ?? [],() => refresh(true),() => current.deploymentMode === 'cloud',http);
  const uploading:SaveState={scope:'remote',status:'saving'};
  let assetError:SaveState|undefined;
  function readSave(): SaveState {
    if(assets.pending())return uploading;
    const health=assets.health();
    if(health.status!=='error')return save;
    if(assetError?.error?.code!==health.code||assetError.error.message!==health.message)
      assetError={scope:'remote',status:'error',error:{code:health.code,message:health.message}};
    return assetError!;
  }
  const fixtures = createFixtures({ now: clock.now(),empty: true });
  const imageDisposers=new Set<()=>void>();
  const ownImage=<T extends {dispose?:()=>void}>(loader:T)=>{if(loader.dispose)imageDisposers.add(loader.dispose);return loader;};
  const covers=ownImage(assetCoverLoader(assets));
  const initialRender = () => createLocalRenderService({ templates: fixtures.templates,renders: fixtures.templateRenders,
    descriptions: fixtures.templateDescriptions,library: fixtures.templateLibrary,fontFaces: fixtures.templateFonts,loadCover: covers,
    coverCredit: id => creditLine(assets.get(id)?.credit),samplePhoto: { assetId: fixtures.samplePhoto.assetId,credit: fixtures.samplePhoto.credit,load: ownImage(servedCoverLoader(fixtures.samplePhoto.src)) },
    samplePhotos: fixtures.samplePhotos.map(photo => ({ assetId: photo.assetId,credit: photo.credit,load: ownImage(servedCoverLoader(photo.src)) })),typefaces: options.typefaces });
  let drawing = options.workspaceSlug ? createLocalRenderService({templates:[],renders:{}}) : initialRender();
  let catalogHash='';
  const logos=new Map<string,ReturnType<CoverLoader>>();
  const loadBrandLogo:CoverLoader=id=>{
    const cached=logos.get(id);if(cached)return cached;
    const pending=(async()=>{
      try{const response=await http.fetch(`/templates/logos/${encodeURIComponent(id)}`,{cache:'force-cache'});
        const image=response.ok?await decodeBitmap(await response.blob()):undefined;if(image&&disposed){const source=image.source as {close?:()=>void};source.close?.();return refuse('unreadable' as const,'Contexto encerrado.');}return image?ok(image):refuse('unreadable' as const,'Marca indisponível.');
      }catch{return refuse('unreadable' as const,'Marca indisponível.');}
    })();logos.set(id,pending);void pending.then(result=>{if(!result.ok)logos.delete(id);});return pending;
  };
  const adoptTemplates=(configuration:WorkspaceTemplateConfiguration|undefined)=>{
    if(!configuration){if(isPreservedPilot(current.state.workspace.id)){templates.splice(0,templates.length,...fixtures.templates);drawing=initialRender();}return;}
    const hash=contentHash(configuration);if(hash===catalogHash)return;catalogHash=hash;
    engineCheckpoint.templateConfiguration=configuration;
    const catalog=workspaceTemplateLibrary(configuration);templates.splice(0,templates.length,...catalog.templates);
    drawing=createLocalRenderService({templates,renders:catalog.renders,library:catalog.library,activeTemplateIds:catalog.activeIds,
      fontFaces:fixtures.templateFonts,typefaces:options.typefaces,loadCover:covers,loadBrandLogo,coverCredit:id=>creditLine(assets.get(id)?.credit),
      ...(configuration.pilot?{samplePhoto:{assetId:fixtures.samplePhoto.assetId,credit:fixtures.samplePhoto.credit,load:ownImage(servedCoverLoader(fixtures.samplePhoto.src))},
        samplePhotos:fixtures.samplePhotos.map(photo=>({assetId:photo.assetId,credit:photo.credit,load:ownImage(servedCoverLoader(photo.src))}))}:{})});
  };
  const ensureTemplate=async(id:string)=>{
    if(drawing.sample(id).ok)return;
    const hash=workspaceTemplateHash(id,current.state.workspace.id);if(!hash)return;
    const loaded=await http.request<WorkspaceTemplateConfiguration>(`/templates?hashes=${hash}`);
    if(loaded.workspaceId!==current.state.workspace.id||disposed)return;
    const history=[...loaded.history,...(current.templateConfiguration?.history??[])].filter((entry,index,all)=>all.findIndex(other=>other.hash===entry.hash)===index).slice(0,200);
    current.templateConfiguration={...loaded,history};adoptTemplates(current.templateConfiguration);
    ports.store.transact(state=>ok({state:{...state},value:undefined,persist:'none',scope:'external',productionIds:[]}));
  };
  const render:RenderService={
    get samplePhoto(){return drawing.samplePhoto;},templates:()=>drawing.templates(),capabilities:()=>drawing.capabilities(),
    templateInfo:id=>drawing.templateInfo?.(id),retainedTemplateIds:()=>drawing.retainedTemplateIds?.()??drawing.templates().map(template=>template.id),
    measure:body=>drawing.measure(body),sample:id=>drawing.sample(id),switchTemplate:(body,id)=>drawing.switchTemplate(body,id),
    render:async request=>{await ensureTemplate(request.body.templateId);return drawing.render(request);},
    thumbnail:async request=>{await ensureTemplate(request.templateId);return drawing.thumbnail(request);},
    preview:async request=>{await ensureTemplate(request.templateId);return drawing.preview(request);},
  };
  const runActive = () => Object.values(current.state.runFolds).some(fold => isRunActive(fold.run));
  const refresh = createWorkspaceRefresh(() => {
    const requestedAt=performance.now();
    return requestWorkspace(current.syncToken,runActive(),http).then(snapshot => {
      if (disposed || snapshot.revision < current.revision) return;
      if ('unchanged' in snapshot) {
        current = { ...current,workerOnline: snapshot.workerOnline,stalled: snapshot.stalled };
        return;
      }
      if ('delta' in snapshot) {
        // Only the changed rows: unchanged productions keep their identity and cached views.
        const merged = applyWorkspaceDelta(current,{ ...snapshot,seq: snapshot.revision });
        current = { ...merged.workspace,syncToken: snapshot.syncToken,workerOnline: snapshot.workerOnline,stalled: snapshot.stalled };
        engineCheckpoint.imageAssets = current.imageAssets;
        assets.adoptSnapshot();
        if (merged.productionIds.length) ports.store.transact(() => ok({ state: current.state,value: undefined,persist: 'none',scope: 'external',productionIds: merged.productionIds }));
        generation.accept(current);
        return;
      }
      if (options.workspaceSlug && snapshot.state.workspace.slug !== options.workspaceSlug
        || options.viewId!==snapshot.navigation?.view?.id
        || current.revision >= 0 && (snapshot.state.workspace.id !== current.state.workspace.id || snapshot.state.sessionPersonId !== current.state.sessionPersonId)) throw new Error('ACCOUNT_CONTEXT_CHANGED');
      if(snapshot.navigation?.view)snapshot.navigation.view.remainingMs=Math.max(0,snapshot.navigation.view.remainingMs-Math.ceil(performance.now()-requestedAt));
      http.bindAccount(snapshot.navigation?.accountId??snapshot.state.sessionPersonId);
      directoryHttp.bindAccount(snapshot.navigation?.accountId??snapshot.state.sessionPersonId);
      resolveAssetNamespace(!options.viewId&&snapshot.deploymentMode === 'local' && snapshot.state.workspace.id === LOCAL_WORKSPACE && snapshot.state.sessionPersonId === LOCAL_OPERATOR
        ? ASSET_DB_NAME : `reporter-assets:${encodeURIComponent(snapshot.state.workspace.id)}:${encodeURIComponent(snapshot.navigation?.accountId??snapshot.state.sessionPersonId)}${options.viewId?`:view:${options.viewId}`:''}`);
      const changed = snapshot.revision !== current.revision || snapshot.syncToken !== current.syncToken;
      current = snapshot;
      adoptTemplates(snapshot.templateConfiguration);
      engineCheckpoint.imageAssets = current.imageAssets;
      assets.adoptSnapshot();
      if (changed) ports.store.transact(() => ok({ state: snapshot.state,value: undefined,persist: 'none',scope: 'external',productionIds: snapshot.state.productions.map(p => p.production.id) }));
      generation.accept(snapshot);
    }).catch(error=>{rejectAssetNamespace(error);throw error;}).finally(() => { lastRefresh = Date.now(); });
  });
  let writeTail: Promise<unknown> = Promise.resolve();
  let failedWrite: { method: string; args: unknown[]; requestId: string } | undefined;
  const rpc = <T,>(method: string,args: unknown[]): Promise<T> => {
    const payload = failedWrite && contentHash({ method,args }) === contentHash({ method: failedWrite.method,args: failedWrite.args })
      ? failedWrite : { method,args,requestId: crypto.randomUUID() };
    const operation = writeTail.then(async () => {
      const before = save;
      setSave({ scope: 'remote',status: 'saving' });
      try {
        await ready;
        const result = await committedCommand(() => http.request<T>('/workspace',payload),() => refresh(true));
        failedWrite = undefined;
        setSave({ scope: 'remote',status: 'saved',savedAt: clock.now() });
        return result;
      } catch (error) {
        // A role refusal is an answer, not an outage: no save error and nothing to send again.
        if (isForbidden(error)) { setSave(before); return refuse('forbidden',error.message) as T; }
        setSave({ scope: 'remote',status: 'error',error: { code: 'unavailable',message: error instanceof Error ? error.message : 'Não foi possível salvar no servidor.' } });
        failedWrite = payload;
        return refuse('unavailable',save.error!.message) as T;
      }
    });
    writeTail = operation.catch(() => undefined);
    return operation;
  };
  const generation = createHttpGeneration({ current: () => current,refresh,rpc });
  const commands = Object.fromEntries(Object.keys(ports.commands).map(method => [method,(...args: unknown[]) => rpc(method,args)])) as unknown as ProductionCommands;
  const queries = Object.fromEntries(Object.entries(ports.queries).map(([key,value]) => [key,key === 'subscribe' ? value : async (...args: unknown[]) => { await ready; return (value as (...args: unknown[]) => unknown)(...args); }])) as ProductionQueries;
  const audit = createLocalAudit({ store: ports.store,clock });
  const exporter = createHttpExportService(createLocalExportService({ clock,getRecord: id => ports.records.record(id),render,assets }), http);
  const ready = Promise.all([refresh(),assets.ready()]).then(() => undefined);
  const directory=createHttpWorkspaceDirectory(directoryHttp,()=>ready);
  const memberViewing=createHttpMemberViewing(directoryHttp,()=>ready,()=>current.navigation?.accountId);
  // Polls only this application's same-origin endpoint; generation survives leaving the page.
  // A hidden tab stops polling, so a forgotten tab does not keep the database awake.
  const timer = setInterval(() => {
    if (disposed || globalThis.document?.visibilityState === 'hidden') return;
    if (Date.now()-lastRefresh >= (runActive() ? 1000 : 15000)) void refresh().catch(() => {});
  },1000);
  const resumed=()=>{if(!disposed&&globalThis.document?.visibilityState==='visible')void refresh().catch(()=>{});};
  globalThis.document?.addEventListener('visibilitychange',resumed);
  // "Meu perfil": the server writes only the signed-in member; the next snapshot brings it back.
  const profileWrite = async (write: () => Promise<unknown>): Promise<Result<SessionMember,ProfileRefusal>> => {
    await ready;
    try { await write(); }
    catch (error) {
      const code = error instanceof ReporterHttpError ? error.code : '';
      return refuse(code === 'PROFILE_NAME_REQUIRED' ? 'empty_name' : code === 'PROFILE_TOO_LONG' ? 'too_long' : code.startsWith('AVATAR_') ? 'invalid_image' : 'unavailable',
        error instanceof Error ? error.message : 'Não foi possível salvar seu perfil.');
    }
    await refresh(true).catch(() => {});
    ports.store.transact(state => ok({ state,value: undefined,persist: 'none',scope: 'session',productionIds: [] }));
    const member = await ports.session.current();
    return member ? ok(member) : refuse('unavailable','Nenhuma conta conectada.');
  };
  const unwatchAssets = assets.subscribe(change => { if(change.kind==='health'){for(const listener of saveListeners)listener(readSave());}else ports.store.transact(state => ok({ state,value: undefined,persist: 'none',scope: 'assets',productionIds: change.productionIds })); });
  return {
    get navigation(){return current.navigation;},
    get workspaceDirectory(){return current.navigation?.enabled?directory:undefined;},
    memberViewing,
    administration:createHttpWorkspaceAdministration({transport:http,ready:()=>ready,scope:()=>current.state.workspace.id,readOnly:()=>Boolean(current.navigation?.view)}),
    mode: 'remote',clock,ids,queries,commands,ingest: createHttpIngest(ports.ingest,http),generation: generation.service,render,export: exporter,assets,audit,
    visuals: createHttpVisualLibrary(http),
    imageGeneration: createHttpImageGenerator(http),
    citations: createHttpCitationLibrary(http),
    memory: createHttpMemoryLibrary(http, () => refresh(true)),
    news: createHttpNewsIntake(http),
    pipeline: { get: () => http.request<PipelineView>('/pipeline'), save: (definition,baseRevision) => rpc('pipeline.save',[definition,baseRevision]),
      getWritingRun: runId => http.request<WritingRunDetails>(`/pipeline/runs/${encodeURIComponent(runId)}`) },
    session: {
      mode: 'remote',
      workspace: async () => { await ready; return ports.session.workspace(); },
      current: async () => { await ready; return ports.session.current(); },
      members: async () => { await ready; return ports.session.members(); },
      localRoleProfiles: async () => { await ready; return options.viewId?[]:editorialLocalRoleProfiles(ports.store.state); },
      selectLocalRole: profile => rpc('session.selectLocalRole', [profile]),
      updateProfile: async patch => {
        const valid = validateProfilePatch(patch);
        return valid.ok ? profileWrite(() => http.request('/profile',valid.value)) : valid;
      },
      setAvatar: async input => {
        if (!input) return profileWrite(() => http.request('/profile',{ avatar: null }));
        const image = await avatarImage(input);
        return image.ok ? profileWrite(() => http.upload('/profile/avatar',image.value)) : image;
      },
      subscribe: ports.session.subscribe,
    },
    feedback: { record: input => rpc('recordFeedback',[input]),vote: input => rpc('feedback.vote',[input]),list: async query => { await ready; return ports.feedback.list(query); } },
    saveStatus: { current: readSave,subscribe(listener) { saveListeners.add(listener); return () => { saveListeners.delete(listener); }; },async retry() {
      try {
        await writeTail;
        if(!(await assets.settle()))return refuse('save_failed','Tente enviar a imagem novamente antes de sair.');
        if (failedWrite) { await http.request('/workspace',failedWrite); failedWrite = undefined; }
        await refresh(true); setSave({ scope: 'remote',status: 'saved',savedAt: clock.now() }); return ok(save);
      } catch { return refuse('save_failed','Servidor indisponível. Suas alterações não foram descartadas.'); }
    } },
    tabs: { current: () => activeTab,subscribe: () => () => {},claim: () => { void refresh(); } },
    usedAssetIds: () => usedAssetIds(ports.store.state.productions),ready,subscribe: ports.store.subscribe,flush: () => {},
    async settle(){let tail;do{tail=writeTail;await Promise.all([tail,assets.settle()]);await Promise.resolve();}while(tail!==writeTail||assets.pending());return !disposed&&readSave().status!=='error';},
    onInvalidated(listener){contextListeners.add(listener);return()=>{contextListeners.delete(listener);};},
    dispose() { if(current.navigation?.view)void memberViewing.end(current.navigation.view.id,'workspace_changed');disposed = true;for(const dispose of imageDisposers)dispose();imageDisposers.clear(); for(const image of logos.values())void image.then(result=>{if(result.ok)(result.value.source as {close?:()=>void}).close?.();});logos.clear();contextListeners.clear(); http.dispose();directoryHttp.dispose();globalThis.document?.removeEventListener('visibilitychange',resumed); rejectAssetNamespace(new DOMException('Context closed','AbortError')); clearInterval(timer); generation.dispose(); unwatchAssets(); assets.dispose(); audit.dispose(); ports.store.dispose(); saveListeners.clear(); },
  };
}
