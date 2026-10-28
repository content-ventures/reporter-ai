import 'server-only';
import { syncMemoryWriting } from './editorial-memory-usage.ts';
import { guardMemoryCommand, guardMemorySources } from './editorial-memory-operation.ts';
// Worker helpers share this server composition boundary with the transactional engine.
export { appendEditorialEvent, editorialContextHash } from '../runtime/editorial-engine.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { createEditorialEngine, emptyEditorialCheckpoint, adoptEditorialIdentity, appendEditorialEvent, validateEditorialOutline, editorialContextHash, selectEditorialLocalRole,
  assembleCheckpoint, diffRows, hasChanges, splitCheckpoint } from '../runtime/editorial-engine.ts';
import { contentHash } from '../domain/text/hash.ts';
import { reviseEditorialPolicy } from '../domain/editorial-policy.ts';
import { accountAvatarSource } from '../domain/profile.ts';
import { compactFunnels, formatPipelineDefinition, pipelineRevision, pipelineRunSteps, pipelineModelLabel, pipelineModelProvider } from '../domain/pipeline.ts';
import { isRunActive } from '../domain/run.ts';
import { pendingReview, latestApproved } from '../domain/record.ts';
import { sameVersionRef } from '../domain/refs.ts';
import { ok, refuse } from '../domain/result.ts';
import { can, forbidden, type Capability } from '../domain/permissions.ts';
import { GENERATION_LABELS, RUN_KIND_OF, GENERATION_KINDS } from '../ports/generation.ts';
import type { GenerationKind, GenerationRequest, RunMeta } from '../ports/generation.ts';
import type { OutlineInput } from '../ports/generation.ts';
import type { EditorialCheckpoint, ConnectedWorkspace, EditorialJob, WorkspaceRefresh } from '../ports/connected-workspace.ts';
import {effectiveWorkspaceRollout} from './workspace-activation.ts';
import type { WritingRunDetails } from '../ports/pipeline-settings.ts';
import { transaction, databaseNow } from './database';
import { workerAvailable } from './storage';
import { IDLE_QUEUE, queueStatus } from './queue-status.ts';
import { FlowError, forbiddenError } from './errors';
import { activePipeline, pipelineView, parsePipelineDefinition, requiredGenerationModels } from './pipeline';
import { assertLocalMode, cloudPortalId, localContext, providerConfigured } from './config';
import { r1ArticleIssue, articlePolicyMessage } from '../domain/article-policy.ts';
import { articleGateFor, EDITORIAL_FORMATS, EVENT_FIELDS, EVENT_FIELD_MAX } from '../domain/formats.ts';
import { articleGateForPiece } from '../domain/article-generation-policy.ts';
import { effectiveWritingMinimumQuotes } from '../domain/writing-orchestration.ts';
import { ARTICLE_ASSIST_KINDS, validateArticleAssistInput } from './article-assist';
import { citationDay, podcastLink } from '../domain/citation-library.ts';
import { currentReporterContext } from './request-context.ts';
import { requireWorkerContext } from './worker-context.ts';
import { isPreservedPilot } from '../domain/workspace-pilot.ts';
import type { EditorialIdentity } from '../runtime/editorial-engine.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { compactRunPreviews } from '../domain/run-events.ts';
import { FULL_SCOPE, commitEditorialChanges, loadEditorialRows, loadedScope, type EditorialScope, type StoredReceipt } from './editorial-store.ts';
import { scopeForRpc } from './editorial-scope.ts';
import { syncLegacyMemory } from './editorial-memory-legacy.ts';
import { syncMemoryArticles } from './editorial-memory-articles.ts';
import { materialPartsSchema, materialTranscriptIds } from './material-parts.ts';
import { writingRunModel, writingTraceUsage } from '../domain/writing-execution.ts';
import {workspaceTemplateHash} from '../domain/workspace-templates.ts';
import {memberViewImageSource} from '../domain/member-view.ts';
import {readWorkspaceTemplates,referencedTemplateHashes} from './template-settings.ts';
import {workspaceTemplateLibrary} from '../runtime/editorial-engine.ts';

const ids = { next: () => randomUUID() };
const identifier = z.string().min(1).max(128);
const rpcSchema = z.object({ method: z.string().min(1).max(80), args: z.array(z.json()).max(8),requestId: z.string().uuid() }).strict();
const supportedKinds = new Set(['article.outline', 'article.draft', 'carousel.copy', ...ARTICLE_ASSIST_KINDS]);
/**
 * What each command needs beyond membership. The store commands check it again (the simulated
 * runtime runs the same ones); `decide` (gate roles), `withdrawReview` (the sender) and
 * `updatePerson` (one's own profile) keep their own rules there.
 */
const COMMAND_CAPABILITY: Readonly<Record<string, Capability>> = {
  createFromSource: 'production.create', createBlank: 'production.create', rename: 'production.edit', updateBrief: 'production.edit',
  updateSpeakers: 'production.edit', updateSourceRecordedOn: 'production.edit', setMaterialAuthorization: 'production.edit', archive: 'production.archive',
  saveDraft: 'piece.edit', createVersion: 'piece.edit', restoreVersion: 'piece.edit', derive: 'piece.edit', decideSuggestion: 'piece.edit',
  requestReview: 'piece.send', recordDelivery: 'delivery.record', recordFeedback: 'feedback.record', 'feedback.vote': 'feedback.record',
  'pipeline.save': 'pipeline.edit', 'generation.start': 'piece.edit', 'generation.retry': 'piece.edit', 'generation.cancel': 'piece.edit',
};
const writes = new Set(['createFromSource', 'createBlank', 'rename', 'updateBrief', 'updateSpeakers', 'updateSourceRecordedOn', 'updatePerson', 'setMaterialAuthorization',
  'saveDraft', 'createVersion', 'restoreVersion', 'requestReview', 'withdrawReview', 'decide', 'derive', 'decideSuggestion', 'recordDelivery', 'archive', 'recordFeedback']);

/** A settings acknowledgment must not duplicate the entire prompt history in every receipt. */
export function editorialReceipt(method: string,hash: string,result: unknown,revision: number) {
  return method === 'pipeline.save' && (result as { ok?: boolean })?.ok
    ? { hash,result: ok({ savedRevision: revision }),projection: 'pipeline' as const }
    : { hash,result };
}

type Loaded = { receipt: StoredReceipt | null };
type ReceiptOf<T> = (value: T, checkpoint: EditorialCheckpoint) => { requestId: string; value: StoredReceipt } | undefined;
// A duplicate command receipt (40001) or a lock cycle (40P01) rolled everything back: the
// rerun either replays the stored receipt or redoes the command on fresh rows.
const RERUN_CODES = new Set(['40001', '40P01']);
const EDITORIAL_ATTEMPTS = 3;

/**
 * Loads the rows a scope names, runs the unchanged engine on the state they assemble and,
 * when `mutate`, writes back only the rows whose content changed (plus an optional receipt).
 */
export async function editorialTransaction<T>(role: 'runtime' | 'worker', change: (
  checkpoint: EditorialCheckpoint, engine: ReturnType<typeof createEditorialEngine>, client: PoolClient, loaded: Loaded,
) => Promise<T>, mutate = true, permission: 'reporter.edit' | 'reporter.review' = 'reporter.edit', scope: EditorialScope = FULL_SCOPE,
options: { receipt?: ReceiptOf<T> } = {}): Promise<{ value: T; revision: number; checkpoint: EditorialCheckpoint }> {
  for (let attempt = 1; ; attempt++) {
    try { return await editorialAttempt(role, change, mutate, permission, scope, options); }
    catch (error) {
      if (attempt >= EDITORIAL_ATTEMPTS || !RERUN_CODES.has(String((error as { code?: unknown }).code))) throw error;
    }
  }
}

async function editorialAttempt<T>(role: 'runtime' | 'worker', change: (
  checkpoint: EditorialCheckpoint, engine: ReturnType<typeof createEditorialEngine>, client: PoolClient, loaded: Loaded,
) => Promise<T>, mutate: boolean, permission: 'reporter.edit' | 'reporter.review', scope: EditorialScope,
options: { receipt?: ReceiptOf<T> }): Promise<{ value: T; revision: number; checkpoint: EditorialCheckpoint }> {
  return transaction(role, async client => {
    if (role === 'runtime') await client.query("SELECT set_config('app.editorial_permission',$1,true)",[permission]);
    const { rows, receipt } = await loadEditorialRows(client, scope, mutate);
    const loaded = loadedScope(scope);
    // The diff baseline must not share objects with what the command edits in place (a job's
    // call list, an asset's credit), or those edits would look unchanged and never be written.
    const baseline = mutate ? structuredClone(rows) : rows;
    const context = role === 'runtime' ? currentReporterContext() : undefined;
    let identity: EditorialIdentity | undefined = context ? { workspaceId: context.portal,workspaceName: context.workspaceName,workspaceSlug: context.workspaceSlug,
      personId: context.actor,name: context.name,email: context.email,avatarUrl: context.image,roles: context.roles,
      ...(reporterDeploymentMode() === 'local'&&!context.view ? { localOperator: true as const } : {}) } : undefined;
    const fallback = emptyEditorialCheckpoint(identity).state.workspace;
    const checkpoint = assembleCheckpoint(rows, fallback, loaded);
    if (role==='worker') {
      const worker=requireWorkerContext();
      if (checkpoint.state.workspace.id!==worker.portal) throw new FlowError('JOB_CONTEXT_MISMATCH',422);
      const runId=scope.runs && scope.runs!=='none' && scope.runs.length===1 ? scope.runs[0] : undefined;
      const actor=worker.actor ?? (runId ? checkpoint.state.runFolds[runId]?.run.createdBy : undefined);
      if (actor) checkpoint.state.sessionPersonId=actor;
    }
    if (identity && reporterDeploymentMode() === 'cloud') {
      const members=(await client.query('SELECT public.reporter_workspace_members() AS members')).rows[0].members as EditorialIdentity[];
      checkpoint.state.members=[];
      for(const member of members) adoptEditorialIdentity(checkpoint,{ ...member,avatarUrl: accountAvatarSource(member.personId,member.avatarUrl,cloudPortalId()) });
      // The cargo lives only in the members list; the session context carries name and photo.
      identity = { ...identity,title: members.find(member => member.personId === identity!.personId)?.title };
    }
    if (identity && reporterDeploymentMode() === 'local') {
      // The local operator is a server constant until it edits its own profile ("Meu perfil").
      const profile = (await client.query('SELECT public.reporter_profile() AS value')).rows[0]?.value as
        { name: string; title: string | null; image: string | null; updatedAt: string | null } | null;
      if (profile?.updatedAt) identity = { ...identity,name: profile.name,title: profile.title,
        avatarUrl: accountAvatarSource(identity.personId,profile.image ?? undefined,localContext.portal) };
    }
    if (identity) adoptEditorialIdentity(checkpoint,identity);
    if(context?.view){
      for(const member of checkpoint.state.members){delete member.localOperator;if(member.personId===context.actor)member.readOnly=true;}
      for(const person of checkpoint.state.people)person.avatarUrl=memberViewImageSource(context.view.id,person.avatarUrl);
    }
    if(scope.templates)checkpoint.templateConfiguration=await readWorkspaceTemplates(client,checkpoint.state.workspace.id,referencedTemplateHashes(checkpoint));
    for (const job of Object.values(checkpoint.jobs)) job.events = compactRunPreviews(job.events);
    const engine = createEditorialEngine(checkpoint, ids);
    try {
      const value = await change(checkpoint, engine, client, { receipt });
      checkpoint.state = engine.store.state;
      let revision = rows.seq;
      if (mutate) {
        const changes = diffRows(baseline, splitCheckpoint(checkpoint, baseline, loaded), loaded);
        const stored = options.receipt?.(value, checkpoint);
        if (hasChanges(changes) || stored) revision = await commitEditorialChanges(client, changes, stored);
        await syncLegacyMemory(client, changes.items.filter(item => !item.deleted && ['citation','fact_check'].includes(item.kind)).map(item => item.id), changes.sources.map(source => source.id));
        await syncMemoryArticles(client, changes);
        await syncMemoryWriting(client, changes);
      }
      return { value, revision, checkpoint };
    } finally { engine.store.dispose(); }
  });
}

// The browser reads every production and the active runs' streams; never job internals.
const SNAPSHOT_SCOPE: EditorialScope = { productions: 'all', sources: 'all', events: 'active', jobs: false,templates:true,
  items: { person: 'all', member: 'all', activity: 'all', feedback: 'all', image_asset: 'all' } };
type Status = { seq: number; floor: number; membersHash: string };

/** `v2.<change number>.<identity scope>`: unchanged, a delta since that number, or a snapshot. */
function parseToken(token: string | undefined) {
  const match = token ? /^v2\.(\d+)\.([a-f0-9]+)$/.exec(token) : null;
  return match ? { seq: Number(match[1]), scope: match[2] } : undefined;
}

export async function editorialWorkspace(): Promise<ConnectedWorkspace>;
export async function editorialWorkspace(since: string | undefined, options?: { active?: boolean }): Promise<WorkspaceRefresh>;
export async function editorialWorkspace(since?: string, options: { active?: boolean } = {}): Promise<WorkspaceRefresh> {
  // The queue is read only while the browser follows a run, so idle polls stay a single stamp.
  const { status, queue } = await transaction('runtime', async client => ({
    status: (await client.query('SELECT public.reporter_ed_status() AS value')).rows[0].value as Status,
    queue: options.active ? await queueStatus(client, 'editorial') : IDLE_QUEUE,
  }));
  const workerOnline = await workerAvailable();
  const context=currentReporterContext(),rollout=context.rollout??await effectiveWorkspaceRollout();
  // A shrinking support-view lifetime must not turn every idle poll into a full snapshot.
  const stableContext=context.view?{...context,view:{...context.view,remainingMs:0}}:context;
  const scope = contentHash({ membersHash: status.membersHash,context: stableContext,rollout });
  const token = (seq: number) => `v2.${seq}.${scope}`;
  const seq = Number(status.seq);
  if (since === token(seq)) return { unchanged: true,revision: seq,syncToken: token(seq),workerOnline,stalled: queue.stalled };
  const known = parseToken(since);
  if (known && known.scope === scope && known.seq >= Number(status.floor) && known.seq < seq) {
    const delta = await transaction('runtime', async client => (await client.query('SELECT public.reporter_ed_changes($1) AS value',[known.seq])).rows[0].value);
    // A workspace change (pipeline, name) is rare: send a snapshot rather than merging it.
    if (!delta.workspace) return { delta: true,...delta,revision: Number(delta.seq),syncToken: token(Number(delta.seq)),workerOnline,stalled: queue.stalled };
  }
  const result = await editorialTransaction('runtime', async (_checkpoint,_engine,client)=>(await client.query('SELECT public.reporter_navigation_identity() AS value')).rows[0].value as {accountId:string;administrative:boolean}, false, 'reporter.edit', SNAPSHOT_SCOPE);
  const navigation=result.value;
  const jobs = Object.fromEntries(Object.entries(result.checkpoint.jobs).map(([id,job]) => [id,{ meta: job.meta,kind: job.kind,events: job.events }])) as EditorialCheckpoint['jobs'];
  return { state: result.checkpoint.state,jobs,templateConfiguration:result.checkpoint.templateConfiguration,imageAssets: result.checkpoint.imageAssets ?? [],revision: result.revision,syncToken: token(result.revision),
    model: activePipeline(result.checkpoint).definition.steps.outline.model,workerOnline,stalled: queue.stalled,deploymentMode:reporterDeploymentMode(),
    navigation:{...navigation,enabled:rollout==='all'||rollout==='admin'&&navigation.administrative,
      ...(currentReporterContext().view?{view:currentReporterContext().view}:{})} };
}

export async function editorialPipeline() {
  return (await editorialTransaction('runtime',async checkpoint => pipelineView(checkpoint),false,'reporter.edit',{ history: true,recentRuns: 20 })).value;
}

/** Full editorial traces are an admin-only, tenant-scoped read of one immutable run. */
export async function editorialWritingRun(runId: string): Promise<WritingRunDetails> {
  const id = identifier.parse(runId);
  return (await editorialTransaction('runtime', async checkpoint => {
    assertCapability(checkpoint, 'audit.read');
    const job = checkpoint.jobs[id], fold = checkpoint.state.runFolds[id];
    if (!job?.pipeline || !fold) throw new FlowError('WRITING_RUN_NOT_FOUND', 404);
    return { runId: id, productionId: job.meta.productionId, status: fold.run.status,
      pipeline: job.pipeline, traces: job.writingTraces ?? [], ...(fold.run.error ? { error: fold.run.error.message } : {}) };
  }, false, 'reporter.edit', { runs: [id], sources: 'none', parts: [], jobs: true })).value;
}

function validateDraft(value: unknown) {
  const body = z.object({ type: z.enum(['article', 'carousel']) }).passthrough().parse(value);
  if (body.type === 'article') {
    z.object({ title: z.string().max(500), blocks: z.array(z.object({ id: identifier,
      type: z.enum(['paragraph','heading','quote','list','divider','figure']) }).passthrough()).max(1000) }).passthrough().parse(value);
    for (const block of (value as { blocks: Record<string, unknown>[] }).blocks) {
      if (['paragraph','heading','quote'].includes(String(block.type))) z.array(z.object({ text: z.string().max(200000) }).passthrough()).max(1000).parse(block.inlines);
      if (block.type === 'list') z.array(z.array(z.object({ text: z.string().max(200000) }).passthrough()).max(1000)).max(1000).parse(block.items);
      if (block.type === 'figure' && !block.image && !block.slot) throw new FlowError('INVALID_INPUT', 422);
      if (block.type === 'heading') z.union([z.literal(2), z.literal(3)]).parse(block.level);
    }
  } else z.object({ templateId: identifier, slides: z.array(z.object({ id: identifier, layout: identifier,
    slots: z.record(identifier,z.string().max(20000)), sourceBlockIds: z.array(identifier).max(1000) }).passthrough()).max(20) }).passthrough().parse(value);
}

/** The approved command port has positional IDs, object inputs and an array input. */
export function validateEditorialCommandInput(method: string, args: unknown[]) {
  const objectInputs = new Set(['createFromSource', 'createBlank', 'decide', 'derive', 'recordDelivery', 'recordFeedback']);
  if (method === 'archive') z.array(identifier).min(1).max(1000).parse(args[0]);
  else if (!objectInputs.has(method)) identifier.parse(args[0]);
  if (method === 'saveDraft') { validateDraft(args[1]); z.number().int().nonnegative().parse(args[2]); }
  if (method === 'updateSourceRecordedOn') z.tuple([identifier, z.string().max(10).nullable(), z.string().max(10).nullable()]).parse(args);
  if (method === 'recordDelivery') {
    const version = z.object({ kind: z.literal('version'),pieceId: identifier,versionId: identifier,
      number: z.number().int().positive(),hash: identifier }).strict();
    z.object({ productionId: identifier,selection: z.array(version).min(1).max(20),
      mode: z.literal('download').optional(),files: z.array(z.object({
        fileName: z.string().min(1).max(512),format: z.enum(['md','html','png','pdf','json','txt','docx','jpg','webp','gif']),
        versionId: identifier.optional(),ok: z.boolean(),
        error: z.object({ code: z.string().max(128),message: z.string().max(2000) }).strict().optional(),
      }).strict()).min(1).max(2000),
    }).strict().parse(args[0]);
  }
}

function sessionMember(checkpoint: EditorialCheckpoint) {
  return checkpoint.state.members.find(candidate => candidate.personId === checkpoint.state.sessionPersonId);
}

/** Throws FORBIDDEN unless the acting member (locally: the stored test profile) holds the capability. */
export function assertCapability(checkpoint: EditorialCheckpoint, capability: Capability) {
  if (!can(sessionMember(checkpoint), capability)) throw forbiddenError(capability);
}

/**
 * For routes outside the engine (uploads, links, material analysis): the request context always
 * carries every role locally, so the effective roles come from the loaded member row.
 */
export async function requireCapability(capability: Capability) {
  await editorialTransaction('runtime', async checkpoint => assertCapability(checkpoint, capability), false, 'reporter.edit', { pipelines: false });
}

async function startJob(checkpoint: EditorialCheckpoint, engine: ReturnType<typeof createEditorialEngine>, client:PoolClient,kind: GenerationKind, input: Record<string, unknown>, retryOfRunId?: string) {
  if (!supportedKinds.has(kind)) return refuse('unsupported_action', 'Esta ação do copiloto ainda não está conectada. Use a geração de artigo ou carrossel.');
  if(!isPreservedPilot(checkpoint.state.workspace.id)&&!checkpoint.templateConfiguration?.readiness.ready){
    const names={editorial_map:'mapa editorial',writing_guide:'guia de escrita',templates:'modelos',editor:'editor ativo',approver:'aprovador ativo'};
    return refuse('workspace_not_ready','Configure este workspace antes de gerar: '+(checkpoint.templateConfiguration?.readiness.missing.map(key=>names[key]).join(', ')??'configuração editorial')+'.');
  }
  const productionId = identifier.parse(input.productionId), pieceId = identifier.parse(input.pieceId);
  const record = engine.records.record(productionId);
  if (!record) return refuse('unknown_production', 'Produção não encontrada.');
  const memory = await guardMemorySources(client, record);
  if (!memory.ok) return refuse('memory_not_ready', memory.refusal.message);
  const piece = record.pieces.find(p => p.id === pieceId);
  if (!piece || piece.kind !== (kind.startsWith('carousel') ? 'carousel' : 'article')) return refuse('unknown_piece', 'Peça não encontrada.');
  if (pendingReview(record,pieceId)) return refuse('locked','Retire o envio para editar antes de gerar.');
  if (['article.outline', 'article.draft'].includes(kind) && !record.production.brief.format && record.production.brief.size !== 'standard')
    return refuse('unsupported_size', 'A R1 exige Padrão: 2.500–4.000 caracteres e 500–800 palavras. Altere o tamanho na pauta antes de gerar.');
  if (kind === 'article.draft' && input.outline) {
    const valid = validateEditorialOutline(record,input.outline as OutlineInput);
    if (!valid.ok) return valid;
    input = { ...input,outline: { ...input.outline as object,title: valid.value.title,
      intro: { quotes: valid.value.intro },sections: valid.value.sections } };
  }
  if (kind === 'carousel.copy') {
    const approved = latestApproved(record,record.pieces.find(p => p.kind === 'article')?.id ?? '');
    if (!approved || (input.from && !sameVersionRef(approved.ref, input.from as typeof approved.ref))) return refuse('parent_not_ready','Aprove a versão exata do artigo antes de gerar o carrossel.');
  }
  if (ARTICLE_ASSIST_KINDS.has(kind)) {
    const valid = validateArticleAssistInput(record,pieceId,kind,input);
    if (!valid.ok) return valid;
  }
  const active = structuredClone(activePipeline(checkpoint));
  // An event format writes with its own funnel prompts; the workspace keeps its saved revision.
  const format = ['article.outline', 'article.draft'].includes(kind) ? record.production.brief.format : undefined;
  const pipeline = format ? pipelineRevision(formatPipelineDefinition(active.definition,format),active.revision,active.savedAt) : active;
  if (ARTICLE_ASSIST_KINDS.has(kind) && !pipeline.definition.steps.assist)
    return refuse('provider_unavailable', 'Ative a etapa Assistente em Prompts antes de pedir ajustes.');
  const automaticOutline = kind === 'article.draft' && !input.outline;
  const missing = requiredGenerationModels(pipeline.definition,kind,automaticOutline).find(model => !providerConfigured(pipelineModelProvider(model)));
  if (missing) return refuse('provider_unavailable', 'Configure a chave de ' + pipelineModelLabel(missing) + ' no servidor antes de gerar.');
  checkpoint.pipeline ??= active;
  const prompt = { key: 'reporter.pipeline.' + kind, version: String(pipeline.revision), hash: pipeline.hash };
  const model = kind === 'article.draft' && pipeline.definition.writing?.enabled ? pipeline.definition.writing.stages.write.model
    : pipeline.definition.steps[ARTICLE_ASSIST_KINDS.has(kind) ? 'assist' : kind === 'carousel.copy' ? 'carousel' : kind === 'article.outline' ? 'outline' : pipeline.definition.articleMode === 'single' ? 'article' : 'intro'].model;
  const templateHash=piece.draft.body.type==='carousel'?workspaceTemplateHash(piece.draft.body.templateId,checkpoint.state.workspace.id):undefined;
  const template=[checkpoint.templateConfiguration?.active,...(checkpoint.templateConfiguration?.history??[])].find(entry=>entry?.hash===templateHash);
  if(piece.draft.body.type==='carousel'&&!isPreservedPilot(checkpoint.state.workspace.id)&&!template)return refuse('unknown_template','Escolha um modelo deste workspace.');
  const started = engine.runs.begin({ productionId, kind: RUN_KIND_OF[kind], prompt,
    ...(retryOfRunId ? { retryOfRunId } : {}),
    model: kind === 'article.draft' && pipeline.definition.writing?.enabled ? writingRunModel(pipeline.definition.writing, pipeline.revision)
      : { alias: model, label: pipelineModelLabel(model) + ' · pipeline v' + pipeline.revision, engine: 'provider' },
    steps: pipelineRunSteps(pipeline.definition,kind,record.production.brief.sections,automaticOutline),
  });
  if (!started.ok) return started;
  const run = started.value.run;
  const meta: RunMeta = { runId: run.id, productionId, pieceId, label: GENERATION_LABELS[kind], request: { kind, input } as GenerationRequest };
  const context=currentReporterContext();
  const job: EditorialJob = { meta,kind,input: meta.request.input,events: [],attempts: 0,availableAt: await databaseNow(client),
    context:{tenant:context.tenant,workspace:context.portal,actor:context.actor},contextHash: editorialContextHash(record,pieceId,run.inputs),pipeline,calls: [] };
  if(template)job.template=structuredClone(template);
  const previous = retryOfRunId ? checkpoint.jobs[retryOfRunId] : undefined;
  if (previous?.contextHash === job.contextHash && previous?.pipeline?.hash === pipeline.hash && previous.kind === kind)
    job.cacheSourceRunId = previous.meta.runId;
  checkpoint.jobs[run.id] = job;
  appendEditorialEvent(engine,job,{ type: 'run.started', kind: run.kind, productionId,pieceId,prompt,model: run.model,
    configuration:{workspaceId:context.portal,pipeline:{hash:pipeline.hash,revision:pipeline.revision},
      editorial:{mapVersion:pipeline.definition.editorial?.map.version??0,guideVersion:pipeline.definition.editorial?.guide.version??0},
      ...(piece.draft.body.type==='carousel'?{template:{id:piece.draft.body.templateId,...(template?{hash:template.hash,revision:template.revision}:{})}}:{})},
    ...(kind === 'article.draft' && pipeline.definition.writing?.enabled
      ? { articlePolicy: { minimumQuotes: effectiveWritingMinimumQuotes(pipeline.definition.writing, articleGateFor(record.production.brief).minQuotes) } } : {}),
    inputs: run.inputs,steps: run.steps.map(s => ({ id: s.id,label: s.label })),createdBy: engine.store.state.sessionPersonId,
    ...(retryOfRunId ? { retryOfRunId } : {}) });
  return ok({ runId: run.id });
}

export async function editorialRpc(payload: unknown) {
  const { method,args,requestId } = rpcSchema.parse(payload);
  if (['generation.start', 'generation.retry'].includes(method) && !await workerAvailable()) {
    return refuse('provider_unavailable', 'Inicie o worker do Reporter IA antes de gerar.');
  }
  const hash = contentHash({ method,args });
  let replayed = false;
  return (await editorialTransaction('runtime', async (checkpoint,engine,client,{ receipt }) => {
    if (receipt) {
      if (receipt.hash !== hash) throw new FlowError('IDEMPOTENCY_CONFLICT',409);
      replayed = true;
      return receipt.projection === 'pipeline' ? ok(pipelineView(checkpoint)) : receipt.result;
    }
    const execute = async () => {
    const capability = COMMAND_CAPABILITY[method];
    if (capability && !can(sessionMember(checkpoint), capability)) return forbidden(capability);
    if (method === 'session.selectLocalRole') {
      if (reporterDeploymentMode() !== 'local') return refuse('not_local_operator','Testar perfis só está disponível no ambiente local.');
      assertLocalMode();
      const [profile] = z.tuple([z.enum(['all', 'editor', 'approver', 'creative_reviewer', 'admin'])]).parse(args);
      return selectEditorialLocalRole(engine, profile);
    }
    if (method === 'pipeline.save') {
      const baseRevision = z.number().int().positive().parse(args[1]);
      const active = activePipeline(checkpoint);
      if (active.revision !== baseRevision) return refuse('conflict','A configuração foi alterada em outra aba. Recarregue antes de salvar.');
      const parsed = parsePipelineDefinition(args[0]);
      if (!parsed.definition) return refuse('invalid_config',parsed.error!);
      if(!isPreservedPilot(checkpoint.state.workspace.id))parsed.definition.funnelPreset='neutral-v1';
      // Clients opened before orchestration existed may save unrelated settings without it.
      if (!parsed.definition.writing && active.definition.writing)
        parsed.definition.writing = structuredClone(active.definition.writing);
      else if (parsed.definition.writing && !parsed.definition.writing.reviewCriteria && active.definition.writing?.reviewCriteria)
        parsed.definition.writing.reviewCriteria = structuredClone(active.definition.writing.reviewCriteria);
      if (parsed.definition.writing && parsed.definition.writing.minimumQuotes === undefined && active.definition.writing?.minimumQuotes !== undefined)
        parsed.definition.writing.minimumQuotes = active.definition.writing.minimumQuotes;
      if (parsed.definition.writing && !parsed.definition.writing.research && active.definition.writing?.research)
        parsed.definition.writing.research = structuredClone(active.definition.writing.research);
      const savedAt = new Date().toISOString();
      const actor = checkpoint.state.people.find(person => person.id === checkpoint.state.sessionPersonId);
      const editorial = reviseEditorialPolicy(active.definition.editorial, parsed.definition.editorial,
        { at: savedAt, by: actor?.name ?? checkpoint.state.sessionPersonId });
      if (editorial) parsed.definition.editorial = editorial;
      else delete parsed.definition.editorial;
      // Funnel prompts equal to the defaults are not stored; they are filled in at run time.
      const next = pipelineRevision(compactFunnels(parsed.definition),active.revision+1,savedAt);
      if (next.hash === active.hash) return ok(pipelineView(checkpoint));
      checkpoint.pipelineHistory = [...(checkpoint.pipelineHistory ?? []),active].slice(-20);
      checkpoint.pipeline = next;
      return ok(pipelineView(checkpoint));
    }
    if (method === 'generation.start') return startJob(checkpoint,engine,client,z.enum(GENERATION_KINDS as [GenerationKind,...GenerationKind[]]).parse(args[0]),z.record(z.string(),z.json()).parse(args[1]));
    if (method === 'generation.cancel') {
      const id = identifier.parse(args[0]), job = checkpoint.jobs[id], fold = engine.store.state.runFolds[id];
      if (!job || !fold) return refuse('unknown_run','Geração não encontrada.');
      if (!isRunActive(fold.run)) return refuse('not_running','Esta geração já terminou.');
      delete job.lease;
      const completedAt = new Date().toISOString();
      job.writingTraces = job.writingTraces?.map(trace => trace.status === 'running'
        ? { ...trace, status: 'failed', error: 'JOB_INTERRUPTED', completedAt } : trace);
      const usage = writingTraceUsage(job.writingTraces ?? []);
      if (usage) appendEditorialEvent(engine, job, { type: 'usage', usage });
      return ok(appendEditorialEvent(engine,job,{ type: 'run.cancelled',reason: 'Cancelada pelo usuário.' }));
    }
    if (method === 'generation.retry') {
      const id = identifier.parse(args[0]), job = checkpoint.jobs[id], fold = engine.store.state.runFolds[id];
      if (!job || !fold) return refuse('unknown_run','Geração não encontrada.');
      if (isRunActive(fold.run)) return refuse('still_running','Esta geração ainda está em andamento.');
      if (fold.run.status === 'completed') return refuse('nothing_to_retry','Esta geração já terminou.');
      return startJob(checkpoint,engine,client,job.kind,job.input as unknown as Record<string,unknown>,id);
    }
    if (method === 'feedback.vote') return engine.feedback.vote(args[0] as Parameters<typeof engine.feedback.vote>[0]);
    if (!writes.has(method)) throw new FlowError('UNKNOWN_COMMAND',404);
    validateEditorialCommandInput(method,args);
    const config=checkpoint.templateConfiguration;
    const activeIds=config?workspaceTemplateLibrary(config).activeIds:isPreservedPilot(checkpoint.state.workspace.id)?undefined:[];
    if(method==='derive'&&(args[0] as {kind?:string}).kind==='carousel'){
      const target=(args[0] as {templateId?:string}).templateId;
      if(activeIds&&(!activeIds.length||target&&!activeIds.includes(target)))return refuse('unknown_template','Escolha um modelo ativo deste workspace.');
    }
    if(method==='saveDraft'&&(args[1] as {type?:string}).type==='carousel'){
      const target=(args[1] as {templateId:string}).templateId;
      const previous=checkpoint.state.productions.flatMap(production=>production.pieces).find(piece=>piece.id===args[0])?.draft.body;
      if(activeIds&&!(previous?.type==='carousel'&&previous.templateId===target)&&!activeIds.includes(target))
        return refuse('unknown_template','Escolha um modelo ativo deste workspace.');
    }
    if (method === 'requestReview') {
      const production = checkpoint.state.productions.find(entry => entry.pieces.some(piece => piece.id === args[0]));
      const record = production ? engine.records.record(production.production.id) : undefined;
      const piece = record?.pieces.find(piece => piece.id === args[0]);
      const body = piece?.draft.body;
      if (body?.type === 'article' && record && piece) {
        const memory = await guardMemoryCommand(client, record, method, args);
        if (!memory.ok) return refuse('memory_not_ready', memory.refusal.message);
        const limits = articleGateForPiece(record, piece, body);
        const issue = r1ArticleIssue(body, record.sources, limits);
        if (issue) return refuse('send_blocked', articlePolicyMessage(issue, limits));
      }
    }
    if (method === 'decide' || method === 'recordDelivery') {
      const input = args[0] as { pieceId?: string; productionId?: string };
      const entry = checkpoint.state.productions.find(entry => input.productionId ? entry.production.id === input.productionId : entry.pieces.some(piece => piece.id === input.pieceId));
      const record = entry ? engine.records.record(entry.production.id) : undefined;
      if (record) { const memory = await guardMemoryCommand(client, record, method, args); if (!memory.ok) return refuse('memory_not_ready', memory.refusal.message); }
    }
    if (method === 'createFromSource') {
      const input = z.object({ title: z.string().trim().min(1).max(120), material: z.object({
        text: z.string().min(1).max(1048576),authorized: z.boolean(),origin: z.enum(['interview','podcast','event','talk','other']),
        transcriptId: z.string().uuid().optional(),parts: materialPartsSchema.optional(),
        programName: z.string().trim().max(160).optional(),sourceUrl: z.string().trim().max(2000).optional(),
        location: z.string().trim().max(160).optional(),recordedOn: z.string().max(10).optional(),
      }).passthrough(), brief: z.object({ sections: z.number().int().min(1).max(8),size: z.enum(['short','standard']),angle: z.string().max(600).optional(),
        format: z.enum(EDITORIAL_FORMATS).optional(),formatSize: z.string().max(40).optional(),
        event: z.object(Object.fromEntries(EVENT_FIELDS.map(key => [key,z.string().max(EVENT_FIELD_MAX).optional()]))).strict().optional() }),
      plan: z.array(z.enum(['article','carousel'])).max(2),speakers: z.array(z.object({ label: z.string().max(500) }).passthrough()).max(100).optional() }).passthrough().parse(args[0]);
      if (!citationDay(input.material.recordedOn) || input.material.sourceUrl && !podcastLink(input.material.sourceUrl))
        throw new FlowError('CITATION_METADATA_INVALID',422);
      // Every recording of the material must be a ready transcript of this workspace.
      const ids = materialTranscriptIds(input.material);
      if (ids.length) {
        const { rows } = await client.query('SELECT status FROM public.reporter_transcripts WHERE portal_id=$2 AND id = ANY($1::uuid[])',[ids,checkpoint.state.workspace.id]);
        if (rows.length !== ids.length || rows.some(row => row.status !== 'ready')) throw new FlowError('TRANSCRIPT_NOT_READY',422);
      }
    }
    // Only named domain commands may mutate the server-owned aggregate; no snapshot upload.
    if(!isPreservedPilot(checkpoint.state.workspace.id)&&['createFromSource','updateBrief'].includes(method)){
      const brief=(method==='createFromSource'?(args[0] as {brief?:unknown}).brief:args[1]) as {event?:{name?:string;boxTitle?:string}}|undefined;
      if(brief?.event?.name&&!brief.event.boxTitle?.trim())brief.event.boxTitle=`${checkpoint.state.workspace.name} na ${brief.event.name}`;
    }
    const command = engine.commands[method as keyof typeof engine.commands] as (...args: unknown[]) => Promise<unknown>;
    return command(...args);
    };
    return await execute();
  },true,method === 'decide' ? 'reporter.review' : 'reporter.edit',{ ...scopeForRpc(method,args),receipt: requestId },{
    // Receipts make an ambiguous commit safe to retry; they expire with compaction.
    receipt: (result,checkpoint) => replayed ? undefined : { requestId,value: editorialReceipt(method,hash,result,activePipeline(checkpoint).revision) as StoredReceipt },
  })).value;
}
