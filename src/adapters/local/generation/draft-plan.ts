import { articleStats, headingBlock, paragraphBlock, quoteBlock } from '../../../domain/article.ts';
import type { ArticleBlock, HeadingBlock } from '../../../domain/article.ts';
import { briefHash, LENGTH_TARGETS, LENGTH_TOLERANCE } from '../../../domain/production.ts';
import type { Brief } from '../../../domain/production.ts';
import { dedupeRefs } from '../../../domain/refs.ts';
import type { SourceRef } from '../../../domain/refs.ts';
import { currentSourceVersion, resolveSourceRef } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import { countWords } from '../../../domain/text/stats.ts';
import type { ArticleDraftScript } from '../../../ports/script-book.ts';
import { createVoices, headingOf, headline, headlineLine, keyPhrase, reportedSpeech } from './editorial.ts';
import type { SpeakerInfo, Voices } from './editorial.ts';
import { groupUnits, keywords, lineRef, lineSentences, pickKeyQuotes, quoteScore, readMaterial, sentenceRef } from './material.ts';
import type { Material, MaterialLine, QaUnit, Sentence } from './material.ts';
import { createRng } from './random.ts';
import type { Rng } from './random.ts';
import { capitalize, cutWords, sentenceSpans, withoutFinalPeriod } from './sentences.ts';

/**
 * The full output of an "article.draft" run, computed before streaming starts so that steps,
 * retries and the outline review stay deterministic. Hand-written scripts win; otherwise the
 * EXTRACTIVE path selects verbatim sentences: the answers closest to the brief's angle become
 * reported speech with the speaker's name and role, headings and the headline are verbatim key
 * clauses of the answers, the last section closes on its key quote, quotes are verbatim. It
 * draws as much of the material as the length asks (D10: within ±10% of 500/800/1200 words),
 * never more than all of it: a short material yields a shorter article, never invented text.
 */

export type DraftSection = {
  stepId: string;
  heading: HeadingBlock;
  blocks: ArticleBlock[];
};

export type DraftPlan = {
  origin: 'script' | 'extractive';
  title: string;
  material: { segments: number; speakers: number };
  keyQuotes: SourceRef[];
  intro: ArticleBlock[];
  sections: DraftSection[];
};

export type DraftPlanRefusal = 'material_too_short';

type NewId = (prefix: string) => string;

/** The article may draw at most this share of the material's answer words (all of it). */
export const MAX_MATERIAL_SHARE = 1;
export const MIN_ANSWER_WORDS = 60;
const PARAGRAPH_MAX_WORDS = 70;
const PREAMBLE_MAX_WORDS = 60;
/** Shorter excerpts read as stray fragments ("E tem uma resistência de hábito."). */
const MIN_PARAGRAPH_WORDS = 10;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function materialMeta(plan: Pick<DraftPlan, 'material'>): string {
  return `${plural(plan.material.segments, 'fala', 'falas')} · ${plural(plan.material.speakers, 'falante', 'falantes')}`;
}

function countSpeakers(sources: readonly Source[]): { segments: number; speakers: number } {
  const material = readMaterial(sources);
  return { segments: material.lines.length, speakers: material.speakers.length };
}

/** Keeps only refs that resolve in the cited source version (scripts are data, data can drift). */
function resolvable(sources: readonly Source[], refs: readonly SourceRef[] | undefined): SourceRef[] {
  return (refs ?? []).filter((ref) => resolveSourceRef(sources, ref) !== undefined);
}

/** Script blocks keep their ids (fixture rewrites are keyed by them) and start unreviewed. */
function scriptBlock(block: ArticleBlock, sources: readonly Source[]): ArticleBlock {
  const refs = resolvable(sources, block.sourceRefs);
  const next: ArticleBlock = { ...block, ai: 'unreviewed' };
  if (refs.length > 0) next.sourceRefs = refs;
  else delete next.sourceRefs;
  return next;
}

/**
 * Plan from a hand-written script. Returns undefined when the script does not apply (another
 * source version, no sections, missing headings), so the caller falls back to the extractive path.
 */
/** A script answers the brief it was written for; an edited brief (A08) goes through the material. */
export function scriptFitsBrief(script: Pick<ArticleDraftScript, 'brief'>, brief: Brief | undefined): boolean {
  if (!script.brief || !brief) return true;
  return briefHash({ ...script.brief, revision: 0 }) === briefHash(brief);
}

export function planFromScript(script: ArticleDraftScript, sources: readonly Source[], newId: NewId, brief?: Brief): DraftPlan | undefined {
  const source = sources.find((candidate) => candidate.id === script.sourceId);
  if (!source || currentSourceVersion(source).number !== script.sourceVersion) return undefined;
  if (!scriptFitsBrief(script, brief)) return undefined;
  const intro = script.sections.find((section) => section.id === 'intro');
  const bodySections = script.sections.filter((section) => section.id !== 'intro');
  if (bodySections.length === 0) return undefined;
  const sections: DraftSection[] = bodySections.map((section, index) => {
    const blocks = section.blocks.map((block) => scriptBlock(block, sources));
    const headingIndex = blocks.findIndex((block) => block.type === 'heading');
    const outlined = script.outline[index]?.title ?? section.label;
    const heading: HeadingBlock =
      headingIndex >= 0 ? (blocks[headingIndex] as HeadingBlock) : headingBlock(newId('blk'), outlined, 2, { ai: 'unreviewed' });
    return {
      stepId: `section-${index + 1}`,
      heading,
      blocks: blocks.filter((_, position) => position !== headingIndex),
    };
  });
  return {
    origin: 'script',
    title: script.title.trim(),
    material: countSpeakers(sources),
    keyQuotes: resolvable(sources, script.keySegments),
    intro: (intro?.blocks ?? []).map((block) => scriptBlock(block, sources)),
    sections,
  };
}

/**
 * The question itself, without what only works spoken: "Beatriz, pra começar: o que…?" → "O que…?",
 * "Para abrir o painel, Otávio, o que é…?" → "O que é…?". Drops a lead-in before ":" (when a full
 * question follows), a vocative with a speaker's first name (leading or after a lead-in) and a
 * leading connector.
 */
export function askedQuestion(text: string, speakers: readonly string[]): string {
  let asked = text.trim();
  const colon = asked.indexOf(': ');
  if (colon > 0 && asked.slice(colon + 2).split(/\s+/).length >= 4) asked = asked.slice(colon + 2);
  const firstNames = new Set(speakers.map((name) => name.split(/\s+/)[0]?.toLocaleLowerCase('pt-BR')).filter(Boolean));
  const vocative = /^([\p{L}]+),\s+/u.exec(asked);
  if (vocative && firstNames.has(vocative[1].toLocaleLowerCase('pt-BR'))) asked = asked.slice(vocative[0].length);
  // "Para abrir o painel, Otávio, o que é…?": everything up to a vocative in the middle goes.
  for (const match of asked.matchAll(/,\s+([\p{L}]+),\s+/gu)) {
    if (!firstNames.has(match[1].toLocaleLowerCase('pt-BR'))) continue;
    const rest = asked.slice((match.index ?? 0) + match[0].length);
    if (rest.split(/\s+/).length >= 3) asked = rest;
    break;
  }
  asked = asked.replace(/^(e|mas|então|e aí|aí)\s+/i, '');
  return capitalize(asked);
}

/** Fallback heading when no answer has a clause that stands alone: the cleaned question. */
function questionHeading(unit: QaUnit, material: Material): { text: string; ref: SourceRef } {
  if (material.mode === 'qa' && unit.question) {
    const sentences = sentenceSpans(unit.question.text);
    const asked = [...sentences].reverse().find((sentence) => sentence.text.includes('?')) ?? sentences[sentences.length - 1];
    const text = askedQuestion(asked.text, material.speakers);
    return { text, ref: lineRef(unit.question, { from: asked.from, to: asked.to }) };
  }
  const line = unit.answers[0];
  const first = line.sentences[0];
  const clause = first.text.split(/[,;:]/)[0];
  const cut = cutWords(clause, 9);
  const text = cut.cut ? `${cut.text}…` : withoutFinalPeriod(cut.text);
  return { text, ref: lineRef(line, { from: first.from, to: first.from + cut.text.length }) };
}

/** Section heading: a verbatim key clause of the answers (≤ 10 words), never the interviewer's question. */
function sectionHeading(
  group: readonly QaUnit[],
  material: Material,
  angle: ReadonlySet<string>,
  used: Set<string>,
  skip: ReadonlySet<string>,
): { text: string; ref: SourceRef } {
  const topic = new Set(group.flatMap((unit) => (unit.question ? keywords(unit.question.text) : [])));
  const sentences = group.flatMap((unit) => unit.answers.flatMap(lineSentences)).filter((sentence) => !skip.has(sentenceKey(sentence)));
  const phrase = keyPhrase(sentences, topic, angle, used);
  if (!phrase) return questionHeading(group[0], material);
  used.add(phrase.text.toLocaleLowerCase('pt-BR'));
  return { text: headingOf(phrase), ref: lineRef(phrase.sentence.line, { from: phrase.from, to: phrase.to }) };
}

type SectionBudget = { remaining: number };

/** The section's line to lift into a quote block (never from the lead's segment). */
function bestQuote(group: readonly QaUnit[], angle: ReadonlySet<string>, lead: Sentence | undefined, rng: Rng, avoid: ReadonlySet<string>): Sentence | undefined {
  let best: { sentence: Sentence; score: number } | undefined;
  for (const unit of group) {
    for (const line of unit.answers) {
      if (lead && line.segmentId === lead.line.segmentId) continue;
      for (const sentence of lineSentences(line)) {
        if (avoid.has(sentenceKey(sentence))) continue;
        const score = quoteScore(sentence, angle) + rng.next() * 0.5;
        if (Number.isFinite(score) && (!best || score > best.score)) best = { sentence, score };
      }
    }
  }
  return best?.sentence;
}

const sentenceKey = (sentence: Sentence) => `${sentence.line.segmentId}:${sentence.from}`;

/** A paragraph candidate: contiguous sentences of one answer, scored by the brief's angle. */
type Chunk = { kind: 'chunk'; line: MaterialLine; sentences: Sentence[]; words: number; score: number; order: number };
type QuoteItem = { kind: 'quote'; sentence: Sentence; order: number };

function chunkScore(sentences: readonly Sentence[], opensAnswer: boolean, angle: ReadonlySet<string>, topic: ReadonlySet<string>): number {
  let score = opensAnswer ? 2 : 0;
  for (const sentence of sentences) {
    for (const word of keywords(sentence.text)) {
      if (angle.has(word)) score += 3;
      else if (topic.has(word)) score += 1;
    }
    if (/\d/.test(sentence.text)) score += 1;
  }
  return score;
}

type SectionOptions = {
  quote: Sentence | undefined;
  /** The section's key quote closes it (the article's last section ends on a quote). */
  quoteLast: boolean;
  exclude: ReadonlySet<string>;
  angle: ReadonlySet<string>;
  voices: Voices;
  newId: NewId;
};

/**
 * Paragraphs of one section. The answers are cut into paragraph candidates; the ones closest to
 * the brief's angle are kept until the budget runs out, then shown in the material's order as
 * reported speech, with the section's key quote lifted into a quote block.
 */
function sectionBlocks(group: readonly QaUnit[], budget: SectionBudget, options: SectionOptions): { blocks: ArticleBlock[]; opening?: string } {
  const { quote, exclude, angle, voices, newId } = options;
  const topic = new Set(group.flatMap((unit) => (unit.question ? keywords(unit.question.text) : [])));
  const items: (Chunk | QuoteItem)[] = [];
  let order = 0;
  for (const unit of group) {
    for (const line of unit.answers) {
      let current: Sentence[] = [];
      let opensAnswer = true;
      const close = () => {
        if (current.length === 0) return;
        const words = current.reduce((sum, sentence) => sum + sentence.words, 0);
        items.push({ kind: 'chunk', line, sentences: current, words, score: chunkScore(current, opensAnswer, angle, topic), order: (order += 1) });
        current = [];
        opensAnswer = false;
      };
      for (const sentence of lineSentences(line)) {
        if (exclude.has(sentenceKey(sentence))) {
          close();
          continue;
        }
        if (quote && sentenceKey(sentence) === sentenceKey(quote)) {
          close();
          items.push({ kind: 'quote', sentence, order: (order += 1) });
          continue;
        }
        const words = current.reduce((sum, entry) => sum + entry.words, 0);
        if (current.length > 0 && words + sentence.words > PARAGRAPH_MAX_WORDS) close();
        current.push(sentence);
      }
      close();
    }
  }

  const chosen = new Map<number, { sentences: Sentence[]; ellipsis: boolean }>();
  const quoteItem = items.find((item): item is QuoteItem => item.kind === 'quote');
  let quoteChosen = false;
  if (quoteItem && quoteItem.sentence.words <= budget.remaining) {
    quoteChosen = true;
    budget.remaining -= quoteItem.sentence.words;
  }
  const chunks = items
    .filter((item): item is Chunk => item.kind === 'chunk' && item.words >= MIN_PARAGRAPH_WORDS)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  for (const chunk of chunks) {
    if (budget.remaining < MIN_PARAGRAPH_WORDS) break;
    if (chunk.words <= budget.remaining) {
      chosen.set(chunk.order, { sentences: chunk.sentences, ellipsis: false });
      budget.remaining -= chunk.words;
      continue;
    }
    // The budget is a hard cap: a candidate that does not fit keeps its first whole sentences.
    const kept: Sentence[] = [];
    let words = 0;
    for (const sentence of chunk.sentences) {
      if (words + sentence.words > budget.remaining) break;
      kept.push(sentence);
      words += sentence.words;
    }
    if (words >= MIN_PARAGRAPH_WORDS) {
      chosen.set(chunk.order, { sentences: kept, ellipsis: false });
      budget.remaining -= words;
    }
  }
  if (chosen.size === 0 && !quoteChosen && chunks[0]) {
    // Nothing fits whole: the best candidate's opening, cut at a word boundary.
    const best = chunks[0];
    const sentence = best.sentences[0];
    const cut = cutWords(sentence.text, Math.max(12, budget.remaining));
    const partial: Sentence = { ...sentence, to: sentence.from + cut.text.length, text: cut.text, words: countWords(cut.text) };
    chosen.set(best.order, { sentences: [partial], ellipsis: cut.cut });
    budget.remaining = 0;
  }

  const blocks: ArticleBlock[] = [];
  let opening: string | undefined;
  let closingQuote: ArticleBlock | undefined;
  for (const item of items) {
    if (item.kind === 'quote') {
      if (!quoteChosen) continue;
      const block = quoteBlock(newId('blk'), item.sentence.text, { ai: 'unreviewed', sourceRefs: [sentenceRef(item.sentence)] });
      if (options.quoteLast) closingQuote = block;
      else blocks.push(block);
      continue;
    }
    const picked = chosen.get(item.order);
    if (!picked) continue;
    const first = picked.sentences[0];
    const last = picked.sentences[picked.sentences.length - 1];
    if (blocks.length === 0) opening = sentenceKey(first);
    blocks.push(
      paragraphBlock(newId('blk'), reportedSpeech(item.line, picked.sentences, voices, picked.ellipsis), {
        ai: 'unreviewed',
        sourceRefs: [lineRef(item.line, { from: first.from, to: last.to })],
      }),
    );
  }
  if (closingQuote) blocks.push(closingQuote);
  return opening ? { blocks, opening } : { blocks };
}

export type ExtractiveInput = {
  sources: readonly Source[];
  brief: Brief;
  /** Production title, used when no statement of the material is short enough for a headline. */
  fallbackTitle: string;
  rng: Rng;
  newId: NewId;
  /** Person behind each speaker label (name and role line), for attribution. */
  speakers?: Readonly<Record<string, SpeakerInfo>>;
};

/** One extractive draft drawing at most `words` words of the material's answers. */
function planWithBudget(input: ExtractiveInput, material: Material, words: number): DraftPlan {
  const voices = createVoices(material, input.speakers);
  const angle = new Set(input.brief.angle ? keywords(input.brief.angle) : []);
  const sectionCount = Math.min(input.brief.sections, material.units.length);
  const groups = groupUnits(material.units, sectionCount);
  const budget: SectionBudget = { remaining: words };

  // The headline first: it depends on the material, the angle and the names only, so the preview
  // of Nova produção shows the same one. Key quotes never lift its line again.
  const top = headlineLine(material, angle, voices);
  const headed = new Set(top ? [top.key] : []);
  // "Selecionando falas-chave": the lead (best line of the material), then the best line of each
  // section, so every section — the last one included — has a quote to lift.
  const lead = pickKeyQuotes(material, 1, input.rng, input.brief.angle, headed)[0];
  const groupQuotes = groups.map((group) => bestQuote(group, angle, lead, input.rng, headed));
  const quotes = [lead, ...groupQuotes].filter((quote): quote is Sentence => quote !== undefined);
  const lifted = new Set([...quotes.map(sentenceKey), ...headed]);
  const used = new Set<string>();
  const intro: ArticleBlock[] = [];
  if (lead) {
    used.add(sentenceKey(lead));
    budget.remaining -= lead.words;
    intro.push(paragraphBlock(input.newId('blk'), reportedSpeech(lead.line, [lead], voices), { ai: 'unreviewed', sourceRefs: [sentenceRef(lead)] }));
  }

  if (material.preamble.length > 0) {
    // Who the interviewee is, in their own words, right after the lead.
    const share = Math.floor(budget.remaining / (groups.length + 1));
    const context = { remaining: Math.min(PREAMBLE_MAX_WORDS, Math.max(20, share)) };
    const before = context.remaining;
    intro.push(...sectionBlocks([{ answers: material.preamble, words: 0 }], context, { quote: undefined, quoteLast: false, exclude: used, angle, voices, newId: input.newId }).blocks);
    budget.remaining -= before - context.remaining;
  }

  const headings = new Set<string>();
  const sections: DraftSection[] = groups.map((group, index) => {
    const quote = groupQuotes[index];
    // Unused budget of a section carries over to the next ones.
    const share = { remaining: Math.max(25, Math.floor(budget.remaining / (groups.length - index))) };
    const before = share.remaining;
    const last = index === groups.length - 1;
    const { blocks, opening } = sectionBlocks(group, share, { quote, quoteLast: last, exclude: used, angle, voices, newId: input.newId });
    budget.remaining = Math.max(0, budget.remaining - (before - share.remaining));
    // The heading never repeats the line right under it (nor the lead or a quote block).
    const head = sectionHeading(group, material, angle, headings, opening ? new Set([...lifted, opening]) : lifted);
    return {
      stepId: `section-${index + 1}`,
      heading: headingBlock(input.newId('blk'), head.text, 2, { ai: 'unreviewed', sourceRefs: [head.ref] }),
      blocks,
    };
  });

  return {
    origin: 'extractive',
    // The headline is a strong line the lead and quote blocks do not carry again.
    title: top?.text ?? (lead ? headline(material, angle, voices, { prefer: lead }) : undefined) ?? input.fallbackTitle,
    material: { segments: material.lines.length, speakers: material.speakers.length },
    keyQuotes: dedupeRefs(quotes.map(sentenceRef)),
    intro,
    // Step ids follow the sections actually written, so they always match the recipe's `section-k`.
    sections: sections.filter((section) => section.blocks.length > 0).map((section, index) => ({ ...section, stepId: `section-${index + 1}` })),
  };
}

/** Words of the article a plan writes (body only, as "Extensão no alvo" counts them). */
export function planWords(plan: Pick<DraftPlan, 'intro' | 'sections'>): number {
  return articleStats({ type: 'article', title: '', blocks: planBlocks(plan) }).words;
}

/**
 * The extractive draft closest to the brief's length. The words of the article are not the
 * words drawn from the material (attributions, headings and cuts change them), so the budget is
 * searched: each attempt replans with the same seed (same picks), and the closest attempt wins.
 */
export function extractivePlan(input: ExtractiveInput): Result<DraftPlan, DraftPlanRefusal> {
  const material = readMaterial(input.sources);
  if (material.answerWords < MIN_ANSWER_WORDS || material.units.length === 0) {
    return refuse('material_too_short', `O material tem menos de ${MIN_ANSWER_WORDS} palavras de fala para um artigo.`);
  }
  const target = LENGTH_TARGETS[input.brief.length].words;
  const ceiling = Math.max(MIN_ANSWER_WORDS, Math.floor(material.answerWords * MAX_MATERIAL_SHARE));
  const seed = `${input.rng.next()}`;
  const attempt = (words: number, newId: NewId) => planWithBudget({ ...input, rng: createRng(seed), newId }, material, words);
  const scratch: NewId = (prefix) => `${prefix}-draft`;

  let words = Math.min(ceiling, Math.round(target * 0.9));
  let best: { words: number; distance: number } | undefined;
  const tried = new Set<number>();
  for (let round = 0; round < 10 && !tried.has(words); round += 1) {
    tried.add(words);
    const written = planWords(attempt(words, scratch));
    const distance = Math.abs(written - target);
    if (!best || distance < best.distance) best = { words, distance };
    if (distance <= target * LENGTH_TOLERANCE * 0.4) break;
    // The material is exhausted below the target: the longest article it supports is the answer.
    if (written < target && words >= ceiling) break;
    words = Math.max(MIN_PARAGRAPH_WORDS, Math.min(ceiling, Math.round(words * (target / Math.max(1, written)))));
  }
  return ok(attempt(best?.words ?? words, input.newId));
}

/**
 * The most a material supports (every answer drawn), for "Como o artigo nasce" in Nova produção:
 * the preview promises the target only when the draft can reach it.
 */
export function longestPlanWords(material: Material, sections: number): number {
  if (material.answerWords < MIN_ANSWER_WORDS || material.units.length === 0) return 0;
  const input: ExtractiveInput = {
    sources: [],
    brief: { sections, length: 'long', revision: 0 },
    fallbackTitle: '',
    rng: createRng('outlook'),
    newId: (prefix) => `${prefix}-outlook`,
  };
  return planWords(planWithBudget(input, material, Math.floor(material.answerWords * MAX_MATERIAL_SHARE)));
}

/** All blocks of a plan in document order (the "v1 · IA" the run will stream). */
export function planBlocks(plan: Pick<DraftPlan, 'intro' | 'sections'>): ArticleBlock[] {
  return [...plan.intro, ...plan.sections.flatMap((section) => [section.heading, ...section.blocks])];
}
