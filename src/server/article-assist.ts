import 'server-only';
import { z } from 'zod';
import { articleStats, blockText, findBlock, sliceText } from '../domain/article.ts';
import type { ArticleBody, ArticleBlock } from '../domain/article.ts';
import { articleQuotationIssue, directQuotes, hasQuote, literalQuoteText, r1ArticleIssue } from '../domain/article-policy.ts';
import { articleContractFor } from '../domain/formats.ts';
import { articleContractForPiece } from '../domain/article-generation-policy.ts';
import { applySuggestion } from '../domain/suggestion.ts';
import type { Suggestion, SuggestionProposal } from '../domain/suggestion.ts';
import { dedupeRefs, refKey, segmentRef } from '../domain/refs.ts';
import type { SourceRef, TextRange } from '../domain/refs.ts';
import { resolveSourceRef, currentSourceVersion, sourceVersionSpeakers, writingSources } from '../domain/source.ts';
import type { Person } from '../domain/workspace.ts';
import type { ProductionRecord } from '../domain/record.ts';
import type { EditorialJob } from '../ports/connected-workspace.ts';
import { GENERATION_LABELS, REWRITE_TONE_LABELS } from '../ports/generation.ts';
import type { GenerationKind } from '../ports/generation.ts';
import type { RunEventPayload } from '../domain/run-events.ts';
import { contentHash } from '../domain/text/hash.ts';
import { memorySourceSegment } from '../domain/editorial-memory-excerpt.ts';
import { prepareMemorySuggestion } from '../domain/editorial-memory-suggestion.ts';
import { writingMemoryContext, type WritingMemoryContext } from '../domain/writing-source.ts';
import { ok, refuse } from '../domain/result.ts';
import { PIPELINE_SCHEMAS } from '../domain/pipeline.ts';
import { partialJsonStrings } from './article-preview';
import { executePipelineStep } from './pipeline-runner';
import { articleAssistOutput } from './pipeline-output';
import { FlowError } from './errors';
import { workDirectory } from './storage';

export const ARTICLE_ASSIST_KINDS = new Set<GenerationKind>(['article.rewrite', 'article.shorten', 'article.expand-from-source',
  'article.to-list', 'article.titles', 'article.subheadings', 'article.ask', 'article.apply-note']);
const range = z.object({ blockId: z.string().min(1).max(128), from: z.number().int().nonnegative(), to: z.number().int().positive() }).strict();
const inputSchema = z.object({ baseRevision: z.number().int().nonnegative(), body: z.object({ type: z.literal('article') }).passthrough(),
  target: z.array(range).max(16).optional(), anchors: z.array(range).max(16).optional(),
  tone: z.enum(['direct', 'didactic', 'formal']).optional(), prompt: z.string().trim().min(1).max(4000).optional(),
  note: z.string().trim().min(1).max(4000).optional(), targetCharacters: z.number().int().min(2500).max(4000).optional(),
}).passthrough();

/** Never send a forged browser body or expired selection to a provider. */
export function validateArticleAssistInput(record: ProductionRecord, pieceId: string, kind: GenerationKind, value: unknown) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) return refuse('invalid_target', 'Confira o pedido e selecione um trecho válido.');
  const piece = record.pieces.find(piece => piece.id === pieceId), input = parsed.data;
  if (piece?.draft.body.type !== 'article') return refuse('unknown_piece', 'Artigo não encontrado.');
  if (piece.draft.revision !== input.baseRevision || contentHash(piece.draft.body) !== contentHash(input.body))
    return refuse('conflict', 'O texto mudou. Aguarde salvar e faça o pedido novamente.');
  if (JSON.stringify(input.body).length > 80000) return refuse('invalid_target', 'O texto é grande demais para este ajuste.');
  if (kind === 'article.ask' && !input.prompt || kind === 'article.apply-note' && !input.note)
    return refuse('empty_prompt', 'Escreva o ajuste que deseja pedir à IA.');
  const targets = input.target ?? input.anchors ?? [];
  const requiresTarget = ['article.rewrite', 'article.expand-from-source', 'article.to-list'].includes(kind);
  if (requiresTarget && !targets.length) return refuse('invalid_target', 'Selecione o trecho que deseja ajustar.');
  for (const [index, target] of targets.entries()) {
    const block = findBlock(piece.draft.body, target.blockId), text = sliceText(piece.draft.body, target);
    if (!block || !text?.trim() || target.from >= target.to || !['paragraph', 'quote', 'heading', 'list'].includes(block.type)
      || targets.slice(0, index).some(previous => previous.blockId === target.blockId && previous.from < target.to && target.from < previous.to))
      return refuse('invalid_target', 'O trecho selecionado mudou. Selecione novamente.');
    if (kind === 'article.to-list' && (block.type !== 'paragraph' || target.from !== 0 || target.to !== blockText(block).length))
      return refuse('invalid_target', 'Para virar lista, selecione um parágrafo inteiro.');
  }
  return ok(true as const);
}

type Evidence = { id: string; text: string; ref: SourceRef; speaker?: string; memory?: WritingMemoryContext };
export type AssistContext = { kind: GenerationKind; body: ArticleBody; targets: TextRange[]; evidence: Evidence[]; prompt: string; tone?: string; targetCharacters?: number };
/** Relevant literal excerpts only: no expensive whole-podcast rewrite for an inline request. */
export function articleAssistContext(record: ProductionRecord, job: Pick<EditorialJob, 'kind' | 'input'>, people: readonly Person[] = []): AssistContext {
  const input = job.input as { body: ArticleBody; target?: TextRange[]; anchors?: TextRange[]; prompt?: string; note?: string; tone?: string; targetCharacters?: number };
  const sources = writingSources(record.sources);
  const body = input.body, explicit = input.target ?? input.anchors;
  const targets = explicit?.length ? explicit : body.blocks.filter(block => block.type === 'paragraph' || block.type === 'quote')
    .filter(block => blockText(block).trim()).slice(0,16).map(block => ({ blockId: block.id, from: 0, to: blockText(block).length }));
  const prompt = input.prompt ?? input.note ?? '';
  const targetIds = new Set(targets.map(target => target.blockId)), evidence: Evidence[] = [], seen = new Set<string>();
  let size = 0;
  const add = (text: string, ref: SourceRef, speaker?: string) => {
    const source = sources.find(source => source.id === ref.sourceId);
    const binding = source?.memory && ref.locator.type === 'segment' ? memorySourceSegment(source, ref.sourceVersion, ref.locator.segmentId) : undefined;
    if (source?.memory && (!binding || !source.rights.authorized)) return;
    if (binding && source) {
      const label = sourceVersionSpeakers(source, source.versions.find(version => version.number === ref.sourceVersion)).find(item => item.label === speaker);
      speaker = people.find(person => person.id === label?.personId)?.name;
    }
    if (binding?.kind === 'statistic' && ref.locator.type === 'segment') {
      text = binding.anchor.excerpt; speaker = undefined;
      ref = segmentRef(ref.sourceId, ref.sourceVersion, ref.locator.segmentId, { from: 0, to: text.length });
    }
    const memory = binding ? writingMemoryContext(binding) : undefined;
    const cost = text.length + (memory ? JSON.stringify({ memory, ref }).length : 0);
    if (seen.has(refKey(ref)) || size + cost > 22000 || evidence.length >= 100) return;
    seen.add(refKey(ref)); size += cost;
    evidence.push({ id: String(evidence.length), text, ref, ...(speaker ? { speaker } : {}), ...(memory ? { memory } : {}) });
  };
  // Existing exact refs first preserve quotations spanning several transcript sentences.
  for (const block of body.blocks.filter(block => targetIds.has(block.id))) for (const ref of block.sourceRefs ?? []) {
    const resolved = resolveSourceRef(sources, ref);
    if (resolved) add(resolved.excerpt, ref, resolved.segment?.speaker);
  }
  const words = new Set((prompt + ' ' + targets.map(target => sliceText(body,target)).join(' ')).toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? []);
  const candidates = sources.flatMap(source => {
    const version = currentSourceVersion(source);
    return version.content.segments.map(segment => ({ text: segment.text, speaker: segment.speaker,
      ref: segmentRef(source.id,version.number,segment.id) }));
  }).map(candidate => ({ ...candidate,
    score: [...new Set(candidate.text.toLowerCase().match(/[\p{L}\p{N}]{5,}/gu) ?? [])].filter(word => words.has(word)).length,
  })).sort((a,b) => b.score - a.score);
  for (const candidate of candidates) if (candidate.score > 0 || !evidence.length) add(candidate.text, candidate.ref, candidate.speaker);
  return { kind: job.kind, body, targets, evidence, prompt, tone: input.tone, targetCharacters: input.targetCharacters };
}

/** Atomic proposals enforce scope, exact quotes and R1 limits before becoming acceptable. */
export function articleAssistSuggestions(value: unknown, context: AssistContext, record: ProductionRecord, runId: string): Suggestion[] {
  const output = articleAssistOutput.parse(value), used = new Set<number>(), byId = new Map(context.evidence.map(item => [item.id,item]));
  const label = context.kind === 'article.rewrite' ? REWRITE_TONE_LABELS[context.tone as keyof typeof REWRITE_TONE_LABELS] ?? 'Reescrever' : GENERATION_LABELS[context.kind];
  if (!output.reply && !output.changes.length) throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
  if (context.kind === 'article.titles' && output.changes.length && output.changes.length !== 3) throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
  const titles = new Set<string>();
  const literalEvidence = new Map(context.evidence.map(item => [item.id,item.text]));
  let combined = context.body;
  const piece = record.pieces.find(piece => piece.kind === 'article');
  const limits = piece ? articleContractForPiece(record, piece, context.body) : articleContractFor(record.production.brief);
  const checkSize = (afterBody: ArticleBody) => {
    const before = articleStats(context.body), after = articleStats(afterBody);
    if (!r1ArticleIssue(context.body,record.sources,limits) && r1ArticleIssue(afterBody,record.sources,limits)
      || after.characters > Math.max(before.characters,limits.maxChars) || limits.maxWords !== undefined && after.words > Math.max(before.words,limits.maxWords)
      || after.characters < Math.min(before.characters,limits.minChars) || limits.minWords !== undefined && after.words < Math.min(before.words,limits.minWords))
      throw new FlowError('ASSIST_SIZE_CONFLICT',502,true,5);
  };
  const suggestions = output.changes.map((change,index) => {
    if (change.evidenceIds.some(id => !byId.has(id))) throw new FlowError('UNKNOWN_EVIDENCE',502,true,5);
    const sourceRefs = dedupeRefs(change.evidenceIds.map(id => byId.get(id)!.ref));
    let target: TextRange[] = [], proposal: SuggestionProposal;
    if (change.kind === 'title') {
      if (context.kind !== 'article.titles' || !change.text || change.text.length > 150 || titles.has(change.text) || change.items.length)
        throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
      titles.add(change.text); proposal = { kind: 'title', text: change.text };
    } else {
      const range = context.targets[change.targetIndex], block = range && findBlock(context.body,range.blockId);
      if (!range || !block || used.has(change.targetIndex)) throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
      used.add(change.targetIndex); target = [range];
      const original = sliceText(context.body,range)!;
      if (change.kind === 'list') {
        if (context.kind !== 'article.to-list' || block.type !== 'paragraph' || range.from !== 0 || range.to !== blockText(block).length || change.text || !change.items.length)
          throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
        proposal = { kind: 'replace-blocks', blocks: [{ id: block.id, type: 'list', ordered: false,
          items: change.items.map(text => [{ text }]), sourceRefs: dedupeRefs([...(block.sourceRefs ?? []), ...sourceRefs]), ai: 'unreviewed' }] };
      } else if (change.kind === 'heading') {
        if (context.kind !== 'article.subheadings' || block.type !== 'paragraph' || range.from !== 0 || range.to !== blockText(block).length || !change.text || change.text.length > 120 || change.items.length)
          throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
        const heading: ArticleBlock = { id: runId+':heading:'+index, type: 'heading', level: 2, inlines: [{ text: change.text }], ai: 'unreviewed' };
        proposal = { kind: 'replace-blocks', blocks: [heading, block] };
      } else {
        if (['article.titles','article.to-list','article.subheadings'].includes(context.kind) || !change.text || change.items.length || change.text === original
          || context.kind === 'article.shorten' && change.text.length >= original.length
          || context.kind === 'article.expand-from-source' && (!sourceRefs.length || change.text.length <= original.length))
          throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
        proposal = { kind: 'replace-text', text: change.text, ...(sourceRefs.length ? { sourceRefs } : {}) };
      }
      const proposedText = change.kind === 'list' ? change.items.join('\n') : change.text;
      if (change.kind !== 'heading' && directQuotes(original).some(quote => !hasQuote(literalQuoteText(proposedText), quote)))
        throw new FlowError('ASSIST_QUOTES_REMOVED',502,true,5);
      if (block.type === 'quote' && proposedText !== original)
        throw new FlowError('UNSUPPORTED_ARTICLE_QUOTE',502,true,5);
    }
    const proposedText = change.kind === 'list' ? change.items.join('\n') : change.text;
    if (articleQuotationIssue([{ text: proposedText, evidenceIds: change.evidenceIds }],literalEvidence))
      throw new FlowError('UNSUPPORTED_ARTICLE_QUOTE',502,true,5);
    const candidate: Suggestion = { id: runId+':suggestion:'+index, runId, pieceId: '', baseRevision: 0, target,
      anchorText: target.map(range => sliceText(context.body,range)!), proposal, state: 'ready', label, createdAt: new Date().toISOString() };
    const prepared = prepareMemorySuggestion(context.body, record.sources, candidate);
    if (!prepared.ok) throw new FlowError(prepared.refusal.code === 'invalid_target' ? 'INVALID_PROVIDER_OUTPUT' : 'ASSIST_MEMORY_CONTEXT_CHANGED',502,true,5);
    const suggestion = prepared.value;
    const applied = applySuggestion(context.body,suggestion);
    if (!applied.ok) throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
    if (proposal.kind !== 'title') {
      checkSize(applied.value);
      const next = applySuggestion(combined,suggestion);
      if (!next.ok) throw new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
      combined = next.value;
    }
    return suggestion;
  });
  checkSize(combined);
  return suggestions;
}

export async function runArticleAssist(job: EditorialJob, record: ProductionRecord, signal: AbortSignal,
  guarded: (events: RunEventPayload[], call?: import('../domain/pipeline.ts').PipelineCall) => Promise<unknown>, directory?: string, people: readonly Person[] = []) {
  const context = articleAssistContext(record,job,people), pipeline = job.pipeline;
  if (!pipeline?.definition.steps.assist) throw new FlowError('PIPELINE_STAGE_MISSING',503);
  if (!context.body.blocks.length && job.kind !== 'article.ask') throw new FlowError('EMPTY_ARTICLE',422);
  await guarded([{ type: 'assist.preview',reply: '',proposals: [] }, { type: 'step.completed',stepId: 'source' },
    { type: 'step.started',stepId: 'assist',meta: 'Aguardando a IA · seu texto está preservado' }]);
  let lastAt = 0, lastPreview = '';
  const onText = async (text: string) => {
    if (Date.now()-lastAt < 400) return;
    const strings = partialJsonStrings(text), reply = strings.get('reply') ?? '', proposals = [];
    for (let index=0; index<16; index++) {
      const items = Array.from({ length: 12 },(_,item) => strings.get(`changes.${index}.items.${item}`)).filter(Boolean);
      const value = strings.get(`changes.${index}.text`) || items.join('\n');
      if (value) proposals.push({ id: job.meta.runId+':preview:'+index,text: value });
    }
    const preview = JSON.stringify({ reply,proposals });
    if (preview === lastPreview || !reply && !proposals.length) return;
    await guarded([{ type: 'assist.preview',reply,proposals }, { type: 'step.progress',stepId: 'assist',meta: 'Escrevendo · prévia em tempo real' }]);
    lastAt = Date.now(); lastPreview = preview;
  };
  const result = await executePipelineStep({ pipeline,key: 'assist',schema: PIPELINE_SCHEMAS.assist,
    directory: directory ?? await workDirectory(job.meta.runId), signal, trace: call => guarded([],call).then(() => undefined), onText,
    variables: { source: JSON.stringify(context.evidence.map(({ id,text,speaker,memory,ref }) => ({ id,text,...(speaker ? { speaker } : {}), ...(memory ? { memory, ref } : {}) }))),
      brief: JSON.stringify(record.production.brief), history: JSON.stringify({ title: context.body.title, blocks: context.body.blocks
        .filter(block => ['paragraph','heading','quote','list'].includes(block.type)).map(block => ({ id: block.id,type: block.type,text: blockText(block) })) }),
      sizing: JSON.stringify({ ...articleContractForPiece(record, record.pieces.find(piece => piece.id === job.meta.pieceId)!, context.body), current: articleStats(context.body), targetCharacters: context.targetCharacters,
        sourceCoverage: 'selected-literal-excerpts', ...(context.evidence.some(item => item.memory) ? { bankEvidenceRules: {
          statistic: 'Preserve the entire selected observation in one paragraph or list item, including number, unit, period, population, geography and qualifiers. Never present it as speech.',
          citation: 'Use only a contiguous literal excerpt, preserving its whitespace and exact immutable source/version receipt.',
        } } : {}) }), section: JSON.stringify({ action: context.kind,prompt: context.prompt,tone: context.tone,
        targets: context.targets.map((range,index) => ({ index, ...range,text: sliceText(context.body,range),blockType: findBlock(context.body,range.blockId)?.type })) }),
      outline: '', futureSections: '', layouts: '', approvedArticle: '', event: '', people: '' },
    validateOutput: value => { try { articleAssistSuggestions(value,context,record,job.meta.runId); return true; } catch { return false; } },
  });
  await guarded([{ type: 'step.completed',stepId: 'assist' }, { type: 'step.started',stepId: 'validate' }]);
  const output = articleAssistOutput.parse(result.value), suggestions = articleAssistSuggestions(result.value,context,record,job.meta.runId);
  const events: RunEventPayload[] = [];
  if (output.reply) events.push({ type: 'block.completed',block: { id: job.meta.runId+':reply',type: 'paragraph',inlines: [{ text: output.reply }] } });
  for (const suggestion of suggestions) events.push({ type: 'suggestion',suggestionId: suggestion.id,target: suggestion.target,proposal: suggestion.proposal,label: suggestion.label });
  if (result.input_units !== null && result.output_units !== null) events.push({ type: 'usage',usage: {
    inputTokens: result.input_units,outputTokens: result.output_units,totalTokens: result.input_units+result.output_units } });
  events.push({ type: 'step.completed',stepId: 'validate',meta: suggestions.length ? 'Propostas prontas para aceitar ou descartar' : 'Resposta pronta · texto preservado' },{ type: 'run.completed' });
  await guarded(events);
  return result;
}
