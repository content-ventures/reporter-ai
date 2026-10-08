import { blockText, findBlock, listBlock, paragraphBlock, sliceText } from '../../../domain/article.ts';
import type { ArticleBlock, ArticleBody } from '../../../domain/article.ts';
import { extractQuotes } from '../../../domain/quotes.ts';
import { segmentRef } from '../../../domain/refs.ts';
import type { SourceRef, TextRange } from '../../../domain/refs.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import { findSegment, resolveSourceRef } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import type { SuggestionProposal } from '../../../domain/suggestion.ts';
import { foldForMatch } from '../../../domain/text/normalize.ts';
import { countWords } from '../../../domain/text/stats.ts';
import { GENERATION_LABELS, REWRITE_TONE_LABELS } from '../../../ports/generation.ts';
import type { GenerationKind, RewriteTone, StartRefusal } from '../../../ports/generation.ts';
import type { RewriteVariant, ScriptBook } from '../../../ports/script-book.ts';
import { trimDangling } from '../../../domain/text/slide-text.ts';
import { keywords, readMaterial } from './material.ts';
import { cutWords, sentenceSpans, withoutFinalPeriod } from './sentences.ts';
import { rewrite, sameText, shorten, toListItems } from './transforms.ts';

/**
 * Output of an inline action, computed before streaming: the copilot reply, the suggestions to
 * stream (each previewed as a block whose id is the suggestion id) and the evidence used. A
 * selection that no longer exists, or an action with nothing to change, is refused up front.
 */

export type PlannedSuggestion = {
  /** Streamed block that shows the proposal while it is written (id = suggestion id). */
  preview: ArticleBlock;
  target: TextRange[];
  proposal: SuggestionProposal;
  label: string;
};

export type AssistPlan = {
  /** Copilot reply paragraphs ("Perguntar à IA"). */
  reply: ArticleBlock[];
  suggestions: PlannedSuggestion[];
  sourcesUsed: SourceRef[];
  /** Meta of the writing step ("Mais direto", "3 títulos"). */
  meta: string;
};

type NewId = (prefix: string) => string;

export type AssistContext = { sources: readonly Source[]; scripts?: ScriptBook; newId: NewId };

type Located = { block: ArticleBlock; range: TextRange; text: string; wholeBlock: boolean };

function locate(body: ArticleBody, target: readonly TextRange[] | undefined, wholeBlock: boolean): Result<Located, StartRefusal> {
  if (!target || target.length !== 1) return refuse('invalid_target', 'Selecione um trecho dentro de um único bloco.');
  const [range] = target;
  const block = findBlock(body, range.blockId);
  if (!block || block.type === 'divider') return refuse('invalid_target', 'O trecho selecionado não existe mais no texto.');
  const full = blockText(block);
  const effective = wholeBlock ? { blockId: block.id, from: 0, to: full.length } : range;
  const text = sliceText(body, effective);
  if (text === undefined || !text.trim()) return refuse('invalid_target', 'Selecione um trecho com texto.');
  return ok({ block, range: effective, text, wholeBlock: text.trim() === full.trim() });
}

/** Hand-written rewrite of a whole fixture block, when the selection is that block. */
function scripted(context: AssistContext, located: Located, variant: RewriteVariant): string | undefined {
  if (!context.scripts || !located.wholeBlock) return undefined;
  for (const source of context.sources) {
    const text = context.scripts.rewrite(source.id, located.block.id, variant);
    if (text) return text;
  }
  return undefined;
}

function scriptedList(context: AssistContext, pick: (scripts: ScriptBook, sourceId: string) => string[]): string[] {
  if (!context.scripts) return [];
  for (const source of context.sources) {
    const values = pick(context.scripts, source.id);
    if (values.length > 0) return values;
  }
  return [];
}

function textSuggestion(newId: NewId, range: TextRange, text: string, label: string): PlannedSuggestion {
  const id = newId('sug');
  return { preview: paragraphBlock(id, text, { ai: 'unreviewed' }), target: [range], proposal: { kind: 'replace-text', text }, label };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const NO_CHANGE: Record<RewriteTone, string> = {
  direct: 'O trecho já está direto.',
  didactic: 'O trecho já está em frases curtas.',
  formal: 'O trecho já está no registro formal.',
};

export function planRewrite(body: ArticleBody, target: readonly TextRange[], tone: RewriteTone, context: AssistContext): Result<AssistPlan, StartRefusal> {
  const located = locate(body, target, false);
  if (!located.ok) return located;
  const text = scripted(context, located.value, tone) ?? rewrite(located.value.text, tone);
  if (sameText(text, located.value.text)) return refuse('no_change', NO_CHANGE[tone]);
  const label = REWRITE_TONE_LABELS[tone];
  return ok({ reply: [], suggestions: [textSuggestion(context.newId, located.value.range, text, label)], sourcesUsed: [], meta: label });
}

/** Shortens one paragraph-like block; undefined when nothing can go without losing information. */
function shortenBlock(context: AssistContext, located: Located): string | undefined {
  const text = scripted(context, located, 'shorter') ?? shorten(located.text);
  return text.trim() && countWords(text) < countWords(located.text) ? text : undefined;
}

export function planShorten(
  body: ArticleBody,
  target: readonly TextRange[] | undefined,
  targetWords: number | undefined,
  context: AssistContext,
): Result<AssistPlan, StartRefusal> {
  const label = GENERATION_LABELS['article.shorten'];
  if (target && target.length > 0) {
    const located = locate(body, target, false);
    if (!located.ok) return located;
    const text = shortenBlock(context, located.value);
    if (!text) return refuse('no_change', 'Não há o que encurtar sem perder informação.');
    return ok({
      reply: [],
      suggestions: [textSuggestion(context.newId, located.value.range, text, label)],
      sourcesUsed: [],
      meta: `${countWords(located.value.text)} → ${countWords(text)} palavras`,
    });
  }
  // Whole document: longest paragraphs first, until the projected total reaches the target.
  const total = body.blocks.reduce((sum, block) => sum + countWords(blockText(block)), 0);
  const goal = targetWords ?? Math.round(total * 0.8);
  if (total <= goal) return refuse('no_change', `O texto já tem ${total} palavras.`);
  const candidates = body.blocks
    .filter((block) => block.type === 'paragraph')
    .sort((a, b) => countWords(blockText(b)) - countWords(blockText(a)));
  let projected = total;
  const suggestions: PlannedSuggestion[] = [];
  for (const block of candidates) {
    if (projected <= goal) break;
    const full = blockText(block);
    const located: Located = { block, range: { blockId: block.id, from: 0, to: full.length }, text: full, wholeBlock: true };
    const text = shortenBlock(context, located);
    if (!text) continue;
    projected -= countWords(full) - countWords(text);
    suggestions.push(textSuggestion(context.newId, located.range, text, label));
  }
  if (suggestions.length === 0) return refuse('no_change', 'Não há o que encurtar sem perder informação.');
  const order = new Map(body.blocks.map((block, index) => [block.id, index]));
  suggestions.sort((a, b) => (order.get(a.target[0].blockId) ?? 0) - (order.get(b.target[0].blockId) ?? 0));
  return ok({ reply: [], suggestions, sourcesUsed: [], meta: `${total} → ${projected} palavras` });
}

export function planToList(body: ArticleBody, target: readonly TextRange[], context: AssistContext): Result<AssistPlan, StartRefusal> {
  const located = locate(body, target, true);
  if (!located.ok) return located;
  const { block } = located.value;
  if (block.type !== 'paragraph') return refuse('invalid_target', 'Só parágrafos viram lista.');
  const items = toListItems(located.value.text);
  if (items.length < 2) return refuse('no_change', 'Precisa de pelo menos duas frases para virar lista.');
  const id = context.newId('sug');
  const list = listBlock(block.id, items, false, { ai: 'unreviewed', ...(block.sourceRefs ? { sourceRefs: block.sourceRefs } : {}) });
  return ok({
    reply: [],
    suggestions: [{ preview: { ...list, id }, target: [located.value.range], proposal: { kind: 'replace-blocks', blocks: [list] }, label: GENERATION_LABELS['article.to-list'] }],
    sourcesUsed: [],
    meta: `${items.length} itens`,
  });
}

/** Segment refs of a block, or the segment that shares most content words with it. */
function evidenceOf(block: ArticleBlock, sources: readonly Source[]): SourceRef[] {
  const own = (block.sourceRefs ?? []).filter((ref) => ref.locator.type === 'segment' && resolveSourceRef(sources, ref));
  if (own.length > 0) return own;
  const wanted = new Set(keywords(blockText(block)));
  let best: { ref: SourceRef; hits: number } | undefined;
  for (const line of readMaterial(sources).lines) {
    const hits = keywords(line.text).filter((word) => wanted.has(word)).length;
    if (hits >= 2 && (!best || hits > best.hits)) best = { ref: segmentRef(line.sourceId, line.sourceVersion, line.segmentId), hits };
  }
  return best ? [best.ref] : [];
}

/** Marina Lopes acrescenta: “…”. (verbatim, attributed to the transcript speaker) */
function quotedAddition(speaker: string | undefined, text: string): string {
  const inner = withoutFinalPeriod(text);
  return speaker ? `${speaker} acrescenta: “${inner}”.` : `“${inner}”.`;
}

export function planExpand(body: ArticleBody, target: readonly TextRange[], context: AssistContext): Result<AssistPlan, StartRefusal> {
  const located = locate(body, target, true);
  if (!located.ok) return located;
  const { block } = located.value;
  const evidence = evidenceOf(block, context.sources);
  if (evidence.length === 0) return refuse('no_source', 'Este trecho não tem fala de origem para expandir.');
  const present = foldForMatch(blockText(block));
  for (const ref of evidence) {
    if (ref.locator.type !== 'segment') continue;
    const source = context.sources.find((candidate) => candidate.id === ref.sourceId);
    const segment = source ? findSegment(source, ref.sourceVersion, ref.locator.segmentId) : undefined;
    if (!source || !segment) continue;
    const after = ref.locator.to ?? 0;
    const fresh = sentenceSpans(segment.text).filter(
      (sentence) => !sentence.text.includes('?') && sentence.words >= 4 && !present.includes(foldForMatch(sentence.text)),
    );
    const ordered = [...fresh.filter((sentence) => sentence.from >= after), ...fresh.filter((sentence) => sentence.from < after)];
    const first = ordered[0];
    if (!first) continue;
    const second = ordered.find((sentence) => sentence.from >= first.to && segment.text.slice(first.to, sentence.from).trim() === '');
    const range = { from: first.from, to: (second ?? first).to };
    const limited = cutWords(segment.text.slice(range.from, range.to), 60);
    const evidenceRef = segmentRef(source.id, ref.sourceVersion, segment.id, { from: range.from, to: range.from + limited.text.length });
    const id = context.newId('sug');
    const text = quotedAddition(segment.speaker, limited.cut ? `${limited.text}…` : limited.text);
    const addition = paragraphBlock(context.newId('blk'), text, { ai: 'unreviewed', sourceRefs: [evidenceRef] });
    return ok({
      reply: [],
      suggestions: [
        {
          preview: { ...addition, id },
          target: [located.value.range],
          proposal: { kind: 'replace-blocks', blocks: [block, addition] },
          label: GENERATION_LABELS['article.expand-from-source'],
        },
      ],
      sourcesUsed: [evidenceRef],
      meta: segment.speaker ? `Fala de ${segment.speaker}` : 'Trecho da fonte',
    });
  }
  return refuse('no_change', 'A fala de origem já está toda no texto.');
}

function quoteTitles(body: ArticleBody, sources: readonly Source[]): string[] {
  return extractQuotes(body)
    .filter((quote) => countWords(quote.text) <= 12)
    .map((quote) => {
      const speaker = quote.sourceRefs.map((ref) => resolveSourceRef(sources, ref)?.segment?.speaker).find(Boolean);
      const text = withoutFinalPeriod(quote.text);
      return speaker ? `“${text}”, diz ${speaker}` : `“${text}”`;
    });
}

export function planTitles(body: ArticleBody, context: AssistContext): Result<AssistPlan, StartRefusal> {
  const fromScript = scriptedList(context, (scripts, sourceId) => scripts.titles(sourceId));
  const candidates =
    fromScript.length > 0
      ? fromScript
      : [
          ...quoteTitles(body, context.sources),
          ...body.blocks.filter((block) => block.type === 'heading' && !blockText(block).includes('?')).map(blockText),
          ...body.blocks
            .filter((block) => block.type === 'paragraph')
            .map((block) => sentenceSpans(blockText(block))[0])
            .filter((sentence) => sentence !== undefined && sentence.words <= 14 && !/^[“"«]/.test(sentence.text))
            .map((sentence) => withoutFinalPeriod(sentence.text)),
        ];
  const seen = new Set<string>([foldForMatch(body.title)]);
  const titles: string[] = [];
  for (const candidate of candidates) {
    const key = foldForMatch(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titles.push(candidate.trim());
    if (titles.length === 3) break;
  }
  if (titles.length === 0) return refuse('no_change', 'Não encontrei no texto material para outros títulos.');
  return ok({
    reply: [],
    suggestions: titles.map((text) => {
      const id = context.newId('sug');
      return { preview: paragraphBlock(id, text, { ai: 'unreviewed' }), target: [], proposal: { kind: 'title', text }, label: 'Título alternativo' };
    }),
    sourcesUsed: [],
    meta: plural(titles.length, 'título', 'títulos'),
  });
}

/** "Sugerir intertítulos": hand-written alternatives for the section headings (fixtures only). */
export function planSubheadings(body: ArticleBody, context: AssistContext): Result<AssistPlan, StartRefusal> {
  const alternatives = scriptedList(context, (scripts, sourceId) => scripts.subheadings(sourceId));
  const headings = body.blocks.filter((block) => block.type === 'heading' && block.level === 2);
  const suggestions = headings.flatMap((heading, index) => {
    const text = alternatives[index];
    const current = blockText(heading);
    if (!text || foldForMatch(text) === foldForMatch(current)) return [];
    return [textSuggestion(context.newId, { blockId: heading.id, from: 0, to: current.length }, text, GENERATION_LABELS['article.subheadings'])];
  });
  if (suggestions.length === 0) return refuse('no_change', 'Sem sugestões de intertítulos para este material.');
  return ok({ reply: [], suggestions, sourcesUsed: [], meta: plural(suggestions.length, 'intertítulo', 'intertítulos') });
}

/** Free-prompt intents the simulation can honour with a real transform. */
const INTENTS: readonly [RegExp, GenerationKind, RewriteTone?][] = [
  [/did[aá]tic|explic|simples/i, 'article.rewrite', 'didactic'],
  [/formal/i, 'article.rewrite', 'formal'],
  [/diret|objetiv|enxut/i, 'article.rewrite', 'direct'],
  [/encurt|resum|curt|reduz/i, 'article.shorten'],
  [/lista|t[oó]picos/i, 'article.to-list'],
  [/expand|desenvolv|aprofund/i, 'article.expand-from-source'],
  [/intert[ií]tul|subt[ií]tul/i, 'article.subheadings'],
  [/t[ií]tulo/i, 'article.titles'],
];

function replyBlock(newId: NewId, text: string, sourceRefs?: SourceRef[]): ArticleBlock {
  return paragraphBlock(newId('reply'), text, sourceRefs && sourceRefs.length > 0 ? { sourceRefs } : {});
}

function delegate(
  kind: GenerationKind,
  tone: RewriteTone | undefined,
  body: ArticleBody,
  target: readonly TextRange[] | undefined,
  context: AssistContext,
): Result<AssistPlan, StartRefusal> | undefined {
  if (kind === 'article.titles') return planTitles(body, context);
  if (kind === 'article.subheadings') return planSubheadings(body, context);
  if (kind === 'article.shorten') return planShorten(body, target, undefined, context);
  if (!target || target.length === 0) return undefined;
  if (kind === 'article.rewrite') return planRewrite(body, target, tone ?? 'direct', context);
  if (kind === 'article.to-list') return planToList(body, target, context);
  return planExpand(body, target, context);
}

/**
 * "Perguntar à IA". Without a model the simulation is honest: a request it recognises runs the
 * matching transform; a question is answered only with transcript excerpts (or says it found none).
 */
export function planAsk(body: ArticleBody, prompt: string, target: readonly TextRange[] | undefined, context: AssistContext): Result<AssistPlan, StartRefusal> {
  const question = prompt.trim();
  if (!question) return refuse('empty_prompt', 'Escreva a pergunta.');

  const intent = INTENTS.find(([pattern]) => pattern.test(question));
  if (intent) {
    const [, kind, tone] = intent;
    const delegated = delegate(kind, tone, body, target, context);
    if (!delegated) return ok({ reply: [replyBlock(context.newId, 'Selecione o trecho no texto e peça de novo.')], suggestions: [], sourcesUsed: [], meta: 'Resposta' });
    if (!delegated.ok) return ok({ reply: [replyBlock(context.newId, delegated.refusal.message)], suggestions: [], sourcesUsed: [], meta: 'Resposta' });
    const count = delegated.value.suggestions.length;
    const label = kind === 'article.rewrite' ? REWRITE_TONE_LABELS[tone ?? 'direct'] : GENERATION_LABELS[kind];
    const reply = count === 1 ? `Sugestão pronta: ${label.toLocaleLowerCase('pt-BR')}.` : `${count} sugestões prontas.`;
    return ok({ ...delegated.value, reply: [replyBlock(context.newId, reply)] });
  }

  const wanted = new Set(keywords(question));
  const hits = readMaterial(context.sources)
    .lines.map((line) => ({ line, score: keywords(line.text).filter((word) => wanted.has(word)).length }))
    .filter((entry) => entry.score > 0 && !entry.line.question && entry.line.sentences.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  if (hits.length === 0) {
    return ok({
      reply: [replyBlock(context.newId, 'Não encontrei esse assunto no material.')],
      suggestions: [],
      sourcesUsed: [],
      meta: 'Sem trechos',
    });
  }
  const excerpts = hits.map(({ line }) => {
    const best = line.sentences
      .map((span) => ({ span, score: keywords(span.text).filter((word) => wanted.has(word)).length }))
      .sort((a, b) => b.score - a.score)[0];
    const sentence = best?.span ?? line.sentences[0];
    const ref = segmentRef(line.sourceId, line.sourceVersion, line.segmentId, { from: sentence.from, to: sentence.to });
    const who = line.speaker ? `, diz ${line.speaker}` : '';
    return replyBlock(context.newId, `“${withoutFinalPeriod(sentence.text)}”${who}.`, [ref]);
  });
  return ok({
    reply: [replyBlock(context.newId, hits.length === 1 ? 'Encontrei este trecho no material:' : 'Encontrei estes trechos no material:'), ...excerpts],
    suggestions: [],
    sourcesUsed: excerpts.flatMap((block) => block.sourceRefs ?? []),
    meta: plural(hits.length, 'trecho', 'trechos'),
  });
}

/** A heading for a section from its own text: the first clause of its first paragraph (≤ 8 words). */
function headingFromSection(body: ArticleBody, heading: ArticleBlock): string | undefined {
  const index = body.blocks.findIndex((block) => block.id === heading.id);
  const next = body.blocks.slice(index + 1).find((block) => block.type === 'paragraph' || block.type === 'heading');
  if (!next || next.type !== 'paragraph') return undefined;
  const text = blockText(next);
  const quoted = /“([^”]+)”/.exec(text)?.[1] ?? text;
  const clause = quoted.split(/[,;:—–]\s+/)[0] ?? quoted;
  const result = withoutFinalPeriod(trimDangling(cutWords(clause, 8).text));
  if (countWords(result) < 3) return undefined;
  return result.charAt(0).toLocaleUpperCase('pt-BR') + result.slice(1);
}

function scriptedVariant(context: AssistContext, blockId: string, variant: RewriteVariant): string | undefined {
  if (!context.scripts) return undefined;
  for (const source of context.sources) {
    const text = context.scripts.rewrite(source.id, blockId, variant);
    if (text) return text;
  }
  return undefined;
}

export const APPLY_NOTE_LABELS = { heading: 'Ajustar intertítulo', passage: 'Ajustar trecho' } as const;

/**
 * "Aplicar nota com IA": one suggestion per block the reviewer pointed at, as the note asks —
 * a new heading for a heading, a rewrite of the paragraph otherwise. The simulation does not
 * read the note: hand-written fixes come from the script book, other material gets the direct
 * rewrite (or the shortened text) of the passage. Without pointed passages it answers like
 * "Perguntar à IA" with the note as the question.
 */
export function planApplyNote(body: ArticleBody, note: string, anchors: readonly TextRange[], context: AssistContext): Result<AssistPlan, StartRefusal> {
  if (anchors.length === 0) return planAsk(body, note, undefined, context);
  const headings = body.blocks.filter((block) => block.type === 'heading' && block.level === 2);
  const alternatives = scriptedList(context, (scripts, sourceId) => scripts.subheadings(sourceId));
  const suggestions: PlannedSuggestion[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const block = findBlock(body, anchor.blockId);
    if (!block || block.type === 'divider' || block.type === 'list' || seen.has(block.id)) continue;
    seen.add(block.id);
    const full = blockText(block);
    if (!full.trim()) continue;
    const range = { blockId: block.id, from: 0, to: full.length };
    const isHeading = block.type === 'heading';
    const position = headings.findIndex((heading) => heading.id === block.id);
    const text = isHeading
      ? (scriptedVariant(context, block.id, 'note') ?? (position >= 0 ? alternatives[position] : undefined) ?? headingFromSection(body, block))
      : (scriptedVariant(context, block.id, 'note') ??
        [rewrite(full, 'direct'), shorten(full)].find((candidate) => candidate.trim() && !sameText(candidate, full)));
    if (!text || sameText(text, full)) continue;
    suggestions.push(textSuggestion(context.newId, range, text, isHeading ? APPLY_NOTE_LABELS.heading : APPLY_NOTE_LABELS.passage));
  }
  if (suggestions.length === 0) {
    return refuse('no_change', 'Não encontrei como ajustar os trechos apontados sem inventar. Edite-os no texto.');
  }
  return ok({ reply: [], suggestions, sourcesUsed: [], meta: plural(suggestions.length, 'trecho ajustado', 'trechos ajustados') });
}
