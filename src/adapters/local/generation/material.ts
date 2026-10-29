import type { SegmentId, SourceId } from '../../../domain/ids.ts';
import { refKey, segmentRef } from '../../../domain/refs.ts';
import type { SourceRef } from '../../../domain/refs.ts';
import { currentSourceVersion, writingSources } from '../../../domain/source.ts';
import { memorySourceSegment } from '../../../domain/editorial-memory-excerpt.ts';
import { writingSourceCandidates, type WritingMemoryContext } from '../../../domain/writing-source.ts';
import type { Source } from '../../../domain/source.ts';
import { foldForMatch } from '../../../domain/text/normalize.ts';
import { countWords, words } from '../../../domain/text/stats.ts';
import type { Rng } from './random.ts';
import { sentenceSpans } from './sentences.ts';
import type { Span } from './sentences.ts';

/**
 * Reads transcript material for the extractive simulation: who asks, who answers, which
 * sentences are quotable. Everything here only SELECTS text that exists in the material.
 */

export type MaterialLine = {
  sourceId: SourceId;
  sourceVersion: number;
  segmentId: SegmentId;
  speaker?: string;
  text: string;
  words: number;
  sentences: Span[];
  question: boolean;
  memory?: WritingMemoryContext;
};

export type Sentence = Span & { line: MaterialLine; index: number };

export type QaUnit = { question?: MaterialLine; answers: MaterialLine[]; words: number };

export type Material = {
  lines: MaterialLine[];
  speakers: string[];
  interviewer?: string;
  /** Questions → answers when the material is an interview, contiguous chunks otherwise. */
  mode: 'qa' | 'flow';
  units: QaUnit[];
  /** Answers given before the first question (who the interviewee is): context for the intro. */
  preamble: MaterialLine[];
  /** Words in answers (what the article may draw from). */
  answerWords: number;
  unavailableMemory?: boolean;
};

/** Greetings and thanks ("Bom dia, Clara.", "Eu que agradeço.") are never article material. */
const PLEASANTRY = /^(?:(?:bom dia|boa tarde|boa noite|olá|oi|obrigad[oa]s?|muito obrigad[oa]s?|eu que agradeço|agradeço|valeu|imagina|de nada|(?:foi )?um prazer|o prazer é (?:meu|nosso)|tchau|até mais)\b)/i;

export function isPleasantry(sentence: Pick<Span, 'text' | 'words'>): boolean {
  return sentence.words <= 6 && PLEASANTRY.test(sentence.text.trim());
}

function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith('?') || (trimmed.includes('?') && countWords(trimmed) <= 40);
}

type SegmentLike = { id: string; speaker?: string; text: string };

function lineOf(sourceId: SourceId, sourceVersion: number, segment: SegmentLike): MaterialLine {
  const sentences = sentenceSpans(segment.text).filter((sentence) => !isPleasantry(sentence));
  const line: MaterialLine = {
    sourceId,
    sourceVersion,
    segmentId: segment.id as SegmentId,
    text: segment.text,
    words: sentences.reduce((sum, sentence) => sum + sentence.words, 0),
    sentences,
    question: isQuestion(segment.text),
  };
  if (segment.speaker) line.speaker = segment.speaker;
  return line;
}

export function readMaterial(sources: readonly Source[]): Material {
  const lines: MaterialLine[] = [];
  let unavailableMemory = false;
  for (const source of writingSources(sources).filter(source => !source.research)) {
    if (!source.memory && source.kind !== 'transcript') continue;
    const version = currentSourceVersion(source);
    if (source.memory) {
      const receipt = source.memory.find(receipt => receipt.version.number === version.number && receipt.version.hash === version.hash);
      if (!source.rights.authorized || !receipt?.items.length || receipt.items.length !== version.content.segments.length
        || new Set(receipt.items.map(item => item.segmentId)).size !== receipt.items.length
        || version.content.segments.some(segment => !memorySourceSegment(source, version.number, segment.id))) {
        unavailableMemory = true;
        continue;
      }
      for (const candidate of writingSourceCandidates([source])) {
        if (candidate.ref.locator.type !== 'segment') continue;
        const words = countWords(candidate.text);
        lines.push({ sourceId: source.id, sourceVersion: version.number, segmentId: candidate.ref.locator.segmentId,
          text: candidate.text, words, sentences: [{ from: 0, to: candidate.text.length, text: candidate.text, words }],
          question: false, ...(candidate.speaker ? { speaker: candidate.speaker } : {}), memory: candidate.memory });
      }
    } else for (const segment of version.content.segments) lines.push(lineOf(source.id, version.number, segment));
  }
  return { ...materialOf(lines), ...(unavailableMemory ? { unavailableMemory: true } : {}) };
}

/** Material of segments not saved yet (Nova produção's live analysis). */
export function readSegments(segments: readonly SegmentLike[]): Material {
  return materialOf(segments.map((segment) => lineOf('preview' as SourceId, 1, segment)));
}

function materialOf(lines: MaterialLine[]): Material {
  const speakers = [...new Set(lines.map((line) => line.speaker).filter((label): label is string => Boolean(label)))];
  const interviewer = detectInterviewer(lines, speakers);
  const qaUnits = buildUnits(lines, interviewer);
  const asked = qaUnits.filter((unit) => unit.question).length;
  const mode = asked >= 2 ? 'qa' : 'flow';
  const answers = lines.filter((line) => line.speaker !== interviewer || !interviewer);
  const split = mode === 'qa' ? splitPreamble(qaUnits) : { units: answers.map((line) => ({ answers: [line], words: line.words })), preamble: [] };
  const units = split.units.filter((unit) => unit.words > 0);
  const preamble = split.preamble.filter((line) => line.words > 0);
  const answerWords = units.reduce((sum, unit) => sum + unit.words, 0) + preamble.reduce((sum, line) => sum + line.words, 0);
  const material: Material = { lines, speakers, mode, units, preamble, answerWords };
  if (interviewer) material.interviewer = interviewer;
  return material;
}

/** The speaker who asks most, when most of what they say are questions. */
function detectInterviewer(lines: readonly MaterialLine[], speakers: readonly string[]): string | undefined {
  let best: { label: string; questions: number } | undefined;
  for (const label of speakers) {
    const own = lines.filter((line) => line.speaker === label);
    const questions = own.filter((line) => line.question).length;
    if (questions >= 2 && questions / own.length >= 0.5 && (!best || questions > best.questions)) best = { label, questions };
  }
  return best?.label;
}

function buildUnits(lines: readonly MaterialLine[], interviewer: string | undefined): QaUnit[] {
  const units: QaUnit[] = [];
  let current: QaUnit | undefined;
  for (const line of lines) {
    const asks = interviewer ? line.speaker === interviewer : line.question;
    if (asks) {
      if (!line.question) continue; // "Obrigada pela conversa." is neither a heading nor an answer.
      current = { question: line, answers: [], words: 0 };
      units.push(current);
      continue;
    }
    if (!current) {
      current = { answers: [], words: 0 };
      units.push(current);
    }
    current.answers.push(line);
    current.words += line.words;
  }
  return units;
}

/**
 * Answers before the first question ("conta pra quem não conhece…" is a prompt, not a question)
 * stay apart as the preamble: they introduce the interviewee and would mislabel the first section.
 */
function splitPreamble(units: QaUnit[]): { units: QaUnit[]; preamble: MaterialLine[] } {
  const out: QaUnit[] = [];
  const preamble: MaterialLine[] = [];
  for (const unit of units) {
    if (!unit.question) {
      preamble.push(...unit.answers);
      continue;
    }
    out.push(unit);
  }
  return { units: out.filter((unit) => unit.answers.length > 0), preamble };
}

export function lineSentences(line: MaterialLine): Sentence[] {
  return line.sentences.map((sentence, index) => ({ ...sentence, line, index }));
}

export function sentenceRef(sentence: Pick<Sentence, 'line' | 'from' | 'to'>): SourceRef {
  return segmentRef(sentence.line.sourceId, sentence.line.sourceVersion, sentence.line.segmentId, {
    from: sentence.from,
    to: sentence.to,
  });
}

export function lineRef(line: MaterialLine, range?: { from: number; to: number }): SourceRef {
  return segmentRef(line.sourceId, line.sourceVersion, line.segmentId, range);
}

/** Segment ids repeat between collections; selection identity includes source and version. */
export function materialLineKey(line: Pick<MaterialLine, 'sourceId' | 'sourceVersion' | 'segmentId'>): string {
  return refKey(segmentRef(line.sourceId, line.sourceVersion, line.segmentId));
}
export function materialRefLineKey(ref: SourceRef): string {
  return ref.locator.type === 'segment' ? refKey(segmentRef(ref.sourceId, ref.sourceVersion, ref.locator.segmentId)) : refKey(ref);
}
export function materialSentenceKey(sentence: Pick<Sentence, 'line' | 'from'>): string {
  return `${materialLineKey(sentence.line)}:${sentence.from}`;
}

export const FIRST_PERSON = /(^|[\s,.;:!?"“(])(eu|a gente|nós|nosso|nossa|nossos|nossas|meu|minha|meus|minhas|comigo)(?=$|[\s,.;:!?"”)])/i;
export const WEAK_START = /^(e|mas|então|aí|daí|porque|tipo|né|bom|olha|assim)\b/i;
const STOP_WORDS = new Set([
  'para', 'pela', 'pelo', 'como', 'mais', 'muito', 'muita', 'isso', 'esse', 'essa', 'este', 'esta', 'aqui', 'onde', 'quando',
  'porque', 'sobre', 'entre', 'depois', 'antes', 'ainda', 'também', 'então', 'tudo', 'nada', 'cada', 'outro', 'outra', 'seus',
  'suas', 'dele', 'dela', 'deles', 'gente', 'quem', 'qual', 'quais', 'mesmo', 'mesma', 'foram', 'seria', 'pode', 'vamos',
]);

/** Content words (≥ 4 letters, no stop words), folded for matching. */
export function keywords(text: string): string[] {
  return [...new Set(words(foldForMatch(text)).filter((word) => word.length >= 4 && !STOP_WORDS.has(word)))];
}

/** How quotable a sentence is: complete, mid-length, personal, concrete, on the brief's angle. */
export function quoteScore(sentence: Sentence, angleWords: ReadonlySet<string>): number {
  const { words: count, text } = sentence;
  if (sentence.line.memory?.kind === 'statistic') return Number.NEGATIVE_INFINITY;
  if (count < 8 || count > 40 || text.includes('?')) return Number.NEGATIVE_INFINITY;
  let score = 10 - Math.abs(count - 18) * 0.3;
  if (FIRST_PERSON.test(text)) score += 3;
  if (/\d/.test(text)) score += 2;
  if (WEAK_START.test(text)) score -= 3;
  if (/[.!…]$/.test(text)) score += 1;
  for (const word of keywords(text)) if (angleWords.has(word)) score += 2;
  return score;
}

/**
 * "Selecionando falas-chave": the best sentence of each unit first (spread across the material),
 * then the next best overall, never two from the same segment.
 */
export function pickKeyQuotes(material: Material, count: number, rng: Rng, angle?: string, avoid?: ReadonlySet<string>): Sentence[] {
  const angleWords = new Set(angle ? keywords(angle) : []);
  const scored = material.units.map((unit) =>
    unit.answers
      .flatMap(lineSentences)
      .map((sentence) => ({
        sentence,
        // A line the headline already lifts is not quoted again (`avoid`: `segmentId:from`).
        score: avoid?.has(materialSentenceKey(sentence)) ? Number.NEGATIVE_INFINITY : quoteScore(sentence, angleWords) + rng.next() * 0.5,
      }))
      .filter((entry) => Number.isFinite(entry.score))
      .sort((a, b) => b.score - a.score),
  );
  const picked: Sentence[] = [];
  const usedSegments = new Set<string>();
  const take = (sentence: Sentence) => {
    picked.push(sentence);
    usedSegments.add(materialLineKey(sentence.line));
  };
  for (const unitScores of scored) {
    if (picked.length >= count) break;
    const best = unitScores[0];
    if (best && !usedSegments.has(materialLineKey(best.sentence.line))) take(best.sentence);
  }
  const rest = scored.flat().sort((a, b) => b.score - a.score);
  for (const entry of rest) {
    if (picked.length >= count) break;
    if (!usedSegments.has(materialLineKey(entry.sentence.line))) take(entry.sentence);
  }
  return picked;
}

/** Splits units into `count` contiguous groups of similar size. */
export function groupUnits(units: readonly QaUnit[], count: number): QaUnit[][] {
  if (count <= 0 || units.length === 0) return [];
  const groups: QaUnit[][] = [];
  const total = units.reduce((sum, unit) => sum + unit.words, 0);
  let current: QaUnit[] = [];
  let accumulated = 0;
  units.forEach((unit, index) => {
    current.push(unit);
    accumulated += unit.words;
    const groupsLeft = count - groups.length - 1;
    const unitsLeft = units.length - index - 1;
    const reachedShare = accumulated >= (total * (groups.length + 1)) / count;
    if (groupsLeft > 0 && (reachedShare || unitsLeft === groupsLeft)) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length > 0) groups.push(current);
  return groups;
}
