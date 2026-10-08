import { articleCharacters, articleStats, blockText, headingBlock, paragraphBlock, quoteBlock } from '../../../domain/article.ts';
import type { ArticleBlock, HeadingBlock, ImageSlot } from '../../../domain/article.ts';
import { briefHash } from '../../../domain/production.ts';
import type { Brief } from '../../../domain/production.ts';
import { dedupeRefs, refKey } from '../../../domain/refs.ts';
import type { SourceRef } from '../../../domain/refs.ts';
import { currentSourceVersion, resolveSourceRef } from '../../../domain/source.ts';
import type { Source } from '../../../domain/source.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import { CHARS_PER_WORD } from '../../../domain/sizing.ts';
import { countWords } from '../../../domain/text/stats.ts';
import type { ArticleDraftScript } from '../../../ports/script-book.ts';
import { draftSizeInstructions } from '../../../registries/sizing.ts';
import { createVoices, headingOf, headline, headlineLine, keyPhrase, reportedSpeech } from './editorial.ts';
import type { HeadlineLine, SpeakerInfo, Voices } from './editorial.ts';
import { withImageSlots } from './image-plan.ts';
import type { ImagePlanOptions } from './image-plan.ts';
import { groupUnits, keywords, lineRef, lineSentences, pickKeyQuotes, quoteScore, readMaterial, sentenceRef } from './material.ts';
import type { Material, MaterialLine, QaUnit, Sentence } from './material.ts';
import { createRng } from './random.ts';
import type { Rng } from './random.ts';
import { capitalize, cutWords, withoutFinalPeriod } from './sentences.ts';

/**
 * The full output of an "article.draft" run, computed before streaming starts so that steps,
 * retries and the outline review stay deterministic. Hand-written scripts win; otherwise the
 * EXTRACTIVE path selects verbatim sentences: the answers closest to the brief's angle become
 * reported speech with the speaker's name and role, headings and the headline are verbatim key
 * clauses of the answers, the last section closes on its key quote, quotes are verbatim. It
 * draws as much of the material as the brief's size asks (the target ±10%, never above the size's
 * maximum), never more than all of it: a short material yields a shorter article, never padding
 * (no line twice, nothing without a source in the material, no interviewer question as text, no
 * word of its own beyond the attribution). A Curto writes its sections without intertítulos.
 * Image slots (see `image-plan.ts`) mark where the article asks for a picture; they have no text.
 *
 * The same plan is also the STRUCTURE of "Montar estrutura": each section's title and the lines
 * of the interview it is written from (`quotes`). A structure a person edited (renamed, reordered,
 * removed or added sections, moved quotes) is written by `extractivePlanFromOutline`: each section
 * draws only from the answers of its own quotes.
 */

export type DraftSection = {
  stepId: string;
  /** The section's identity in the structure: its intertítulo block in a Padrão. */
  blockId: string;
  /** Its intertítulo (Padrão) or, in a Curto, the guide it is written from (never a heading there). */
  title: string;
  /** The H2 intertítulo; absent in a Curto. */
  heading?: HeadingBlock;
  blocks: ArticleBlock[];
  /** The lines of the interview the section is written from (the structure's "citações"). */
  quotes: SourceRef[];
};

export type DraftPlan = {
  origin: 'script' | 'extractive';
  title: string;
  material: { segments: number; speakers: number };
  keyQuotes: SourceRef[];
  intro: ArticleBlock[];
  /** The lines the introduction opens with (the lead). */
  introQuotes: SourceRef[];
  sections: DraftSection[];
  /** One quotable line per answer of the interview, for "+ citação" in the structure. */
  candidates: SourceRef[];
  /** The cover suggestion the outline announces (the article has no cover yet). */
  coverSlot?: ImageSlot;
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
/** A line offered as a quote without a quotable sentence still needs this many words. */
const MIN_CANDIDATE_WORDS = 6;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function materialMeta(plan: Pick<DraftPlan, 'material'>): string {
  return `${plural(plan.material.segments, 'fala', 'falas')} · ${plural(plan.material.speakers, 'falante', 'falantes')}`;
}

/** A section's blocks in document order: its intertítulo (when it has one), then its text. */
export function draftSectionBlocks(section: Pick<DraftSection, 'heading' | 'blocks'>): ArticleBlock[] {
  return section.heading ? [section.heading, ...section.blocks] : [...section.blocks];
}

function countSpeakers(material: Material): { segments: number; speakers: number } {
  return { segments: material.lines.length, speakers: material.speakers.length };
}

/** Keeps only refs that resolve in the cited source version (scripts are data, data can drift). */
function resolvable(sources: readonly Source[], refs: readonly SourceRef[] | undefined): SourceRef[] {
  return (refs ?? []).filter((ref) => resolveSourceRef(sources, ref) !== undefined);
}

/**
 * Script blocks keep their ids (fixture rewrites are keyed by them) and start unreviewed; image
 * slots carry no review flag (they are filled or dismissed instead).
 */
function scriptBlock(block: ArticleBlock, sources: readonly Source[]): ArticleBlock {
  const refs = resolvable(sources, block.sourceRefs);
  const next: ArticleBlock = block.type === 'figure' ? { ...block } : { ...block, ai: 'unreviewed' };
  if (block.type === 'figure') delete next.ai;
  if (refs.length > 0) next.sourceRefs = refs;
  else delete next.sourceRefs;
  return next;
}

// ——— Lines of the interview the structure quotes ———

const sentenceKey = (sentence: Pick<Sentence, 'line' | 'from'>) => `${sentence.line.segmentId}:${sentence.from}`;

/** Lines that answer (never the interviewer's): what an article and its structure may quote. */
function answerLines(material: Material): MaterialLine[] {
  const answers = new Set<MaterialLine>([...material.preamble, ...material.units.flatMap((unit) => unit.answers)]);
  return material.lines.filter((line) => answers.has(line));
}

/** The line's best quotable sentence, else its first statement long enough to stand alone. */
function bestLineSentence(line: MaterialLine, angle: ReadonlySet<string>): Sentence | undefined {
  let best: { sentence: Sentence; score: number } | undefined;
  for (const sentence of lineSentences(line)) {
    const score = quoteScore(sentence, angle);
    if (Number.isFinite(score) && (!best || score > best.score)) best = { sentence, score };
  }
  return best?.sentence ?? lineSentences(line).find((sentence) => sentence.words >= MIN_CANDIDATE_WORDS && !sentence.text.includes('?'));
}

/**
 * The answer sentence a quote of the structure points at: the sentence holding the start of its
 * range (a whole-segment ref means the line's best sentence). Undefined when the ref is not an
 * answer of the material as it is now (another source version, an interviewer's line).
 */
export function answerSentence(material: Material, ref: SourceRef): Sentence | undefined {
  const { locator } = ref;
  if (ref.kind !== 'source' || locator.type !== 'segment') return undefined;
  const line = answerLines(material).find(
    (candidate) => candidate.segmentId === locator.segmentId && candidate.sourceId === ref.sourceId && candidate.sourceVersion === ref.sourceVersion,
  );
  if (!line) return undefined;
  const sentences = lineSentences(line);
  const from = locator.from;
  if (from === undefined) return bestLineSentence(line, new Set()) ?? sentences[0];
  return sentences.find((sentence) => from >= sentence.from && from < sentence.to) ?? sentences.find((sentence) => sentence.from >= from && (locator.to === undefined || sentence.from < locator.to));
}

/**
 * "Citações da entrevista": one quotable line per answer, in the interview's order. A line the
 * structure already quotes is offered with that same quote (the screen hides what is in use).
 */
function candidatesOf(material: Material, anchored: readonly SourceRef[], angle: ReadonlySet<string>): SourceRef[] {
  const bySegment = new Map<string, SourceRef[]>();
  for (const ref of anchored) {
    if (ref.locator.type !== 'segment') continue;
    bySegment.set(ref.locator.segmentId, [...(bySegment.get(ref.locator.segmentId) ?? []), ref]);
  }
  const out: SourceRef[] = [];
  for (const line of answerLines(material)) {
    const given = bySegment.get(line.segmentId);
    if (given) {
      out.push(...given);
      continue;
    }
    const best = bestLineSentence(line, angle);
    if (best) out.push(sentenceRef(best));
  }
  return dedupeRefs(out);
}

/** One quote per answer line a run of blocks cites (block quotes first): a script section's "citações". */
function quotesOfBlocks(blocks: readonly ArticleBlock[], material: Material, taken: Set<string>): SourceRef[] {
  const answers = new Set(answerLines(material).map((line) => line.segmentId as string));
  const ordered = [...blocks.filter((block) => block.type === 'quote'), ...blocks.filter((block) => block.type !== 'quote' && block.type !== 'heading' && block.type !== 'figure')];
  const out: SourceRef[] = [];
  const lines = new Set<string>();
  for (const block of ordered) {
    for (const ref of block.sourceRefs ?? []) {
      if (ref.locator.type !== 'segment' || !answers.has(ref.locator.segmentId)) continue;
      const key = refKey(ref);
      if (lines.has(ref.locator.segmentId) || taken.has(key)) continue;
      lines.add(ref.locator.segmentId);
      taken.add(key);
      out.push(ref);
    }
  }
  return out;
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
  const material = readMaterial(sources);
  const taken = new Set<string>();
  const introBlocks = (intro?.blocks ?? []).map((block) => scriptBlock(block, sources));
  const introQuotes = quotesOfBlocks(introBlocks, material, taken).slice(0, 1);
  const sections: DraftSection[] = bodySections.map((section, index) => {
    const blocks = section.blocks.map((block) => scriptBlock(block, sources));
    const headingIndex = blocks.findIndex((block) => block.type === 'heading');
    const outlined = script.outline[index]?.title ?? section.label;
    const heading: HeadingBlock =
      headingIndex >= 0 ? (blocks[headingIndex] as HeadingBlock) : headingBlock(newId('blk'), outlined, 2, { ai: 'unreviewed' });
    const body = blocks.filter((_, position) => position !== headingIndex);
    return {
      stepId: `section-${index + 1}`,
      blockId: heading.id,
      title: blockText(heading),
      heading,
      blocks: body,
      quotes: quotesOfBlocks(body, material, taken),
    };
  });
  const plan: DraftPlan = {
    origin: 'script',
    title: script.title.trim(),
    material: countSpeakers(material),
    keyQuotes: resolvable(sources, script.keySegments),
    intro: introBlocks,
    introQuotes,
    sections,
    candidates: candidatesOf(material, [...introQuotes, ...sections.flatMap((section) => section.quotes)], new Set(brief?.angle ? keywords(brief.angle) : [])),
  };
  if (script.coverSlot) plan.coverSlot = structuredClone(script.coverSlot);
  return plan;
}

/**
 * The question itself, without what only works spoken (for screens that show what was asked; a
 * heading is never the interviewer's question): "Beatriz, pra começar: o que…?" → "O que…?",
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

/**
 * Last resort when no answer has a clause that stands alone: the opening clause of the first
 * answer, cut at a word. Never the interviewer's question: the article's words are the answers'.
 */
function answerHeading(unit: QaUnit): { text: string; ref: SourceRef } {
  const statements = unit.answers.flatMap(lineSentences).filter((sentence) => !sentence.text.includes('?'));
  // A clause of 4–9 words that stands as a line ("Precisou," alone says nothing).
  for (const sentence of statements) {
    let from = 0;
    for (const clause of sentence.text.split(/(?<=[,;:])\s+/)) {
      const text = withoutFinalPeriod(clause.replace(/[,;:]$/, ''));
      const words = countWords(text);
      if (words >= 4 && words <= 9) return { text: capitalize(text), ref: lineRef(sentence.line, { from: sentence.from + from, to: sentence.from + from + text.length }) };
      from += clause.length + 1;
    }
  }
  const first = statements.find((sentence) => sentence.words >= 4) ?? statements[0] ?? lineSentences(unit.answers[0])[0];
  const cut = cutWords(first.text, 9);
  const text = capitalize(cut.cut ? `${cut.text}…` : withoutFinalPeriod(cut.text));
  return { text, ref: lineRef(first.line, { from: first.from, to: first.from + cut.text.length }) };
}

/**
 * Section heading: a verbatim key clause of the answers (≤ 10 words), never the interviewer's
 * question. A clause of a line the section quotes or opens with is the second choice (better
 * than no heading of the answers' own).
 */
function sectionHeading(group: readonly QaUnit[], angle: ReadonlySet<string>, used: Set<string>, skip: ReadonlySet<string>): { text: string; ref: SourceRef } {
  const topic = new Set(group.flatMap((unit) => (unit.question ? keywords(unit.question.text) : [])));
  const all = group.flatMap((unit) => unit.answers.flatMap(lineSentences));
  const phrase = keyPhrase(all.filter((sentence) => !skip.has(sentenceKey(sentence))), topic, angle, used) ?? keyPhrase(all, topic, angle, used);
  if (!phrase) return answerHeading(group[0]);
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
  /** Sentences written (or reserved) elsewhere: never written twice. */
  exclude: ReadonlySet<string>;
  angle: ReadonlySet<string>;
  voices: Voices;
  newId: NewId;
};

type SectionText = {
  blocks: ArticleBlock[];
  /** The first sentence written (the heading never repeats it). */
  opening?: string;
  /** The first sentence of each paragraph written, one per answer line: what the section quotes. */
  lines: Sentence[];
};

/**
 * Paragraphs of one section. The answers are cut into paragraph candidates; the ones closest to
 * the brief's angle are kept until the budget runs out, then shown in the material's order as
 * reported speech, with the section's key quote lifted into a quote block.
 */
function sectionBlocks(group: readonly QaUnit[], budget: SectionBudget, options: SectionOptions): SectionText {
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
        if (quote && sentenceKey(sentence) === sentenceKey(quote)) {
          close();
          items.push({ kind: 'quote', sentence, order: (order += 1) });
          continue;
        }
        if (exclude.has(sentenceKey(sentence))) {
          close();
          continue;
        }
        const words = current.reduce((sum, entry) => sum + entry.words, 0);
        if (current.length > 0 && words + sentence.words > PARAGRAPH_MAX_WORDS) close();
        current.push(sentence);
      }
      close();
    }
  }
  // A quote of a line another section writes still belongs to this section (an edited structure).
  if (quote && !items.some((item) => item.kind === 'quote')) items.push({ kind: 'quote', sentence: quote, order: (order += 1) });

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
  const lines: Sentence[] = [];
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
    if (!lines.some((entry) => entry.line.segmentId === item.line.segmentId)) lines.push(first);
    blocks.push(
      paragraphBlock(newId('blk'), reportedSpeech(item.line, picked.sentences, voices, picked.ellipsis), {
        ai: 'unreviewed',
        sourceRefs: [lineRef(item.line, { from: first.from, to: last.to })],
      }),
    );
  }
  if (closingQuote) blocks.push(closingQuote);
  return opening ? { blocks, opening, lines } : { blocks, lines };
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
  /** Where the draft asks for images (default `DEFAULT_IMAGE_PLAN`); `false` writes text only. */
  images?: Partial<ImagePlanOptions> | false;
};

/** One section to write: the answers it draws from and its quote; title and id when a person set them. */
type SectionLayout = {
  pool: QaUnit[];
  quote?: Sentence;
  title?: string;
  blockId?: string;
  /** The structure's quotes as the person gave them (kept as they are in the plan). */
  quotes?: SourceRef[];
  /** Written when nothing else of the pool fits: the section's first quote. */
  fallback?: Sentence;
};

/** What a draft is written from: the headline, the lead, what else the introduction quotes, the sections. */
type Layout = {
  top?: HeadlineLine;
  headed: ReadonlySet<string>;
  lead?: Sentence;
  introExtra: Sentence[];
  /** The structure's introduction quotes as the person gave them. */
  introQuotes?: SourceRef[];
  sections: SectionLayout[];
  /** The article's title when a person set it. */
  title?: string;
  /** Answers before the first question the introduction may add (default: all of them). */
  preamble?: MaterialLine[];
};

/** The layout of a draft from the material alone: sections are contiguous groups of questions. */
function materialLayout(input: ExtractiveInput, material: Material, rng: Rng): Layout {
  const voices = createVoices(material, input.speakers);
  const angle = new Set(input.brief.angle ? keywords(input.brief.angle) : []);
  const sectionCount = Math.min(input.brief.sections, material.units.length);
  const groups = groupUnits(material.units, sectionCount);
  // The headline first: it depends on the material, the angle and the names only, so the preview
  // of Nova produção shows the same one. Key quotes never lift its line again.
  const top = headlineLine(material, angle, voices);
  const headed = new Set(top ? [top.key] : []);
  // "Organizando fontes e citações": the lead (best line of the material), then the best line of
  // each section, so every section — the last one included — has a quote to lift.
  const lead = pickKeyQuotes(material, 1, rng, input.brief.angle, headed)[0];
  const groupQuotes = groups.map((group) => bestQuote(group, angle, lead, rng, headed));
  const layout: Layout = { headed, introExtra: [], sections: groups.map((pool, index) => ({ pool, ...(groupQuotes[index] ? { quote: groupQuotes[index] } : {}) })) };
  if (top) layout.top = top;
  if (lead) layout.lead = lead;
  return layout;
}

/** One extractive draft drawing at most `words` words of the material's answers. */
function writeDraft(input: ExtractiveInput, material: Material, layout: Layout, words: number, headings: boolean): DraftPlan {
  const voices = createVoices(material, input.speakers);
  const angle = new Set(input.brief.angle ? keywords(input.brief.angle) : []);
  const budget: SectionBudget = { remaining: words };
  const { lead, headed, top } = layout;
  const sectionQuotes = layout.sections.map((section) => section.quote).filter((quote): quote is Sentence => quote !== undefined);
  const quotes = [...(lead ? [lead] : []), ...layout.introExtra, ...sectionQuotes];
  const lifted = new Set([...quotes.map(sentenceKey), ...headed]);
  // Written once: the lead and what else the introduction quotes, and every section's quote block.
  const used = new Set<string>();
  const intro: ArticleBlock[] = [];
  for (const line of [...(lead ? [lead] : []), ...layout.introExtra]) {
    if (used.has(sentenceKey(line))) continue;
    // The lead always opens the text; more lines of the introduction only while the size allows.
    if (line !== lead && line.words > budget.remaining) continue;
    used.add(sentenceKey(line));
    budget.remaining -= line.words;
    intro.push(paragraphBlock(input.newId('blk'), reportedSpeech(line.line, [line], voices), { ai: 'unreviewed', sourceRefs: [sentenceRef(line)] }));
  }
  const exclude = new Set([...used, ...sectionQuotes.map(sentenceKey)]);

  const preamble = layout.preamble ?? material.preamble;
  if (preamble.length > 0) {
    // Who the interviewee is, in their own words, right after the lead.
    const share = Math.floor(budget.remaining / (layout.sections.length + 1));
    const context = { remaining: Math.min(PREAMBLE_MAX_WORDS, Math.max(20, share)) };
    const before = context.remaining;
    intro.push(...sectionBlocks([{ answers: preamble, words: 0 }], context, { quote: undefined, quoteLast: false, exclude, angle, voices, newId: input.newId }).blocks);
    budget.remaining -= before - context.remaining;
  }

  const headingTexts = new Set<string>();
  const fixed = layout.sections.some((section) => section.title !== undefined);
  const sections: DraftSection[] = layout.sections.map((section, index) => {
    const { quote } = section;
    // Unused budget of a section carries over to the next ones.
    const share = { remaining: Math.max(25, Math.floor(budget.remaining / (layout.sections.length - index))) };
    const before = share.remaining;
    const last = index === layout.sections.length - 1;
    const written = sectionBlocks(section.pool, share, { quote, quoteLast: last, exclude, angle, voices, newId: input.newId });
    budget.remaining = Math.max(0, budget.remaining - (before - share.remaining));
    let { blocks } = written;
    const line = section.fallback;
    const own = line !== undefined && quote !== undefined && sentenceKey(line) === sentenceKey(quote);
    if (blocks.length === 0 && line && (own || !exclude.has(sentenceKey(line)))) {
      // A section a person asked for always says at least its first quote.
      const options = { ai: 'unreviewed' as const, sourceRefs: [sentenceRef(line)] };
      blocks = [own ? quoteBlock(input.newId('blk'), line.text, options) : paragraphBlock(input.newId('blk'), reportedSpeech(line.line, [line], voices), options)];
      budget.remaining = Math.max(0, budget.remaining - line.words);
    }
    // The heading never repeats the line right under it (nor the lead or a quote block).
    let title = section.title;
    let headRef: SourceRef | undefined;
    if (title === undefined) {
      const head = sectionHeading(section.pool, angle, headingTexts, written.opening ? new Set([...lifted, written.opening]) : lifted);
      title = head.text;
      headRef = head.ref;
    } else {
      headRef = section.quotes?.[0] ?? blocks.find((block) => block.sourceRefs?.length)?.sourceRefs?.[0];
    }
    const blockId = section.blockId ?? input.newId('blk');
    const anchors = section.quotes ?? dedupeRefs([...(quote ? [quote] : []), ...written.lines.filter((line) => line.line.segmentId !== quote?.line.segmentId)].map(sentenceRef));
    const draft: DraftSection = { stepId: `section-${index + 1}`, blockId, title, blocks, quotes: anchors };
    if (headings) draft.heading = headingBlock(blockId, title, 2, { ai: 'unreviewed', ...(headRef ? { sourceRefs: [headRef] } : {}) });
    return draft;
  });

  const introQuotes = layout.introQuotes ?? (lead ? [sentenceRef(lead)] : []);
  const kept = fixed ? sections : sections.filter((section) => section.blocks.length > 0);
  // Step ids follow the sections actually written, so they always match the recipe's `section-k`.
  const written = kept.map((section, index) => ({ ...section, stepId: `section-${index + 1}` }));
  return {
    origin: 'extractive',
    // The headline is a strong line the lead and quote blocks do not carry again.
    title: layout.title ?? top?.text ?? (lead ? headline(material, angle, voices, { prefer: lead }) : undefined) ?? input.fallbackTitle,
    material: countSpeakers(material),
    keyQuotes: dedupeRefs(quotes.map(sentenceRef)),
    intro,
    introQuotes,
    sections: written,
    candidates: candidatesOf(material, [...introQuotes, ...written.flatMap((section) => section.quotes)], angle),
  };
}

/** Words of the article a plan writes (body only). */
export function planWords(plan: Pick<DraftPlan, 'intro' | 'sections'>): number {
  return articleStats({ type: 'article', title: '', blocks: planBlocks(plan) }).words;
}

/** Characters of the article a plan writes (body only, as "Tamanho" counts a lauda). */
export function planChars(plan: Pick<DraftPlan, 'intro' | 'sections'>): number {
  return articleCharacters({ type: 'article', title: '', blocks: planBlocks(plan) });
}

type Attempt = { words: number; chars: number; distance: number };

/** Closest to the target wins, but never above the maximum: over it, only a shorter attempt is better. */
function betterAttempt(candidate: Attempt, best: Attempt | undefined, maxChars: number): boolean {
  if (!best) return true;
  const fits = candidate.chars <= maxChars;
  const bestFits = best.chars <= maxChars;
  if (fits !== bestFits) return fits;
  return fits ? candidate.distance < best.distance : candidate.chars < best.chars;
}

type SizeGoal = { targetChars: number; maxChars: number; tolerance: number };

/**
 * The word budget whose draft lands closest to the size. The characters of the article are not
 * the words drawn from the material (attributions, headings and cuts change them), so the budget
 * is searched: the attempt closest to the target wins, never one above the maximum when one below
 * it exists; once every word of the material is drawn, that is the answer (never padded).
 */
function searchBudget(goal: SizeGoal, ceiling: number, charsOf: (words: number) => number): number {
  const { targetChars: target, maxChars } = goal;
  let words = Math.min(ceiling, Math.round((target / CHARS_PER_WORD) * 0.9));
  let best: Attempt | undefined;
  const tried = new Set<number>();
  for (let round = 0; round < 10 && !tried.has(words); round += 1) {
    tried.add(words);
    const written = charsOf(words);
    const candidate = { words, chars: written, distance: Math.abs(written - target) };
    if (betterAttempt(candidate, best, maxChars)) best = candidate;
    if (written <= maxChars && candidate.distance <= target * goal.tolerance * 0.4) break;
    // The material is exhausted below the target: the longest article it supports is the answer.
    if (written < target && words >= ceiling) break;
    words = Math.max(MIN_PARAGRAPH_WORDS, Math.min(ceiling, Math.round(words * (target / Math.max(1, written)))));
  }
  return best?.words ?? words;
}

/**
 * Last guard of "never above the maximum": when even the shortest attempt passes it (lines a
 * person insisted on), the last paragraphs go, the longest sections first; each section keeps
 * its first block.
 */
function capAtMax(plan: DraftPlan, maxChars: number): DraftPlan {
  let next = plan;
  for (let guard = 0; guard < 200 && planChars(next) > maxChars; guard += 1) {
    const longest = next.sections
      .map((section, index) => ({ index, chars: planChars({ intro: [], sections: [section] }), blocks: section.blocks.length }))
      .filter((entry) => entry.blocks > 1)
      .sort((a, b) => b.chars - a.chars)[0];
    if (longest) {
      next = { ...next, sections: next.sections.map((section, index) => (index === longest.index ? { ...section, blocks: section.blocks.slice(0, -1) } : section)) };
    } else if (next.intro.length > 1) {
      next = { ...next, intro: next.intro.slice(0, -1) };
    } else break;
  }
  return next;
}

function tooShort(material: Material): boolean {
  return material.answerWords < MIN_ANSWER_WORDS || material.units.length === 0;
}

const SHORT_MATERIAL = `O material tem menos de ${MIN_ANSWER_WORDS} palavras de fala para um artigo.`;

/**
 * The extractive draft closest to the brief's size (`draftSizeInstructions`): each attempt
 * replans with the same seed (same picks) and only the word budget changes.
 */
export function extractivePlan(input: ExtractiveInput): Result<DraftPlan, DraftPlanRefusal> {
  const material = readMaterial(input.sources);
  if (tooShort(material)) return refuse('material_too_short', SHORT_MATERIAL);
  const sizing = draftSizeInstructions({ size: input.brief.size, sections: Math.min(input.brief.sections, material.units.length) });
  const ceiling = Math.max(MIN_ANSWER_WORDS, Math.floor(material.answerWords * MAX_MATERIAL_SHARE));
  const seed = `${input.rng.next()}`;
  const layout = materialLayout(input, material, createRng(seed));
  const scratch: NewId = (prefix) => `${prefix}-draft`;
  const words = searchBudget(sizing, ceiling, (budget) => planChars(writeDraft({ ...input, newId: scratch }, material, layout, budget, sizing.headings)));
  const plan = capAtMax(writeDraft(input, material, layout, words, sizing.headings), sizing.maxChars);
  if (input.images === false) return ok(plan);
  return ok(withImageSlots(plan, { material, speakers: input.speakers, newId: input.newId, options: input.images }));
}

/** A structure ready to write: quotes resolved, ids set, titles trimmed (see `outline.ts`). */
export type PlannedOutline = {
  title: string;
  intro: SourceRef[];
  sections: { blockId: string; title: string; quotes: SourceRef[] }[];
};

/**
 * The draft of a structure a person reviewed: the sections in the given order, each written only
 * from the answer lines of its own quotes (a line quoted in two places belongs to the first), with
 * its first quotable quote lifted into a quote block; the introduction opens with its quotes. The
 * size works as in `extractivePlan`: the target at most, never above the maximum, and a structure
 * whose quotes give less comes out shorter, never padded.
 */
export function extractivePlanFromOutline(input: ExtractiveInput, outline: PlannedOutline): Result<DraftPlan, DraftPlanRefusal> {
  const material = readMaterial(input.sources);
  if (tooShort(material)) return refuse('material_too_short', SHORT_MATERIAL);
  const angle = new Set(input.brief.angle ? keywords(input.brief.angle) : []);
  const resolve = (refs: readonly SourceRef[]) => refs.map((ref) => answerSentence(material, ref)).filter((sentence): sentence is Sentence => sentence !== undefined);
  const introLines = resolve(outline.intro);
  const lead = introLines[0];
  const anchors = outline.sections.map((section) => resolve(section.quotes));
  // Each answer line belongs to the first section that quotes it.
  const owner = new Map<string, number>();
  anchors.forEach((lines, index) => {
    for (const line of lines) if (!owner.has(line.line.segmentId)) owner.set(line.line.segmentId, index);
  });
  const units: QaUnit[] = [...(material.preamble.length > 0 ? [{ answers: material.preamble, words: 0 }] : []), ...material.units];
  const poolOf = (index: number): QaUnit[] =>
    units
      .map((unit) => {
        const answers = unit.answers.filter((line) => owner.get(line.segmentId) === index);
        const pooled: QaUnit = { answers, words: answers.reduce((sum, line) => sum + line.words, 0) };
        if (unit.question) pooled.question = unit.question;
        return pooled;
      })
      .filter((unit) => unit.answers.length > 0);
  const quotable = (sentence: Sentence) => Number.isFinite(quoteScore(sentence, angle)) && sentence.line.segmentId !== lead?.line.segmentId;
  const sections: SectionLayout[] = outline.sections.map((section, index) => {
    const lines = anchors[index];
    const quote = lines.find(quotable);
    const layout: SectionLayout = { pool: poolOf(index), title: section.title, blockId: section.blockId, quotes: section.quotes };
    if (quote) layout.quote = quote;
    const fallback = lines.find((line) => line !== quote) ?? quote;
    if (fallback) layout.fallback = fallback;
    return layout;
  });
  const pooled = new Set(sections.flatMap((section) => section.pool.flatMap((unit) => unit.answers)));
  // The answers before the first question no section quotes still introduce the interviewee.
  const preamble = material.preamble.filter((line) => !pooled.has(line));
  const layout: Layout = { headed: new Set(), introExtra: introLines.slice(1), introQuotes: outline.intro, sections, title: outline.title, preamble };
  if (lead) layout.lead = lead;
  const available = [...pooled, ...introLines.map((line) => line.line)].reduce((sum, line) => sum + line.words, 0);
  const preambleWords = preamble.reduce((sum, line) => sum + line.words, 0);
  const ceiling = Math.max(MIN_PARAGRAPH_WORDS, Math.floor((available + Math.min(PREAMBLE_MAX_WORDS, preambleWords)) * MAX_MATERIAL_SHARE));
  const sizing = draftSizeInstructions({ size: input.brief.size, sections: outline.sections.length });
  const scratch: NewId = (prefix) => `${prefix}-draft`;
  const words = searchBudget(sizing, ceiling, (budget) => planChars(writeDraft({ ...input, newId: scratch }, material, layout, budget, sizing.headings)));
  const plan = capAtMax(writeDraft(input, material, layout, words, sizing.headings), sizing.maxChars);
  if (input.images === false) return ok(plan);
  return ok(withImageSlots(plan, { material, speakers: input.speakers, newId: input.newId, options: input.images }));
}

/**
 * Characters of the most a material supports (every answer drawn), for "Como o artigo nasce" in
 * Nova produção and the pauta: the preview promises the target only when the draft can reach it.
 */
export function longestPlanChars(material: Material, sections: number): number {
  if (tooShort(material)) return 0;
  const input: ExtractiveInput = {
    sources: [],
    brief: { sections, size: 'standard', revision: 0 },
    fallbackTitle: '',
    rng: createRng('outlook'),
    newId: (prefix) => `${prefix}-outlook`,
  };
  const layout = materialLayout(input, material, input.rng);
  return planChars(writeDraft(input, material, layout, Math.floor(material.answerWords * MAX_MATERIAL_SHARE), true));
}

/** All blocks of a plan in document order (the "v1 · IA" the run will stream). */
export function planBlocks(plan: Pick<DraftPlan, 'intro' | 'sections'>): ArticleBlock[] {
  return [...plan.intro, ...plan.sections.flatMap(draftSectionBlocks)];
}
