import { createEditorialEngine, editorialLocalRoleProfiles, emptyEditorialCheckpoint, LOCAL_OPERATOR, LOCAL_WORKSPACE } from './editorial-engine.ts';
import { applyWorkspaceDelta } from './editorial-sync.ts';
import { createIndexedDbAssetStore } from '../adapters/local/assets/index.ts';
import { createLocalAudit } from '../adapters/local/audit/index.ts';
import { createLocalExportService } from '../adapters/local/export/index.ts';
import { assetCoverLoader, createLocalRenderService, servedCoverLoader } from '../adapters/local/render/index.ts';
import { isForbidden, ReporterHttpError, reporterRequest, reporterUpload, requestWorkspace, createHttpGeneration, createHttpIngest } from '../adapters/http/reporter-client.ts';
import { avatarImage } from '../adapters/local/assets/avatar-image.ts';
import { createHttpImageGenerator, createHttpVisualLibrary } from '../adapters/http/visual-library.ts';
import { createHttpCitationLibrary } from '../adapters/http/citation-library.ts';
import { createHttpNewsIntake } from '../adapters/http/news-intake.ts';
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
export function createConnectedRuntime(options: { typefaces?: Readonly<Record<string,string>> } = {}): Runtime {
  const clock = { now: () => new Date().toISOString() },ids = { next: () => crypto.randomUUID() };
  let current: ConnectedWorkspace = { ...emptyEditorialCheckpoint(),revision: -1,model: '',workerOnline: false };
  // The engine reads image assets through this object, kept in step with every refresh.
  const engineCheckpoint = { ...current };
  const ports = createEditorialEngine(engineCheckpoint,ids);
  let disposed = false;
  const activeTab = Object.freeze({ status: 'active' as const });
  let lastRefresh = 0;
  let save: SaveState = { scope: 'remote',status: 'idle' };
  const saveListeners = new Set<(state: SaveState) => void>();
  const setSave = (state: SaveState) => { save = state; for (const listener of saveListeners) listener(save); };
  const localAssets = createIndexedDbAssetStore({ clock,ids,workspaceId: LOCAL_WORKSPACE,actorId: () => LOCAL_OPERATOR,reset: false });
  const assets = withServerAssets(localAssets,() => current.imageAssets ?? [],() => refresh(true),() => current.deploymentMode === 'cloud');
  const fixtures = createFixtures({ now: clock.now(),empty: true });
  const render = createLocalRenderService({ templates: fixtures.templates,renders: fixtures.templateRenders,
    descriptions: fixtures.templateDescriptions,library: fixtures.templateLibrary,fontFaces: fixtures.templateFonts,loadCover: assetCoverLoader(assets),
    coverCredit: id => creditLine(assets.get(id)?.credit),samplePhoto: { assetId: fixtures.samplePhoto.assetId,credit: fixtures.samplePhoto.credit,load: servedCoverLoader(fixtures.samplePhoto.src) },
    samplePhotos: fixtures.samplePhotos.map(photo => ({ assetId: photo.assetId,credit: photo.credit,load: servedCoverLoader(photo.src) })),typefaces: options.typefaces });
  const runActive = () => Object.values(current.state.runFolds).some(fold => isRunActive(fold.run));
  const refresh = createWorkspaceRefresh(() => requestWorkspace(current.syncToken,runActive()).then(snapshot => {
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
      const changed = snapshot.revision !== current.revision || snapshot.syncToken !== current.syncToken;
      current = snapshot;
      engineCheckpoint.imageAssets = current.imageAssets;
      assets.adoptSnapshot();
      if (changed) ports.store.transact(() => ok({ state: snapshot.state,value: undefined,persist: 'none',scope: 'external',productionIds: snapshot.state.productions.map(p => p.production.id) }));
      generation.accept(snapshot);
    }).finally(() => { lastRefresh = Date.now(); }));
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
        const result = await committedCommand(() => reporterRequest<T>('/workspace',payload),() => refresh(true));
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
  const exporter = createLocalExportService({ clock,getRecord: id => ports.records.record(id),render,assets });
  const ready = Promise.all([refresh(),assets.ready()]).then(() => undefined);
  // Polls only this application's same-origin endpoint; generation survives leaving the page.
  // A hidden tab stops polling, so a forgotten tab does not keep the database awake.
  const timer = setInterval(() => {
    if (disposed || globalThis.document?.visibilityState === 'hidden') return;
    if (Date.now()-lastRefresh >= (runActive() ? 1000 : 15000)) void refresh().catch(() => {});
  },1000);
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
  const unwatchAssets = assets.subscribe(change => { if (change.kind !== 'health') ports.store.transact(state => ok({ state,value: undefined,persist: 'none',scope: 'assets',productionIds: change.productionIds })); });
  return {
    mode: 'remote',clock,ids,queries,commands,ingest: createHttpIngest(ports.ingest),generation: generation.service,render,export: exporter,assets,audit,
    visuals: createHttpVisualLibrary(),
    imageGeneration: createHttpImageGenerator(),
    citations: createHttpCitationLibrary(),
    news: createHttpNewsIntake(),
    pipeline: { get: () => reporterRequest<PipelineView>('/pipeline'), save: (definition,baseRevision) => rpc('pipeline.save',[definition,baseRevision]),
      getWritingRun: runId => reporterRequest<WritingRunDetails>(`/pipeline/runs/${encodeURIComponent(runId)}`) },
    session: {
      mode: 'remote',
      workspace: async () => { await ready; return ports.session.workspace(); },
      current: async () => { await ready; return ports.session.current(); },
      members: async () => { await ready; return ports.session.members(); },
      localRoleProfiles: async () => { await ready; return editorialLocalRoleProfiles(ports.store.state); },
      selectLocalRole: profile => rpc('session.selectLocalRole', [profile]),
      updateProfile: async patch => {
        const valid = validateProfilePatch(patch);
        return valid.ok ? profileWrite(() => reporterRequest('/profile',valid.value)) : valid;
      },
      setAvatar: async input => {
        if (!input) return profileWrite(() => reporterRequest('/profile',{ avatar: null }));
        const image = await avatarImage(input);
        return image.ok ? profileWrite(() => reporterUpload('/profile/avatar',image.value)) : image;
      },
      subscribe: ports.session.subscribe,
    },
    feedback: { record: input => rpc('recordFeedback',[input]),vote: input => rpc('feedback.vote',[input]),list: async query => { await ready; return ports.feedback.list(query); } },
    saveStatus: { current: () => save,subscribe(listener) { saveListeners.add(listener); return () => { saveListeners.delete(listener); }; },async retry() {
      try {
        await writeTail;
        if (failedWrite) { await reporterRequest('/workspace',failedWrite); failedWrite = undefined; }
        await refresh(true); setSave({ scope: 'remote',status: 'saved',savedAt: clock.now() }); return ok(save);
      } catch { return refuse('save_failed','Servidor indisponível. Suas alterações não foram descartadas.'); }
    } },
    tabs: { current: () => activeTab,subscribe: () => () => {},claim: () => { void refresh(); } },
    usedAssetIds: () => usedAssetIds(ports.store.state.productions),ready,subscribe: ports.store.subscribe,flush: () => {},
    dispose() { disposed = true; clearInterval(timer); generation.dispose(); unwatchAssets(); assets.dispose(); audit.dispose(); ports.store.dispose(); saveListeners.clear(); },
  };
}
