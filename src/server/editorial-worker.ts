import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { editorialCandidates, editorialTemplates, appendEditorialEvent, editorialContextHash, editorialCarouselLayouts, validateEditorialOutline } from '../runtime/editorial-engine.ts';
import type { RunEventPayload } from '../domain/run-events.ts';
import type { OutlineInput } from '../ports/generation.ts';
import { articlePlainText, blockText } from '../domain/article.ts';
import type { ArticleBlock } from '../domain/article.ts';
import { latestApproved } from '../domain/record.ts';
import { refKey } from '../domain/refs.ts';
import { PIPELINE_SCHEMAS, PIPELINE_SENTENCE_PATTERN, pipelineModelLabel } from '../domain/pipeline.ts';
import type { PipelineVariables, PipelineStepKey, PipelineCall } from '../domain/pipeline.ts';
import { splitSource } from '../domain/reporter.ts';
import { isRunActive } from '../domain/run.ts';
import { draftSizeInstructions } from '../registries/sizing.ts';
import { editorialTransaction } from './editorial';
import { generateStructured } from './groq';
import { executePipelineStep, writeSequentialArticle, writeCompleteArticle, editorialPassageSize } from './pipeline-runner';
import { workDirectory, sourcePreparationDirectory } from './storage';
import { mapEditorialPassages } from './editorial-passages';
import { planArticleImages } from './editorial-images';
import { FlowError, safeCode, logEvent, editorialRetryPolicy } from './errors';
import { articlePreview } from './article-preview';
import { contiguousSourcePassages, r1ArticleIssue, ARTICLE_POLICY_MESSAGES } from '../domain/article-policy.ts';
import type { ArticlePolicyIssue } from '../domain/article-policy.ts';
import { ARTICLE_ASSIST_KINDS, runArticleAssist } from './article-assist';
import { citationsFromArticle, emphasizeArticleQuotes } from '../domain/citation-library.ts';
import type { Citation } from '../domain/citation-library.ts';
import type { ServerImageAsset } from '../ports/connected-workspace.ts';
import { illustrateArticle } from './article-illustration';
import { editorialResponseValid } from './editorial-validation';
import { planEditorialOutline } from './editorial-outline';

const object = (properties: Record<string,unknown>) => ({ type: 'object',additionalProperties: false,properties,required: Object.keys(properties) });
const string = { type: 'string' }, strings = { type: 'array',items: string };
const paragraph = z.object({ text: z.string().trim().min(1).max(5000),evidenceIds: z.array(z.string()).min(1).max(30) }).strict();

/** Claim and renew under a DB transaction; a stale worker cannot commit a result. */
export async function runEditorialJob(owner: string, signal: AbortSignal): Promise<boolean> {
  const claimed = await editorialTransaction('worker', async (checkpoint,engine) => {
    const job = Object.values(checkpoint.jobs).find(job => isRunActive(engine.store.state.runFolds[job.meta.runId]?.run)
      && job.availableAt <= Date.now() && (!job.lease || job.lease.until < Date.now()));
    if (!job) return undefined;
    job.lease = { owner,until: Date.now()+60000,fence: randomUUID() }; job.attempts++;
    if (job.attempts > 8) { appendEditorialEvent(engine,job,{ type: 'run.failed',error: { code: 'RETRY_EXHAUSTED',message: 'Limite de tentativas atingido. Tente uma nova geração.',retryable: false } }); delete job.lease; return undefined; }
    return structuredClone(job);
  });
  const job = claimed.value;
  if (!job) return false;
  const controller = new AbortController();
  const combined = AbortSignal.any([signal,controller.signal]);
  const guarded = async (events: RunEventPayload[],call?: PipelineCall, additions?: { citations: Citation[]; assets: ServerImageAsset[] }) => editorialTransaction('worker',async (checkpoint,engine) => {
    const current = checkpoint.jobs[job.meta.runId];
    if (!current?.lease || current.lease.fence !== job.lease?.fence || current.lease.until < Date.now()
      || !isRunActive(engine.store.state.runFolds[job.meta.runId]?.run)) throw new FlowError('LEASE_LOST',409,true);
    const record = engine.records.record(job.meta.productionId);
    const run = engine.store.state.runFolds[job.meta.runId].run;
    if (!record || record.sources.some(source => !source.rights.authorized)) throw new FlowError('SOURCE_NOT_AUTHORIZED',422);
    if (job.contextHash && editorialContextHash(record,job.meta.pieceId,run.inputs) !== job.contextHash) throw new FlowError('PLAN_CHANGED',409);
    current.lease.until = Date.now()+60000;
    if (call) {
      current.calls ??= [];
      const index = current.calls.findIndex(previous => previous.hash === call.hash);
      if (index < 0) current.calls.push(call); else current.calls[index] = call;
    }
    for (const event of events) appendEditorialEvent(engine,current,event);
    if (additions) {
      const existing = new Map((checkpoint.citations ?? []).map(citation => [citation.id,citation]));
      for (const citation of additions.citations) if (!existing.has(citation.id) && existing.size < 5000) existing.set(citation.id,citation);
      checkpoint.citations = [...existing.values()];
      checkpoint.imageAssets = [...(checkpoint.imageAssets ?? []),...additions.assets];
    }
  });
  let renewing = false;
  let lastStepId = 'source';
  const timer = setInterval(() => {
    if (renewing) return; renewing = true;
    void guarded([]).catch(() => controller.abort()).finally(() => { renewing = false; });
  },15000);
  try {
    if (!job.pipeline) throw new FlowError('PIPELINE_SNAPSHOT_MISSING',422);
    const pipeline = job.pipeline;
    let requestedOutline = (job.input as { outline?: OutlineInput }).outline;
    if (job.kind === 'article.draft') await guarded([{ type: 'article.preview',body: null }]);
    if (job.kind === 'article.draft' && requestedOutline) await guarded([{ type: 'outline',title: requestedOutline.title,
      sections: requestedOutline.sections.map(section => ({ blockId: section.blockId,title: section.title })) }]);
    await guarded([{ type: 'step.started',stepId: 'source',meta: 'Preparando a fonte autorizada' }]);
    const input = (await editorialTransaction('worker',async (_checkpoint,engine) => {
      const record = engine.records.record(job.meta.productionId);
      if (!record || record.sources.some(source => !source.rights.authorized)) throw new FlowError('SOURCE_NOT_AUTHORIZED',422);
      return { record,templates: editorialTemplates() };
    },false)).value;
    if (ARTICLE_ASSIST_KINDS.has(job.kind)) {
      lastStepId = 'assist';
      const response = await runArticleAssist(job,input.record,combined,guarded);
      await editorialTransaction('worker',async checkpoint => {
        const current = checkpoint.jobs[job.meta.runId];
        if (current?.lease?.fence === job.lease?.fence) current.provider = { name: response.provider,model: response.model,requestId: response.provider_request_id };
      });
      logEvent('worker','editorial_completed',{ generation_id: job.meta.runId });
      return true;
    }
    const candidates = editorialCandidates(input.record);
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
    const sizing = draftSizeInstructions(input.record.production.brief);
    const source = candidates.map(c => '['+c.key+'] '+(c.speaker ? c.speaker+': ' : '')+c.text).join('\n');
    if (!source.trim()) throw new FlowError('EMPTY_EDITORIAL_SOURCE',422);
    const brief = JSON.stringify(input.record.production.brief);
    let inputTokens: number | null = 0,outputTokens: number | null = 0;
    let result: Awaited<ReturnType<typeof generateStructured>> | undefined;
    const variables: PipelineVariables = { source,brief,sizing: JSON.stringify(sizing),outline: '',section: '',history: '',futureSections: '',layouts: '',approvedArticle: '' };
    const writingStages = new Map<string,string>();
    let previewAt = 0,previewHash = '';
    const publishPreview = async (force = false) => {
      if (!requestedOutline || !force && Date.now()-previewAt < 350) return;
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
        validateOutput: value => editorialResponseValid(key,value,knownIds,input.record.production.brief.sections,expected),
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
    if (job.kind !== 'carousel.copy') {
      let context = source;
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
      variables.source = context;
    }
    await guarded([{ type: 'step.completed',stepId: 'source' },{ type: 'step.skipped',stepId: 'generate' }]);
    let value: unknown;
    let layouts: ReturnType<typeof editorialCarouselLayouts> = [];
    if (job.kind === 'article.outline' || job.kind === 'article.draft' && !requestedOutline) {
      requestedOutline = await planEditorialOutline({ sections: input.record.production.brief.sections,candidates,variables,
        curateQuotes: pipeline.definition.curateQuotes,call,normalize: outline => {
          const valid = validateEditorialOutline(input.record,outline);
          if (!valid.ok) throw new FlowError('INVALID_OUTLINE',502);
          return { title: valid.value.title,intro: { quotes: valid.value.intro },sections: valid.value.sections };
        } });
      if (job.kind === 'article.draft') await guarded([{ type: 'outline',title: requestedOutline.title,
        sections: requestedOutline.sections.map(section => ({ blockId: section.blockId,title: section.title })) }]);
    }
    const reviewed = requestedOutline;
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
      const selected = new Set([...outline.introIds, ...outline.sections.flatMap(section => section.evidenceIds)]);
      variables.source = JSON.stringify({ context: variables.source, literalEvidence: candidates.filter(candidate => selected.has(candidate.key))
        .map(candidate => ({ id: candidate.key, text: candidate.text, ...(candidate.speaker ? { speaker: candidate.speaker } : {}) })) });
      variables.outline = JSON.stringify(outline);
      if (pipeline.definition.articleMode === 'single') value = await writeCompleteArticle(outline, variables, sizing, call);
      else value = await writeSequentialArticle(outline,variables,sizing,call,new Map(candidates.map(candidate=>[candidate.key,candidate.text])),evidencePassages);
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
    let additions: { citations: Citation[]; assets: ServerImageAsset[] } | undefined;
    if (job.kind === 'article.outline') {
      if (!reviewed) throw new FlowError('INVALID_OUTLINE',502);
      events.push({ type: 'outline',title: reviewed.title,intro: { budget: sizing.introChars,quotes: reviewed.intro?.quotes ?? [] },
        sections: reviewed.sections.map((section,i) => ({ ...section,budget: sizing.sections[i]?.budgetChars })),
        candidates: candidates.map(c => c.ref),size: { laudas: sizing.laudas,minChars: sizing.minChars,maxChars: sizing.maxChars,targetChars: sizing.targetChars } });
    } else if (job.kind === 'article.draft') {
      const article = z.object({ title: z.string().min(1).max(500),intro: z.array(paragraph).min(1).max(3),sections: z.array(z.object({ title: z.string().min(1).max(120),paragraphs: z.array(paragraph).min(1).max(10) }).strict()).min(1).max(8) }).strict().parse(value);
      if (reviewed && (article.title !== reviewed.title || article.sections.length !== reviewed.sections.length || article.sections.some((s,i) => s.title !== reviewed.sections[i].title))) throw new FlowError('OUTLINE_NOT_FOLLOWED',502);
      const blocks: ArticleBlock[] = [];
      const add = (p: z.infer<typeof paragraph>) => blocks.push({ id: randomUUID(),type: 'paragraph',inlines: [{ text: p.text }],sourceRefs: refs(p.evidenceIds),ai: 'unreviewed' });
      article.intro.forEach(add);
      article.sections.forEach((s,i) => {
        if (sizing.headings) blocks.push({ id: reviewed?.sections[i].blockId ?? randomUUID(),type: 'heading',level: 2,inlines: [{ text: s.title }],ai: 'unreviewed' });
        s.paragraphs.forEach(add);
      });
      const body = emphasizeArticleQuotes({ type: 'article' as const,title: article.title,blocks });
      const issue = r1ArticleIssue(body, input.record.sources);
      // No block/version is committed until the WHOLE sequential or single output passes.
      if (issue) throw new FlowError(issue, 502);
      if (!articlePlainText(body).trim()) throw new FlowError('EMPTY_ARTICLE',502);
      let illustrated: ReturnType<typeof planArticleImages> = { blocks: body.blocks };
      const writerResult = result;
      if (pipeline.definition.steps.images) {
        try {
          illustrated = planArticleImages(body,await call('images',PIPELINE_SCHEMAS.images,
            { ...variables,history: JSON.stringify(body) }));
        } catch (error) {
          // Image planning is optional, never erase a valid article or conceal a lost lease.
          if (combined.aborted || ['LEASE_LOST','PLAN_CHANGED','SOURCE_NOT_AUTHORIZED'].includes(safeCode(error))) throw error;
          await guarded([{ type: 'step.progress',stepId: 'images',meta: 'Sugestões indisponíveis; o artigo foi preservado.' },
            { type: 'step.skipped',stepId: 'images' }]);
        }
      }
      // Full image lookup is optional: valid writing survives missing keys/originals/provider failures.
      let resolved = { body: { ...body,...illustrated },assets: [] as ServerImageAsset[],filled: 0,codes: [] as string[] };
      try {
        await guarded([{ type: 'step.started',stepId: 'images',meta: 'Buscando fotos pertinentes no Pixabay' }]);
        resolved = await illustrateArticle({ ...body,...illustrated },job.meta.productionId,AbortSignal.any([combined,AbortSignal.timeout(45000)]),undefined,
          {portal:input.record.production.workspaceId,actor:input.record.production.createdBy});
        await guarded([{ type: 'step.completed',stepId: 'images',meta: resolved.codes.includes('PIXABAY_ORIGINAL_REQUIRED')
          ? 'O Pixabay precisa liberar os originais; o texto foi preservado.' : `${resolved.filled} imagens selecionadas · revisão editorial necessária` }]);
      } catch (error) { if (combined.aborted) throw error; }
      result = writerResult;
      additions = { assets: resolved.assets,citations: citationsFromArticle(resolved.body,input.record.sources,job.meta.productionId,new Date().toISOString()) };
      events.push({ type: 'outline',title: article.title,sections: [],...(resolved.body.coverSlot ? { cover: resolved.body.coverSlot } : {}),
        ...(resolved.body.cover ? { coverImage: resolved.body.cover } : {}) });
      for (const block of resolved.body.blocks) events.push({ type: 'block.started',block: { id: block.id,type: block.type } },{ type: 'block.completed',block });
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
    });
    logEvent('worker','editorial_completed',{ generation_id: job.meta.runId });
  } catch (error) {
    const code = error instanceof z.ZodError ? 'INVALID_PROVIDER_OUTPUT' : safeCode(error);
    try {
      await editorialTransaction('worker',async (checkpoint,engine) => {
        const current = checkpoint.jobs[job.meta.runId];
        if (current?.lease?.fence !== job.lease?.fence || !isRunActive(engine.store.state.runFolds[job.meta.runId]?.run)) return;
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
          const error = { code,stepId: lastStepId,message: code.endsWith('_RATE_LIMIT')
            ? 'O provedor atingiu o limite de uso. A geração foi interrompida; tente novamente ou escolha outro modelo em Prompts.'
            : code.endsWith('_QUOTA_EXHAUSTED') ? 'A conta do provedor está sem cota disponível. Confira o saldo ou escolha outro modelo em Prompts.'
            : code === 'INVALID_PROVIDER_OUTPUT' ? 'A resposta da IA não passou na validação. Tente novamente ou ajuste o modelo e o prompt em Prompts.'
            : code in ARTICLE_POLICY_MESSAGES ? ARTICLE_POLICY_MESSAGES[code as ArticlePolicyIssue]
            : code === 'ARTICLE_PART_SIZE_EXCEEDED' ? 'Uma parte do artigo excedeu seu orçamento. Ajuste a distribuição de evidências ou o prompt, sem cortar frases.'
            : 'O provedor não concluiu um resultado válido. Código: '+code,retryable: true };
          appendEditorialEvent(engine,current,{ type: 'step.failed',stepId: lastStepId,error });
          appendEditorialEvent(engine,current,{ type: 'run.failed',error });
        }
      });
    } catch { /* Lease loss never authorizes a stale result. */ }
    logEvent('worker','editorial_failed',{ generation_id: job.meta.runId,error_code: code });
  } finally { clearInterval(timer); }
  return true;
}
