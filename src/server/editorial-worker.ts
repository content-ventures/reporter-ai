import 'server-only';
import { logWorkerEvent as logEvent } from './worker-context.ts';
import { withWorkspaceWork } from './worker-dispatch.ts';
import { bindEditorialJob } from './worker-job-context.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { editorialCandidates, editorialTemplates, appendEditorialEvent, editorialContextHash, editorialCarouselLayouts, validateEditorialOutline } from '../runtime/editorial-engine.ts';
import type { RunEventPayload } from '../domain/run-events.ts';
import type { OutlineInput } from '../ports/generation.ts';
import { articlePlainText, blockText } from '../domain/article.ts';
import type { ArticleBlock } from '../domain/article.ts';
import { latestApproved } from '../domain/record.ts';
import { refKey } from '../domain/refs.ts';
import { PIPELINE_SCHEMAS, PIPELINE_SENTENCE_PATTERN, explainedRevisionCodes, pipelineModelLabel } from '../domain/pipeline.ts';
import type { PipelineVariables, PipelineStepKey, PipelineCall } from '../domain/pipeline.ts';
import { splitSource } from '../domain/reporter.ts';
import { isRunActive } from '../domain/run.ts';
import { draftSizeInstructions } from '../registries/sizing.ts';
import { editorialTransaction } from './editorial';
import { guardMemorySources } from './editorial-memory-operation.ts';
import type { EditorialScope } from './editorial-store';
import { transaction } from './database';
import { generateStructured } from './groq';
import { executePipelineStep, writeSequentialArticle, writeCompleteArticle, editorialPassageSize } from './pipeline-runner';
import { workDirectory, sourcePreparationDirectory } from './storage';
import { mapEditorialPassages } from './editorial-passages';
import { FlowError, safeCode, editorialRetryPolicy } from './errors';
import { articlePreview } from './article-preview';
import { contiguousSourcePassages, r1ArticleIssue, unquoteUnsupported, ARTICLE_POLICY_MESSAGES, articlePolicyMessage } from '../domain/article-policy.ts';
import { articleContractFor, articleGateFor, outletPunctuation, quoteRuleFor, tidyQuoteOpenings } from '../domain/formats.ts';
import { quotableIds, quotableSpeaker } from '../domain/quote-plan.ts';
import { ungroundedTerms } from '../domain/grounding.ts';
import { currentSourceVersion, writingSources } from '../domain/source.ts';
import type { Source } from '../domain/source.ts';
import { writingResearchEvidence } from '../domain/writing-research-evidence.ts';
import type { Person } from '../domain/workspace.ts';
import type { ProductionRecord } from '../domain/record.ts';
import type { ArticlePolicyIssue } from '../domain/article-policy.ts';
import { ARTICLE_ASSIST_KINDS, runArticleAssist } from './article-assist';
import { citationsFromArticle, emphasizeArticleQuotes } from '../domain/citation-library.ts';
import type { Citation } from '../domain/citation-library.ts';
import { autoFactCheckIds } from './fact-check-pipeline.ts';
import { tavilyConfigured } from './tavily';
import { mergeCitationAdditions, suggestedCitations } from '../domain/citation-suggestions.ts';
import { curatedEvidence, explainedHints, planningSource, quotableShortlist, writingSource } from '../domain/evidence-hints.ts';
import type { EditorialJob, ServerImageAsset } from '../ports/connected-workspace.ts';
import { articleImageTarget } from './article-image-task.ts';
import { editorialResponseValid } from './editorial-validation';
import { planEditorialOutline } from './editorial-outline';
import { runWritingOrchestration } from './writing-orchestration';
import { writingArticleBody } from '../domain/writing-article.ts';
import type { WritingTrace } from '../domain/writing-orchestration.ts';
import { effectiveWritingMinimumQuotes } from '../domain/writing-orchestration.ts';
import { writingSourceCandidates } from '../domain/writing-source.ts';
import { writingExecutionDate, writingTemporalContext } from '../domain/writing-context.ts';
import {contentHash} from '../domain/text/hash.ts';
import { writingArticleChecks, writingArticleLimits } from '../domain/writing-checks.ts';
import { interruptWritingTraces, nextWritingExecutionAttempt, writingTraceForExecution, writingTraceUsage } from '../domain/writing-execution.ts';

const object = (properties: Record<string,unknown>) => ({ type: 'object',additionalProperties: false,properties,required: Object.keys(properties) });
const string = { type: 'string' }, strings = { type: 'array',items: string };
const paragraph = z.object({ text: z.string().trim().min(1).max(5000),evidenceIds: z.array(z.string()).min(1).max(30) }).strict();

/**
 * What a claimed run's transactions read. Settling it and checking its sources and plan need the
 * production; progress needs only this run and its summary, so a preview never re-reads the
 * transcript or the pipeline.
 */
export function editorialWorkerScopes(runId: string, productionId: string) {
  const settle: EditorialScope = { productions: [productionId],runs: [runId],items: { citation: 'production' } };
  const light: EditorialScope = { productions: [productionId],parts: ['run'],partIds: [runId],sources: 'none',
    runs: [runId],items: { person: [],image_asset: [],feedback: [] } };
  return { settle,light,progress: { ...light,pipelines: false } as EditorialScope };
}

/** Claim and renew under a DB transaction; a stale worker cannot commit a result. */
export async function runEditorialJob(owner: string, signal: AbortSignal): Promise<boolean> {
  return withWorkspaceWork('editorial',owner,signal, scoped => runScoped(owner, scoped));
}

async function runScoped(owner: string, signal: AbortSignal): Promise<boolean> {
  // The claim leases one run in SQL (SKIP LOCKED); afterwards only its production is loaded.
  const claim = await transaction('worker', async client => (await client.query('SELECT public.reporter_ed_claim($1,$2) AS claim',
    [owner,60000])).rows[0].claim as { runId: string; productionId: string; attempts: number; lease: { fence: string } } | null);
  if (!claim) return false;
  const { settle: scope,light,progress } = editorialWorkerScopes(claim.runId,claim.productionId);
  const claimed = await editorialTransaction('worker', async (checkpoint,engine) => {
    const job = checkpoint.jobs[claim.runId];
    if (!job || job.lease?.fence !== claim.lease.fence || !isRunActive(engine.store.state.runFolds[claim.runId]?.run)) return undefined;
    try { bindEditorialJob(job,engine.store.state.runFolds[claim.runId].run.createdBy); }
    catch {
      appendEditorialEvent(engine,job,{type:'run.failed',error:{code:'JOB_CONTEXT_MISMATCH',message:'O contexto desta geração não corresponde ao workspace.',retryable:false}});
      delete job.lease;return undefined;
    }
    if (job.writingTraces?.some(trace => trace.status === 'running')) {
      job.writingTraces = interruptWritingTraces(job.writingTraces, new Date().toISOString());
      const usage = writingTraceUsage(job.writingTraces);
      if (usage) appendEditorialEvent(engine, job, { type: 'usage', usage });
    }
    if (job.attempts > 8) { appendEditorialEvent(engine,job,{ type: 'run.failed',error: { code: 'RETRY_EXHAUSTED',message: 'Limite de tentativas atingido. Tente uma nova geração.',retryable: false } }); delete job.lease; return undefined; }
    return structuredClone(job);
  },true,'reporter.edit',claim.attempts > 8 ? scope : light);
  const job = claimed.value;
  if (!job) return true;
  const writingExecutionAttempt = nextWritingExecutionAttempt(job.writingTraces ?? []);
  const controller = new AbortController();
  const combined = AbortSignal.any([signal,controller.signal]);
  let checkedAt = Date.now();
  const guarded = async (events: RunEventPayload[],call?: PipelineCall, additions?: { citations: Citation[]; assets: ServerImageAsset[]; researchSources?: Source[]; queueImages?: boolean; provider?: EditorialJob['provider'] }, writingTrace?: WritingTrace) => {
    // Sources and plan are re-read at most once a minute and always before the result settles.
    const full = Boolean(additions) || events.some(event => event.type === 'run.completed') || Date.now()-checkedAt >= 60000;
    const committed = await editorialTransaction('worker',async (checkpoint,engine,client) => {
      const current = checkpoint.jobs[job.meta.runId];
      if (!current?.lease || current.lease.fence !== job.lease?.fence || current.lease.until < Date.now()
        || !isRunActive(engine.store.state.runFolds[job.meta.runId]?.run)) throw new FlowError('LEASE_LOST',409,true);
      if (full) {
        const record = engine.records.record(job.meta.productionId);
        const run = engine.store.state.runFolds[job.meta.runId].run;
        if (!record || writingSources(record.sources).some(source => !source.rights.authorized)) throw new FlowError('SOURCE_NOT_AUTHORIZED',422);
        const refs = run.inputs.filter((ref): ref is import('../domain/refs.ts').SourceVersionRef => ref.kind === 'source-version');
        const memory = await guardMemorySources(client, record, refs.length ? refs : undefined);
        if (!memory.ok) throw new FlowError('MEMORY_NOT_READY', 409);
        if (job.contextHash && editorialContextHash(record,job.meta.pieceId,run.inputs) !== job.contextHash) throw new FlowError('PLAN_CHANGED',409);
      }
      current.lease.until = Date.now()+60000;
      if (call) {
        current.calls ??= [];
        const index = current.calls.findIndex(previous => previous.hash === call.hash);
        if (index < 0) current.calls.push(call); else current.calls[index] = call;
      }
      if (writingTrace) {
        current.writingTraces ??= [];
        const index = current.writingTraces.findIndex(previous => previous.id === writingTrace.id);
        if (index < 0) current.writingTraces.push(writingTrace); else current.writingTraces[index] = writingTrace;
      }
      // Attach immutable external provenance atomically with the accepted output, after checking
      // the original context. Old research remains available to historical article versions.
      if (additions?.researchSources?.length) {
        const entry = engine.store.state.productions.find(entry => entry.production.id === job.meta.productionId);
        if (!entry) throw new FlowError('PRODUCTION_NOT_FOUND', 404);
        for (const source of additions.researchSources) {
          if (!engine.store.state.sources.some(existing => existing.id === source.id)) engine.store.state.sources.push(source);
          if (!entry.production.sourceIds.includes(source.id)) entry.production.sourceIds.push(source.id);
        }
      }
      for (const event of events) appendEditorialEvent(engine,current,event);
      if (writingTrace && writingTrace.status !== 'running') {
        const usage = writingTraceUsage(current.writingTraces ?? []);
        if (usage) appendEditorialEvent(engine, current, { type: 'usage', usage });
      }
      if (additions) {
        checkpoint.citations = mergeCitationAdditions(checkpoint.citations ?? [],additions.citations,job.meta.productionId);
        checkpoint.imageAssets = [...(checkpoint.imageAssets ?? []),...additions.assets];
        // The article's citations are fact-checked in the background on this run, like the images.
        // Suggested passages the text did not quote wait for a person instead.
        const checks = autoFactCheckIds(additions.citations);
        if (checks.length && tavilyConfigured()) current.factCheck = { status: 'queued',citationIds: checks,done: 0,attempts: 0 };
        if (additions.queueImages) {
          const record = engine.records.record(job.meta.productionId);
          current.images = record ? articleImageTarget(record,job.meta.pieceId) : undefined;
        }
        // Background work is claimable at once: the text's lease would otherwise hide it for a
        // minute, past the drain that just finished the text, and nothing wakes a cloud worker.
        if (additions.queueImages || current.factCheck) {
          // The original claim is already due on PostgreSQL's clock; keep it through this handoff.
          if (additions.provider) current.provider = additions.provider;
          delete current.lease;
        }
      }
    },true,'reporter.edit',full ? scope : progress);
    if (full) checkedAt = Date.now();
    return committed;
  };
  let renewing = false;
  let lastStepId = 'source';
  // Renewal is worker bookkeeping in SQL; browsers are not told about it.
  const timer = setInterval(() => {
    if (renewing) return; renewing = true;
    void transaction('worker',async client => (await client.query('SELECT public.reporter_ed_renew($1,$2,$3,$4) AS renewed',
      [job.meta.runId,owner,job.lease!.fence,60000])).rows[0].renewed === true)
      .then(renewed => { if (!renewed) controller.abort(); }).catch(() => controller.abort()).finally(() => { renewing = false; });
  },15000);
  try {
    if (!job.pipeline) throw new FlowError('PIPELINE_SNAPSHOT_MISSING',422);
    const pipeline = job.pipeline;
    let requestedOutline = (job.input as { outline?: OutlineInput }).outline;
    if (job.kind === 'article.draft') await guarded([{ type: 'article.preview',body: null }]);
    if (job.kind === 'article.draft' && requestedOutline) await guarded([{ type: 'outline',title: requestedOutline.title,
      sections: requestedOutline.sections.map(section => ({ blockId: section.blockId,title: section.title })) }]);
    await guarded([{ type: 'step.started',stepId: 'source',meta: 'Preparando a fonte autorizada' }]);
    const input = (await editorialTransaction('worker',async (checkpoint,engine,client) => {
      const record = engine.records.record(job.meta.productionId);
      if (!record || writingSources(record.sources).some(source => !source.rights.authorized)) throw new FlowError('SOURCE_NOT_AUTHORIZED',422);
      const run = engine.store.state.runFolds[job.meta.runId]?.run;
      const refs = run?.inputs.filter((ref): ref is import('../domain/refs.ts').SourceVersionRef => ref.kind === 'source-version');
      const memory = await guardMemorySources(client, record, refs?.length ? refs : undefined);
      if (!memory.ok) throw new FlowError('MEMORY_NOT_READY', 409);
      if(job.template&&job.template.workspaceId!==checkpoint.state.workspace.id)throw new FlowError('JOB_CONTEXT_MISMATCH',422);
      const config=checkpoint.templateConfiguration;
      if(job.template){
        const saved=[config?.active,...(config?.history??[])].find(entry=>entry?.hash===job.template!.hash);
        if(!saved||contentHash(saved)!==contentHash(job.template))throw new FlowError('JOB_CONTEXT_MISMATCH',422);
      }
      return { record: { ...record, sources: writingSources(record.sources) },templates: editorialTemplates(checkpoint),people: engine.store.state.people,
        citations: (checkpoint.citations ?? []).filter(citation => citation.productionId === job.meta.productionId) };
    },false,'reporter.edit',{...scope,templates:true})).value;
    if (ARTICLE_ASSIST_KINDS.has(job.kind)) {
      lastStepId = 'assist';
      const response = await runArticleAssist(job,input.record,combined,guarded);
      await editorialTransaction('worker',async checkpoint => {
        const current = checkpoint.jobs[job.meta.runId];
        if (current?.lease?.fence === job.lease?.fence) current.provider = { name: response.provider,model: response.model,requestId: response.provider_request_id };
      },true,'reporter.edit',progress);
      logEvent('worker','editorial_completed',{ generation_id: job.meta.runId });
      return true;
    }
    const candidates = job.kind === 'article.draft' && pipeline.definition.writing?.enabled
      ? writingSourceCandidates(input.record.sources) : editorialCandidates(input.record);
    // Curated citations and quotable lines reach a step only when its prompt explains them.
    const curated = curatedEvidence(input.citations,input.record.sources,candidates);
    const hints = explainedHints(pipeline.definition);
    const byKey = new Map(candidates.map(c => [c.key,c]));
    const knownIds = new Set(byKey.keys());
    const evidencePassages=(ids:readonly string[])=>contiguousSourcePassages(input.record.sources,ids.flatMap(id=>byKey.get(id)?[byKey.get(id)!.ref]:[]));
    const refs = (keys: string[]) => keys.map(key => {
      const candidate = byKey.get(key); if (!candidate) throw new FlowError('UNKNOWN_EVIDENCE',502);
      return candidate.ref;
    });
    const directory = await workDirectory(job.meta.runId);
    const previousDirectory = job.cacheSourceRunId ? await workDirectory(job.cacheSourceRunId) : undefined;
    const factsDirectory = await sourcePreparationDirectory();
    const minimumQuotes = job.kind === 'article.draft' && pipeline.definition.writing?.enabled
      ? effectiveWritingMinimumQuotes(pipeline.definition.writing, articleGateFor(input.record.production.brief).minQuotes) : undefined;
    const sizing = draftSizeInstructions(input.record.production.brief, minimumQuotes === undefined ? undefined : { minimumQuotes });
    const source = candidates.map(c => '['+c.key+'] '+(c.speaker ? c.speaker+': ' : '')+c.text).join('\n');
    if (!source.trim()) throw new FlowError('EMPTY_EDITORIAL_SOURCE',422);
    const brief = JSON.stringify(input.record.production.brief);
    const format = input.record.production.brief.format;
    const people = confirmedPeople(input.record,input.people);
    // A line is quotable when a linked speaker said it, or, in a stand interview without speaker labels and one
    // confirmed person, when it is one of her answers (never a line that names or thanks her, which is the interviewer's).
    const linked = new Set(input.record.sources.flatMap(s => s.speakers.filter(speaker => speaker.personId && !speaker.unattributed).map(speaker => speaker.label)));
    const identified = quotableSpeaker({ linked,people,unlabeledAnswers: format === 'stand' });
    const executionTime = new Date();
    const today = new Intl.DateTimeFormat('pt-BR',{ timeZone: 'America/Sao_Paulo',weekday: 'long',day: 'numeric',month: 'long',year: 'numeric' }).format(executionTime);
    if (job.kind === 'article.draft' && pipeline.definition.writing?.enabled) {
      await guarded([{ type: 'step.completed', stepId: 'source', meta: `${candidates.length} trechos originais disponíveis` }]);
      const completed = new Set<string>();
      const originalSources = input.record.sources.filter(source => !source.research);
      const evidenceContext = { runId: job.meta.runId, workspaceId: input.record.production.workspaceId, actorId: input.record.production.createdBy };
      const written = await runWritingOrchestration({
        configuration: pipeline.definition.writing, policy: pipeline.definition.editorial,
        source: candidates.map(candidate => ({ id: candidate.key, text: candidate.text, ...(candidate.speaker ? { speaker: candidate.speaker } : {}) })),
        brief: { ...input.record.production.brief, people, today, limits: sizing, requestedOutline: requestedOutline ?? null,
          temporalContext: writingTemporalContext(originalSources, writingExecutionDate(executionTime)),
          sourceReferences: candidates.map(candidate => ({ id: candidate.key, reference: candidate.ref })) },
        directory, signal: combined,
        validateArticle: (article, externalSources = []) => {
          const external = writingResearchEvidence(externalSources, evidenceContext);
          const resolve = (keys: string[]) => keys.flatMap(key => external.references.has(key) ? [external.references.get(key)!] : refs([key]));
          return writingArticleChecks(writingArticleBody(article, job.meta.runId, resolve), [...originalSources, ...external.sources],
            input.record.production.brief, people.flatMap(person => [person.name, person.title ?? '', person.organization ?? '']),
            { minimumQuotes: minimumQuotes!, titleSourceRefs: resolve(article.titleEvidenceIds), dekSourceRefs: resolve(article.dekEvidenceIds) });
        },
        trace: async trace => {
          lastStepId = `writing-${trace.stage}-${trace.attempt}`;
          if (trace.status === 'completed') completed.add(lastStepId);
          const researchSkipped = trace.stage === 'research' && (trace.research?.status === 'skipped'
            || trace.status === 'failed' && pipeline.definition.writing?.research?.failureMode === 'continue_original');
          if (researchSkipped) {
            await guarded([{ type: 'step.skipped', stepId: lastStepId }, { type: 'step.progress', stepId: lastStepId,
              meta: trace.status === 'failed' ? 'Pesquisa falhou; seguindo somente com o conteúdo original' : 'Sem consulta necessária para este recorte' }],
            undefined, undefined, writingTraceForExecution(trace, writingExecutionAttempt));
            return;
          }
          const event: RunEventPayload = trace.status === 'running'
            ? { type: 'step.started', stepId: lastStepId, meta: `Aguardando ${pipelineModelLabel(trace.model)}` }
            : trace.status === 'completed' ? { type: 'step.completed', stepId: lastStepId, meta: trace.cached ? 'Resultado validado reutilizado' : 'Resposta registrada' }
            : { type: 'step.progress', stepId: lastStepId, meta: `Falha registrada: ${trace.error}` };
          await guarded([event], undefined, undefined, writingTraceForExecution(trace, writingExecutionAttempt));
        },
      });
      const external = writingResearchEvidence(written.externalSources ?? [], evidenceContext);
      const resolve = (keys: string[]) => keys.flatMap(key => external.references.has(key) ? [external.references.get(key)!] : refs([key]));
      const finalSources = [...originalSources, ...external.sources];
      const body = writingArticleBody(written.article, job.meta.runId, resolve);
      const issue = r1ArticleIssue(body, finalSources, writingArticleLimits(input.record.production.brief, minimumQuotes));
      if (issue) throw new FlowError(issue, 422);
      // Header evidence has no paragraph block; keep it explicit in the run's provenance.
      const events: RunEventPayload[] = resolve([...written.article.titleEvidenceIds, ...written.article.dekEvidenceIds])
        .map(ref => ({ type: 'source.used', ref }));
      events.push({ type: 'outline', title: body.title, ...(body.dek ? { dek: body.dek } : {}), sections: [] });
      for (const block of body.blocks) events.push({ type: 'block.started', block: { id: block.id, type: block.type } }, { type: 'block.completed', block });
      if (pipeline.definition.writing.maxCorrections) for (const stepId of ['writing-correct-1', 'writing-review-2']) {
        if (!completed.has(stepId)) events.push({ type: 'step.skipped', stepId });
      }
      events.push({ type: 'run.completed' });
      await guarded(events, undefined, { assets: [], queueImages: false, researchSources: external.sources,
        citations: citationsFromArticle(body, finalSources, job.meta.productionId, new Date().toISOString()) });
      logEvent('worker', 'editorial_completed', { generation_id: job.meta.runId });
      return true;
    }
    // Event formats: every number and name must exist in the material, the speakers or the event typed by a person.
    // Speaker labels are part of what the material says ("Categoria Personalidade Feminina: …" parses as one).
    const corpus = [...input.record.sources.filter(source => !source.research).flatMap(s => currentSourceVersion(s).content.segments.map(segment => (segment.speaker ? segment.speaker + ': ' : '') + segment.text)),
      ...people.flatMap(person => [person.name,person.title ?? '',person.organization ?? '']),
      ...Object.values(input.record.production.brief.event ?? {}),today].join('\n');
    const grounding = format ? (text: string) => ungroundedTerms(text,corpus) : undefined;
    let inputTokens: number | null = 0,outputTokens: number | null = 0;
    let result: Awaited<ReturnType<typeof generateStructured>> | undefined;
    const variables: PipelineVariables = { source,brief,sizing: JSON.stringify(sizing),outline: '',section: '',history: '',futureSections: '',layouts: '',approvedArticle: '',
      event: JSON.stringify({ event: input.record.production.brief.event ?? null,today }),people: JSON.stringify(people) };
    const writingStages = new Map<string,string>();
    let previewAt = 0,previewHash = '';
    const publishPreview = async (force = false) => {
      if (!requestedOutline || !force && Date.now()-previewAt < 1500) return;
      const body = articlePreview(job.meta.runId,requestedOutline,sizing.headings,writingStages);
      const hash = JSON.stringify(body);
      if (!body.blocks.length || hash === previewHash) return;
      await guarded([{ type: 'article.preview',body },{ type: 'step.progress',stepId: lastStepId,meta: 'Escrevendo · prévia em tempo real' }]);
      previewAt = Date.now(); previewHash = hash;
    };
    const call = async (key: PipelineStepKey,schema: object,values = variables,index?: number) => {
      const stepId = key === 'section' ? 'section-'+index : key;
      lastStepId = key === 'facts' ? 'source' : stepId;
      if (key !== 'facts') await guarded([{ type: 'step.started',stepId,meta: 'Aguardando ' + pipelineModelLabel(pipeline.definition.steps[key].model) }]);
      const writing = requestedOutline && ['article','intro','section'].includes(key);
      // A bounded single-mode refinement gets its own complete answer. Keep the first pass on
      // screen while that answer is being prepared; publishing its fresh partial JSON made the
      // preview shrink and look as if the article had restarted.
      const streamText = writing && (key !== 'article' || index === 0);
      const expected = key === 'article' ? JSON.parse(values.outline) : key === 'section' ? JSON.parse(values.section) : undefined;
      const response = await executePipelineStep({ pipeline,key,index,variables: values,schema,directory,previousDirectory,factsDirectory,
        validateOutput: value => editorialResponseValid(key,value,knownIds,input.record.production.brief.sections,expected)
          && (key !== 'outline' || !grounding || outlineGrounded(value,grounding)),
        ...(key === 'article' && index === 0 || key === 'intro' || key === 'section' ? { deferWritingRevision: true } : {}),
        ...(['article', 'intro', 'section'].includes(key) ? { writingContract: { evidencePassages,evidence: new Map(candidates.map(candidate => [candidate.key, candidate.text])),
          ...(key === 'article' ? { limits: sizing, minQuotes: sizing.minQuotes } : {}) } } : {}),
        signal: key === 'images' ? AbortSignal.any([combined,AbortSignal.timeout(30000)]) : combined,trace: trace => guarded([],trace).then(() => undefined),
        ...(streamText ? { onText: async (text: string) => { writingStages.set(stepId,text); await publishPreview(); } } : {}) });
      if (writing) { writingStages.set(stepId,JSON.stringify(response.value)); await publishPreview(true); }
      result = response;
      inputTokens = inputTokens === null || response.input_units === null ? null : inputTokens+response.input_units;
      outputTokens = outputTokens === null || response.output_units === null ? null : outputTokens+response.output_units;
      if (key !== 'facts') await guarded([{ type: 'step.completed',stepId,meta: response.needsRevision ? 'Resposta recebida; revisando os limites da R1' : 'Resposta validada' }]);
      return response.value;
    };
    // Whole-episode map/reduce uses the same editable prompt and model as the config page.
    let context = source;
    if (job.kind !== 'carousel.copy') {
      for (let round = 0; context.length > 24000; round++) {
        if (round >= 4) throw new FlowError('GENERATION_INPUT_TOO_LARGE',422);
        // Small passages leave room for qualifiers while staying below the
        // 50-fact output contract; every passage, including the end, is read.
        const chunks = splitSource(context,editorialPassageSize(round));
        let completed = 0;
        await guarded([{ type: 'step.progress',stepId: 'source',meta: `Preparando ${chunks.length} trechos da fonte` }]);
        const summaries = await mapEditorialPassages(chunks,async (chunk,index) => {
          const facts = z.object({ facts: z.array(z.string().min(1).max(3000)).min(1).max(50) }).strict().parse(
            await call('facts',PIPELINE_SCHEMAS.facts,{ ...variables,source: chunk },round*10000+index));
          completed++;
          await guarded([{ type: 'step.progress',stepId: 'source',meta: `${completed} de ${chunks.length} trechos preparados` }]);
          return facts.facts.join('\n');
        });
        context = summaries.join('\n\n');
      }
      // Summaries lose the exact words: the planning steps also get the quotable lines of linked speakers.
      variables.source = hints.planning ? planningSource(context,curated,context !== source
        ? quotableShortlist(candidates,identified,new Set(curated.byKey.keys())) : []) : context;
    }
    await guarded([{ type: 'step.completed',stepId: 'source' },{ type: 'step.skipped',stepId: 'generate' }]);
    let value: unknown;
    let layouts: ReturnType<typeof editorialCarouselLayouts> = [];
    if (job.kind === 'article.outline' || job.kind === 'article.draft' && !requestedOutline) {
      requestedOutline = await planEditorialOutline({ sections: input.record.production.brief.sections,candidates,variables,
        curateQuotes: pipeline.definition.curateQuotes,call,dek: Boolean(format),normalize: outline => {
          const valid = validateEditorialOutline(input.record,outline);
          if (!valid.ok) throw new FlowError('INVALID_OUTLINE',502);
          return { title: valid.value.title,intro: { quotes: valid.value.intro },sections: valid.value.sections };
        } });
      if (job.kind === 'article.draft') await guarded([{ type: 'outline',title: requestedOutline.title,
        sections: requestedOutline.sections.map(section => ({ blockId: section.blockId,title: section.title })) }]);
    }
    const reviewed = requestedOutline;
    // The passages the outline chose for the text; the ones it does not quote become suggested citations.
    let selectedKeys: string[] = [];
    if (job.kind === 'article.draft') {
      if (!reviewed) throw new FlowError('INVALID_OUTLINE',422);
      const candidateKey = (ref: Parameters<typeof refKey>[0]) => {
        const found = candidates.find(c => refKey(c.ref) === refKey(ref));
        if (!found) throw new FlowError('UNKNOWN_OUTLINE_EVIDENCE',422);
        return found.key;
      };
      const outline = { title: reviewed.title,introIds: reviewed.intro?.quotes.map(candidateKey) ?? [],sections: reviewed.sections.map(s => ({ title: s.title,evidenceIds: s.quotes.map(candidateKey) })) };
      // Map/reduce summaries are not literal transcripts. Keep the exact selected
      // passages alongside them so quotation text can be copied, not reconstructed.
      selectedKeys = [...outline.introIds, ...outline.sections.flatMap(section => section.evidenceIds)];
      const selected = new Set(selectedKeys);
      // The planning hints stay out: the writing steps read curated lines as marks on literalEvidence.
      variables.source = writingSource(context,candidates,selected,hints.writing ? curated.byKey : new Map());
      variables.outline = JSON.stringify(outline);
      if (pipeline.definition.articleMode === 'single') value = await writeCompleteArticle(outline, variables, sizing, call);
      else {
        // A part asked for the quotation its evidence allows, only when both writing prompts explain it.
        const soft = explainedRevisionCodes(pipeline.definition).includes('SECTION_QUOTE_REQUIRED') ? { rule: quoteRuleFor(input.record.production.brief),
          quotable: (ids: readonly string[]) => quotableIds(ids,byKey,identified).map(id => byKey.get(id)!) } : undefined;
        value = await writeSequentialArticle(outline,variables,sizing,call,new Map(candidates.map(candidate=>[candidate.key,candidate.text])),evidencePassages,grounding,people.map(person => person.name),soft);
      }
    }
    if (job.kind === 'carousel.copy') {
      const piece = input.record.pieces.find(p => p.id === job.meta.pieceId);
      if (piece?.draft.body.type !== 'carousel') throw new FlowError('INVALID_CAROUSEL',422);
      const templateId = piece.draft.body.templateId;
      const template = input.templates.find(t => t.id === templateId);
      const approved = latestApproved(input.record,input.record.pieces.find(p => p.kind === 'article')?.id ?? '');
      if (!template || approved?.version.body.type !== 'article') throw new FlowError('APPROVED_ARTICLE_REQUIRED',422);
      const body = approved.version.body;
      layouts = editorialCarouselLayouts(template,(job.input as { slides?: number }).slides ?? template.minSlides,body);
      variables.approvedArticle = JSON.stringify({ title: body.title,blocks: body.blocks.filter(b => ['paragraph','heading','quote','list'].includes(b.type)) });
      variables.source = variables.approvedArticle;
      variables.layouts = JSON.stringify(layouts);
      // Named slide keys give the provider each layout's exact slots and length limits.
      const schema = object({ slides: object(Object.fromEntries(layouts.map((layout,index) => [String(index),object({
        slots: object(Object.fromEntries(layout.slots.map(slot => [slot.id,{ type: 'string',maxLength: slot.maxChars,
          ...(slot.role === 'body' ? { pattern: slot.required ? PIPELINE_SENTENCE_PATTERN : '^$|' + PIPELINE_SENTENCE_PATTERN } : {}),
        }]))),
        sourceBlockIds: strings,
      })]))) });
      value = await call('carousel',schema);
    }
    const events: RunEventPayload[] = [];
    let additions: { citations: Citation[]; assets: ServerImageAsset[]; queueImages?: boolean; provider?: EditorialJob['provider'] } | undefined;
    if (job.kind === 'article.outline') {
      if (!reviewed) throw new FlowError('INVALID_OUTLINE',502);
      events.push({ type: 'outline',title: reviewed.title,intro: { budget: sizing.introChars,quotes: reviewed.intro?.quotes ?? [] },
        sections: reviewed.sections.map((section,i) => ({ ...section,budget: sizing.sections[i]?.budgetChars })),
        candidates: candidates.map(c => c.ref),size: { laudas: sizing.laudas,minChars: sizing.minChars,maxChars: sizing.maxChars,targetChars: sizing.targetChars } });
    } else if (job.kind === 'article.draft') {
      const article = z.object({ title: z.string().min(1).max(500),intro: z.array(paragraph).min(1).max(3),sections: z.array(z.object({ title: z.string().min(1).max(120),paragraphs: z.array(paragraph).min(1).max(10) }).strict()).min(1).max(8) }).strict().parse(value);
      if (reviewed && (article.title !== reviewed.title || article.sections.length !== reviewed.sections.length || article.sections.some((s,i) => s.title !== reviewed.sections[i].title))) throw new FlowError('OUTLINE_NOT_FOLLOWED',502);
      const blocks: ArticleBlock[] = [];
      const add = (p: z.infer<typeof paragraph>) => blocks.push({ id: randomUUID(),type: 'paragraph',inlines: [{ text: format ? tidyQuoteOpenings(outletPunctuation(p.text)) : p.text }],sourceRefs: refs(p.evidenceIds),ai: 'unreviewed' });
      article.intro.forEach(add);
      article.sections.forEach((s,i) => {
        if (sizing.headings) blocks.push({ id: reviewed?.sections[i].blockId ?? randomUUID(),type: 'heading',level: 2,inlines: [{ text: s.title }],ai: 'unreviewed' });
        s.paragraphs.forEach(add);
      });
      // The linha fina is checked like a sentence of the text: no invented term, and a quotation in it
      // keeps its marks only when its words are literal in the material.
      const plannedDek = reviewed?.dek && !grounding?.(reviewed.dek).length ? reviewed.dek : undefined;
      const dek = plannedDek ? unquoteUnsupported([{ text: plannedDek,evidenceIds: candidates.map(candidate => candidate.key) }],
        new Map(candidates.map(candidate => [candidate.key,candidate.text])))[0].text : undefined;
      const body = emphasizeArticleQuotes({ type: 'article' as const,title: article.title,...(dek ? { dek } : {}),blocks });
      const issue = r1ArticleIssue(body, input.record.sources, articleGateFor(input.record.production.brief));
      // No block/version is committed until the WHOLE sequential or single output passes.
      if (issue) throw new FlowError(issue, 502);
      if (!articlePlainText(body).trim()) throw new FlowError('EMPTY_ARTICLE',502);
      // Persist the validated text and enqueue optional images in the SAME transaction.
      // The completed text run stays editable while the image worker uses its own lease.
      const now = new Date().toISOString();
      additions = { assets: [],citations: [...citationsFromArticle(body,input.record.sources,job.meta.productionId,now),
        ...suggestedCitations({ body,selected: selectedKeys,candidates,sources: input.record.sources,productionId: job.meta.productionId,now })],
        // An event coverage goes out with the newsroom's photos: no AI images are planned or generated.
        queueImages: Boolean(pipeline.definition.steps.images) && !format,
        ...(result ? { provider: { name: result.provider,model: result.model,requestId: result.provider_request_id } } : {}) };
      // The saved version is rebuilt from these events: the linha fina travels with the title.
      events.push({ type: 'outline',title: article.title,...(body.dek ? { dek: body.dek } : {}),sections: [] });
      for (const block of body.blocks) events.push({ type: 'block.started',block: { id: block.id,type: block.type } },{ type: 'block.completed',block });
      if (pipeline.definition.steps.images) events.push({ type: 'step.skipped',stepId: 'images' },
        { type: 'step.progress',stepId: 'images',meta: format ? 'Sem imagens de IA: use as fotos da cobertura.' : 'Imagens em segundo plano; o artigo está disponível.' });
    } else {
      const raw = z.object({ slides: z.record(z.string(),z.object({ slots: z.record(z.string(),z.string().max(2000)),sourceBlockIds: z.array(z.string()).min(1).max(20) }).strict()) }).strict().parse(value);
      if (Object.keys(raw.slides).length !== layouts.length || layouts.some((_layout,i) => !raw.slides[String(i)])) throw new FlowError('INVALID_SLIDE_COUNT',502);
      const carousel = { slides: layouts.map((_layout,i) => raw.slides[String(i)]) };
      if (carousel.slides.length !== layouts.length) throw new FlowError('INVALID_SLIDE_COUNT',502);
      const approved = latestApproved(input.record,input.record.pieces.find(p => p.kind === 'article')?.id ?? '');
      const blockIds = new Set(approved?.version.body.type === 'article' ? approved.version.body.blocks.map(b => b.id) : []);
      for (const [i,slide] of carousel.slides.entries()) {
        const layout = layouts[i],slots = Object.fromEntries(Object.entries(slide.slots).map(([id,text]) => [id,text.trim()]));
        if (slide.sourceBlockIds.some(id => !blockIds.has(id)) || Object.keys(slots).some(id => !layout.slots.some(s => s.id === id))
          || layout.slots.some(s => (s.required && !slots[s.id]) || (slots[s.id]?.length ?? 0)>s.maxChars)) throw new FlowError('INVALID_CAROUSEL_COPY',502);
        for (const slot of layout.slots.filter(slot => slot.role === 'quote')) {
          const quote = slots[slot.id]?.replace(/^[“"«]|[”"»]$/g,'').trim();
          if (!quote) continue;
          const literal = approved?.version.body.type === 'article' && approved.version.body.blocks.some(block =>
            block.type === 'quote' && slide.sourceBlockIds.includes(block.id) && blockText(block).includes(quote));
          if (!literal) throw new FlowError('UNSUPPORTED_CAROUSEL_QUOTE',502);
        }
        events.push({ type: 'slide.completed',slide: { id: randomUUID(),layout: layout.id,slots,sourceBlockIds: slide.sourceBlockIds,ai: 'unreviewed' } });
      }
    }
    if (inputTokens !== null && outputTokens !== null) events.push({ type: 'usage',usage: { inputTokens,outputTokens,totalTokens: inputTokens+outputTokens } });
    events.push({ type: 'step.completed',stepId: 'generate' },{ type: 'run.completed' });
    await guarded(events,undefined,additions);
    await editorialTransaction('worker',async checkpoint => {
      const current = checkpoint.jobs[job.meta.runId];
      if (current?.lease?.fence === job.lease?.fence && result) current.provider = { name: result.provider, model: result.model, requestId: result.provider_request_id };
    },true,'reporter.edit',progress);
    logEvent('worker','editorial_completed',{ generation_id: job.meta.runId });
  } catch (error) {
    const code = error instanceof z.ZodError ? 'INVALID_PROVIDER_OUTPUT' : safeCode(error);
    const writingReason = job.pipeline?.definition.writing?.enabled && error instanceof FlowError ? error.reason : undefined;
    try {
      await editorialTransaction('worker',async (checkpoint,engine) => {
        const current = checkpoint.jobs[job.meta.runId];
        if (current?.lease?.fence !== job.lease?.fence || !isRunActive(engine.store.state.runFolds[job.meta.runId]?.run)) return;
        if (current.writingTraces?.some(trace => trace.status === 'running')) {
          current.writingTraces = interruptWritingTraces(current.writingTraces, new Date().toISOString(), code,
            writingReason ?? 'A execução foi interrompida antes de concluir esta etapa.');
          const usage = writingTraceUsage(current.writingTraces);
          if (usage) appendEditorialEvent(engine, current, { type: 'usage', usage });
        }
        const policy = editorialRetryPolicy(error,current.attempts,engine.store.state.runFolds[job.meta.runId].run.createdAt,signal.aborted);
        // Keep an already visible preview through a provider retry. Clearing it here sent the
        // editor back to its skeletons and replayed the text when the worker resumed.
        if (ARTICLE_ASSIST_KINDS.has(job.kind)) appendEditorialEvent(engine,current,{ type: 'assist.preview',reply: '',proposals: [] });
        current.attempts = policy.attempts;
        if (policy.retry) {
          current.availableAt = Date.now()+policy.delayMs; delete current.lease;
          const stepId = engine.store.state.runFolds[job.meta.runId].run.steps.filter(step => step.state === 'current').at(-1)?.id ?? 'source';
          appendEditorialEvent(engine,current,{ type: 'step.progress',stepId,meta: code.endsWith('_RATE_LIMIT')
            ? `Limite temporário do provedor; nova tentativa em ${Math.ceil(policy.delayMs/1000)} s. Os trechos concluídos estão salvos.` : 'Nova tentativa aguardando o provedor' });
        } else {
          delete current.lease;
          const error = { code,stepId: lastStepId,message: writingReason ?? (code.endsWith('_RATE_LIMIT')
            ? 'O provedor atingiu o limite de uso. A geração foi interrompida; tente novamente ou escolha outro modelo em Prompts.'
            : code.endsWith('_QUOTA_EXHAUSTED') ? 'A conta do provedor está sem cota disponível. Confira o saldo ou escolha outro modelo em Prompts.'
            : code === 'INVALID_PROVIDER_OUTPUT' ? 'A resposta da IA não passou na validação. Tente novamente ou ajuste o modelo e o prompt em Prompts.'
            : code === 'UNGROUNDED_FACT' ? 'O texto usaria um número ou nome que não está no material. Gere de novo ou complete o material e os falantes.'
            : code in ARTICLE_POLICY_MESSAGES ? articlePolicyMessage(code as ArticlePolicyIssue,articleContractFor(engine.records.record(job.meta.productionId)?.production.brief ?? {}))
            : code === 'ARTICLE_PART_SIZE_EXCEEDED' ? 'Uma parte do artigo excedeu seu orçamento. Ajuste a distribuição de evidências ou o prompt, sem cortar frases.'
            : 'O provedor não concluiu um resultado válido. Código: '+code),retryable: true };
          appendEditorialEvent(engine,current,{ type: 'step.failed',stepId: lastStepId,error });
          appendEditorialEvent(engine,current,{ type: 'run.failed',error });
        }
      },true,'reporter.edit',scope);
    } catch { /* Lease loss never authorizes a stale result. */ }
    logEvent('worker','editorial_failed',{ generation_id: job.meta.runId,error_code: code });
  } finally { clearInterval(timer); }
  return true;
}

/** Speakers a person linked to someone, as the prompts name them: name, role and organisation. */
function confirmedPeople(record: ProductionRecord, people: readonly Person[]) {
  const byId = new Map(people.map(person => [person.id,person]));
  const seen = new Set<string>();
  return record.sources.flatMap(source => source.speakers.flatMap(speaker => {
    const person = speaker.personId ? byId.get(speaker.personId) : undefined;
    if (!person || seen.has(person.id)) return [];
    seen.add(person.id);
    return [{ label: speaker.label,name: person.name,...(person.title ? { title: person.title } : {}),...(person.organization ? { organization: person.organization } : {}) }];
  }));
}

/** The outline's title, linha fina and intertítulos hold no number or name outside the known facts. */
function outlineGrounded(value: unknown, grounding: (text: string) => string[]) {
  const outline = value as { title?: string; dek?: string; sections?: { title?: string }[] };
  return [outline.title,outline.dek,...(outline.sections ?? []).map(section => section.title)]
    .every(text => !text || !grounding(text).length);
}
