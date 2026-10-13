import { countWords } from '../../../domain/text/stats.ts';
import { FIRST_PERSON, keywords, WEAK_START } from './material.ts';
import type { Material, MaterialLine, Sentence } from './material.ts';
import { capitalize, withoutFinalPeriod } from './sentences.ts';

/**
 * Editorial moves of the extractive simulation. They only FRAME text that exists in the
 * material: reported speech wraps verbatim sentences in quotation marks with the speaker's name
 * (and role, from the person record), headings and the headline are verbatim clauses of the
 * answers. Nothing here writes a claim of its own.
 */

/** Who speaks in the article: the person's name and role line, when the speaker is mapped. */
export type SpeakerInfo = { name: string; title?: string };

type Voice = { full: string; short: string; title?: string; introduced: boolean };

const VERBS = ['afirma', 'conta', 'explica', 'diz', 'observa', 'completa'] as const;

export type Voices = {
  /** "diz Beatriz Almeida, designer de calçados" the first time, then "afirma Beatriz". */
  attribution(label: string | undefined): string | undefined;
  /** Full name of a speaker label (person name when mapped). */
  fullName(label: string | undefined): string | undefined;
};

/** Two or more capitalised words ("Lucas Ferraz", "Ana da Silva"): a name, not a role or an initial. */
export function isFullName(label: string): boolean {
  const words = label.trim().split(/\s+/);
  const named = words.filter((word) => !/^(?:da|de|do|das|dos|e)$/i.test(word));
  return named.length >= 2 && named.every((word) => /^\p{Lu}[\p{L}'’-]+$/u.test(word));
}

/**
 * Speakers the article may name: the person mapped in "Falantes", or a label that already is a
 * full name. A raw label ("R.", "Entrevistada", "P1") is never written as a name: its lines are
 * quoted without attribution ("diz R." or "diz R.." never happen).
 */
export function createVoices(material: Material, people: Readonly<Record<string, SpeakerInfo>> | undefined): Voices {
  const labels = material.speakers.filter((label) => label !== material.interviewer);
  const fullOf = (label: string): string | undefined => {
    const mapped = people?.[label]?.name?.trim();
    if (mapped) return mapped;
    return isFullName(label) ? label.trim() : undefined;
  };
  const firstOf = (name: string) => name.split(/\s+/)[0] ?? name;
  const named = labels.map((label) => [label, fullOf(label)] as const).filter((entry): entry is readonly [string, string] => entry[1] !== undefined);
  const firstNames = named.map(([, full]) => firstOf(full));
  const voices = new Map<string, Voice>();
  for (const [label, full] of named) {
    const first = firstOf(full);
    const shared = firstNames.filter((name) => name === first).length > 1;
    const voice: Voice = { full, short: shared ? full : first, introduced: false };
    const title = people?.[label]?.title?.trim();
    if (title) voice.title = title;
    voices.set(label, voice);
  }
  let turn = 0;
  let lastVerb: string | undefined;
  return {
    attribution(label) {
      const voice = label ? voices.get(label) : undefined;
      if (!voice) return undefined;
      if (!voice.introduced) {
        voice.introduced = true;
        lastVerb = 'diz';
        return `diz ${voice.full}${voice.title ? `, ${voice.title}` : ''}`;
      }
      let verb: string = VERBS[turn % VERBS.length];
      turn += 1;
      if (verb === lastVerb) {
        verb = VERBS[turn % VERBS.length];
        turn += 1;
      }
      lastVerb = verb;
      return `${verb} ${voice.short}`;
    },
    fullName(label) {
      return label ? voices.get(label)?.full : undefined;
    },
  };
}

/** Closes a sentence after the attribution without doubling a final period ("S.A.", "Jr."). */
function endSentence(text: string): string {
  return /[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;
}

/** `“Frase”` (a final period moves out of the quotation in the attribution form). */
function opening(text: string): string {
  return `“${withoutFinalPeriod(text)}”`;
}

/** `“Frase. Outra frase”.` keeping ? ! … inside. */
function closing(text: string): string {
  const trimmed = text.trim();
  return /\.$/.test(trimmed) && !/\.\.\.$/.test(trimmed) ? `“${withoutFinalPeriod(trimmed)}”.` : `“${trimmed}”`;
}

/**
 * A paragraph of reported speech from a run of contiguous sentences of one answer:
 * `“S1”, diz Beatriz Almeida, designer de calçados. “S2 S3”.` A speaker without a name (a raw
 * label nobody linked to a person) is quoted without attribution; material without speakers
 * (a talk with one unnamed voice) stays as it is.
 */
export function reportedSpeech(line: MaterialLine, run: readonly Sentence[], voices: Voices, ellipsis = false): string {
  const first = run[0];
  const last = run[run.length - 1];
  const excerpt = `${line.text.slice(first.from, last.to)}${ellipsis ? '…' : ''}`;
  const said = voices.attribution(line.speaker);
  if (!said) return line.speaker ? closing(excerpt) : excerpt;
  if (run.length === 1) {
    const text = `${first.text}${ellipsis ? '…' : ''}`;
    return `${opening(text)}, ${endSentence(said)}`;
  }
  const rest = `${line.text.slice(run[1].from, last.to)}${ellipsis ? '…' : ''}`;
  return `${opening(first.text)}, ${endSentence(said)} ${closing(rest)}`;
}

// ——— Key phrases (headings) and the headline ———

/** Spoken lead-ins that are not part of the statement: "Eu brinco que", "E", "Olha,". */
const LEAD_INS = [
  /^(?:eu|a gente|nós)\s+(?:\S+\s+){0,2}?(?:que)\s+/i,
  /^(?:e|mas|então|aí|daí|olha|bom|assim|tipo|porque|só que|quer dizer)\s*,?\s+/i,
];
// Accented words are not \w in JS regexes: word edges are spelled out instead of \b.
const WEAK_HEAD = /^(?:isso|esse|essa|este|esta|ele|ela|eles|elas|que|não|e|mas|porque|então|é|foi|tem|aí|lá|aqui|o que|quem|como|onde|quando|se|já|sim)(?=[\s,.;:!?]|$)/i;
const WEAK_TAIL = /(?:^|\s)(?:de|do|da|dos|das|em|no|na|nos|nas|com|para|pra|por|pelo|pela|o|a|os|as|um|uma|e|ou|que|mais|muito|se|já|também|só|é|são)$/i;
const CLAUSE_BREAK = /[,;:—–]\s+/g;
const STRONG_BREAK = /[;:—–]\s+/g;
const COPULA = /\s(?:é|são|foi|era|vai ser)\s(?=(?:o|a|os|as|um|uma)\s)/i;

export type Phrase = { text: string; from: number; to: number; sentence: Sentence };

function trimLeadIns(text: string, from: number): { text: string; from: number } {
  let current = text;
  let offset = from;
  for (let pass = 0; pass < 2; pass += 1) {
    const match = LEAD_INS.map((pattern) => pattern.exec(current)).find(Boolean);
    if (!match) break;
    current = current.slice(match[0].length);
    offset += match[0].length;
  }
  return { text: current, from: offset };
}

/** Verbatim clauses of a sentence that could stand as a heading (3–10 words, no first person). */
export function phraseCandidates(sentence: Sentence, maxWords = 10): Phrase[] {
  const found: Phrase[] = [];
  const push = (raw: string, from: number) => {
    const lead = trimLeadIns(raw, from);
    const text = lead.text.replace(/[\s.,;:!…]+$/, '');
    const words = countWords(text);
    if (words < 3 || words > maxWords) return;
    // A whole reply of a few words ("Aparece, e com números.") answers the question; it says nothing alone.
    if (lead.from === sentence.from && text.length >= sentence.text.length - 1 && words < 5) return;
    if (text.includes('?') || FIRST_PERSON.test(text) || WEAK_HEAD.test(text) || WEAK_TAIL.test(text)) return;
    if (keywords(text).length === 0) return;
    found.push({ text, from: lead.from, to: lead.from + text.length, sentence });
  };
  const base = trimLeadIns(sentence.text, sentence.from);
  push(base.text, base.from);
  let start = 0;
  const clauses: { text: string; from: number }[] = [];
  // Two commas or more read as an enumeration ("uma cor, um desgaste, um logotipo"): no cut there.
  const breaks = (base.text.match(/,/g)?.length ?? 0) >= 2 ? STRONG_BREAK : CLAUSE_BREAK;
  for (const match of base.text.matchAll(breaks)) {
    const end = match.index ?? 0;
    clauses.push({ text: base.text.slice(start, end), from: base.from + start });
    start = end + match[0].length;
  }
  clauses.push({ text: base.text.slice(start), from: base.from + start });
  for (const clause of clauses) {
    if (clauses.length > 1) push(clause.text, clause.from);
    const copula = COPULA.exec(clause.text);
    if (copula) {
      const right = (copula.index ?? 0) + copula[0].length;
      push(clause.text.slice(right), clause.from + right);
    }
  }
  return found;
}

function hits(text: string, wanted: ReadonlySet<string>): number {
  return keywords(text).filter((word) => wanted.has(word)).length;
}

/**
 * Heading of a section: the best verbatim clause of its answers (≤ 10 words), on the topic of
 * the question first, then the brief. Undefined when no answer has a clause that stands alone.
 * `avoid` holds headings already used; sentences that are the lead or a quote block are skipped
 * by the caller, so the heading never repeats the line right under it.
 */
export function keyPhrase(sentences: readonly Sentence[], topic: ReadonlySet<string>, angle: ReadonlySet<string>, avoid: ReadonlySet<string>): Phrase | undefined {
  let best: { phrase: Phrase; score: number } | undefined;
  sentences.forEach((sentence, position) => {
    for (const phrase of phraseCandidates(sentence)) {
      const key = phrase.text.toLocaleLowerCase('pt-BR');
      if (avoid.has(key)) continue;
      const words = countWords(phrase.text);
      const score =
        hits(phrase.text, topic) * 3 + hits(phrase.text, angle) + (/\d/.test(phrase.text) ? 1 : 0) + (words >= 4 && words <= 8 ? 1 : 0) - position * 0.05;
      if (!best || score > best.score) best = { phrase, score };
    }
  });
  return best?.phrase;
}

/** `Phrase` as heading text: capitalised, no final punctuation. */
export function headingOf(phrase: Phrase): string {
  return capitalize(phrase.text.replace(/[\s.!…]+$/, ''));
}

/** The headline and the material sentence it lifts (`segmentId:from`, as key quotes are keyed). */
export type HeadlineLine = { text: string; key: string };

/**
 * Headline: the strongest short statement of the material (6–14 words), verbatim, in quotation
 * marks with the speaker: `“O verão de 2027 é o verão do sapato que não grita”, diz Beatriz Almeida`.
 * It depends only on the material, the brief's angle and the speakers' names, never on the random
 * pick of key quotes: "Como o artigo nasce" in Nova produção shows the headline the draft gets.
 */
export function headlineLine(
  material: Material,
  angle: ReadonlySet<string>,
  voices: Voices,
  options: { prefer?: Sentence; avoid?: ReadonlySet<string> } = {},
): HeadlineLine | undefined {
  const statement = (sentence: Pick<Sentence, 'text' | 'from'>): { text: string; lead: { from: number } } | undefined => {
    const lead = trimLeadIns(sentence.text, sentence.from);
    const text = withoutFinalPeriod(lead.text);
    const words = countWords(text);
    if (words < 6 || words > 14 || text.includes('?') || WEAK_START.test(text) || WEAK_HEAD.test(text)) return undefined;
    return { text, lead };
  };
  const format = (text: string, speaker: string | undefined) => {
    const quoted = `“${capitalize(text)}”`;
    const name = voices.fullName(speaker);
    const full = name ? `${quoted}, diz ${name}` : quoted;
    return full.length <= 120 ? full : quoted;
  };
  // The lead quote is the article's strongest line: it heads the article when it is short enough.
  const preferred = options.prefer ? statement(options.prefer) : undefined;
  if (options.prefer && preferred) {
    return { text: format(preferred.text, options.prefer.line.speaker), key: `${options.prefer.line.segmentId}:${options.prefer.from}` };
  }
  const lines = [...material.preamble, ...material.units.flatMap((unit) => unit.answers)];
  let best: { text: string; speaker?: string; score: number; key: string } | undefined;
  for (const line of lines) {
    for (const sentence of line.sentences) {
      const key = `${line.segmentId}:${sentence.from}`;
      if (options.avoid?.has(key)) continue;
      const found = statement(sentence);
      if (!found) continue;
      const { text, lead } = found;
      const words = countWords(text);
      const score =
        10 -
        Math.abs(words - 10) * 0.4 +
        (/\d/.test(text) ? 2 : 0) +
        hits(text, angle) * 2 +
        (/\s(?:é|são)\s/.test(text) ? 1 : 0) +
        (lead.from > sentence.from ? 0.5 : 0);
      if (!best || score > best.score) best = { text, ...(line.speaker ? { speaker: line.speaker } : {}), score, key };
    }
  }
  return best ? { text: format(best.text, best.speaker), key: best.key } : undefined;
}

/** `headlineLine` as text. */
export function headline(
  material: Material,
  angle: ReadonlySet<string>,
  voices: Voices,
  options: { prefer?: Sentence; avoid?: ReadonlySet<string> } = {},
): string | undefined {
  return headlineLine(material, angle, voices, options)?.text;
}
