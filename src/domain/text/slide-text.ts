/**
 * Text helpers for slide copy: sentences, budgets and word-boundary cuts. Pure (no React, no DS),
 * so the slide assist and its tests share them. Slide copy is always taken from the approved
 * article — these helpers only select and cut, they never write new words.
 */

const BOUNDARY = /[.!?…]+["'”»)]*(?=\s|$)/g;
/** Abbreviations and initials that end with a dot without ending the sentence. */
const ABBREVIATION = /(?:^|[\s(])(?:sr|sra|srta|dr|dra|prof|profa|av|etc|p|pág|nº|n|vol|cap|art|ex|obs|[A-ZÀ-Ý])\.$/i;
/** Openers that only make sense after another sentence ("Para isso, …"). */
const CONNECTOR = /^(?:para isso|além disso|com isso|assim|mas|e|já|ainda|por isso|depois|hoje|agora),?\s+/i;

/** Sentences of a text (whitespace trimmed, nothing else changed). */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const match of text.matchAll(BOUNDARY)) {
    const end = (match.index ?? 0) + match[0].length;
    if (match[0] === '.' && ABBREVIATION.test(text.slice(Math.max(0, end - 8), end))) continue;
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** Words that cannot end a cut ("…lona de caminhão em"): articles, prepositions, conjunctions. */
const DANGLING = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'ao', 'aos',
  'à', 'às', 'com', 'sem', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'pra', 'pro', 'e', 'ou', 'nem', 'mas', 'que', 'se',
  'seu', 'sua', 'seus', 'suas', 'sobre', 'entre', 'até', 'mais', 'muito', 'num', 'numa', 'como', 'quando', 'onde',
]);

/** Verbs of an attribution (“…”, diz Ana): a cut never ends on one that lost its speaker. */
const SPEECH = new Set(['diz', 'disse', 'afirma', 'afirmou', 'conta', 'contou', 'explica', 'explicou', 'observa', 'completa', 'segundo', 'lembra', 'resume']);

/** Drops trailing punctuation and words that leave a cut hanging (", diz" without the name). */
export function trimDangling(text: string): string {
  const words = text.replace(/[\s,;:–—-]+$/, '').split(/\s+/);
  const hanging = (word: string) => {
    const lower = word.toLocaleLowerCase('pt-BR');
    return DANGLING.has(lower) || SPEECH.has(lower);
  };
  while (words.length > 1 && hanging(words[words.length - 1])) {
    words.pop();
    // Commas left before the dropped word: "“Frase”, diz" → "“Frase”".
    words[words.length - 1] = words[words.length - 1].replace(/[,;:–—-]+$/, '');
  }
  return words.join(' ').replace(/[\s,;:–—-]+$/, '');
}

/** An opening quotation mark without its closing one: a cut inside a quotation. */
function openQuote(text: string): boolean {
  return (text.match(/[“«]/g) ?? []).length > (text.match(/[”»]/g) ?? []).length;
}

/** A number at the end of a cut lost its noun ("para 6" of "para 6 pares"). */
const BARE_NUMBER = /(?:^|\s)\d[\d.,]*$/;

/**
 * Shorter versions of a text cut at words, longest first, down to `minShare` of its words: never
 * ending on an article, preposition, conjunction or a speech verb that lost its speaker, nor on a
 * number that lost its noun. `ellipsis` marks prose cuts with "…".
 */
export function wordCuts(text: string, minShare = 0.4, options: { ellipsis?: boolean } = {}): string[] {
  const all = text.trim().split(/\s+/);
  const cuts: string[] = [];
  for (let keep = all.length - 1; keep >= Math.max(2, Math.ceil(all.length * minShare)); keep -= 1) {
    const words = withoutFinalPeriod(trimDangling(all.slice(0, keep).join(' ')));
    if (!words || BARE_NUMBER.test(words)) continue;
    // A cut inside a quotation closes it and says it was cut (“Frase cortada…”), never “ alone.
    const cut = openQuote(words) ? `${words}…”` : options.ellipsis ? `${words}…` : words;
    if (!cuts.includes(cut)) cuts.push(cut);
  }
  return cuts;
}

/**
 * Title versions within `maxChars`, preferred first: the whole title, its clauses (before ": ",
 * " — ", ", " — so a quote headline keeps the quotation and drops ", diz Fulano"), then word
 * cuts. The carousel generation, its "Conferindo limites" step and the start page's preview all
 * pick from this list, so the preview shows the title the run writes.
 */
export function titleCandidates(text: string, maxChars: number): string[] {
  const clean = withoutFinalPeriod(text);
  const out: string[] = [];
  const push = (candidate: string | undefined) => {
    const value = candidate?.trim();
    if (value && value.length <= maxChars && !out.includes(value)) out.push(value);
  };
  push(clean);
  for (const separator of [': ', ' — ', ' – ', ', ']) {
    // The first clause that does not stop inside a quotation.
    for (let at = clean.indexOf(separator); at > 0; at = clean.indexOf(separator, at + separator.length)) {
      const head = trimDangling(clean.slice(0, at));
      if (openQuote(head)) continue;
      if (head.length >= 8) push(head);
      break;
    }
  }
  for (const cut of wordCuts(clean)) push(cut);
  return out;
}

/**
 * The cover title as the run leaves it: the first candidate within the characters, then — when
 * the render says it overflows its lines — the first shorter candidate that fits.
 */
export function fitTitle(text: string, maxChars: number, fits: (text: string) => boolean): string {
  const [first] = titleCandidates(text, maxChars);
  if (first === undefined) return cutAtWord(withoutFinalPeriod(text), maxChars);
  if (fits(first)) return first;
  return titleCandidates(first, maxChars).find((candidate) => candidate !== first && fits(candidate)) ?? first;
}

/** Cuts at a word boundary to at most `maxChars` (no dangling comma, dash, colon or preposition). */
export function cutAtWord(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const slice = clean.slice(0, maxChars + 1);
  const space = slice.lastIndexOf(' ');
  return trimDangling(space > 0 ? slice.slice(0, space) : clean.slice(0, maxChars));
}

/** Whole sentences first; a single long sentence is cut at a word with "…". */
export function fitSentences(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  let kept = '';
  for (const sentence of sentences(clean)) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (next.length > maxChars) break;
    kept = next;
  }
  if (kept) return kept;
  return `${cutAtWord(clean, Math.max(1, maxChars - 1))}…`;
}

/** Drops a final period (titles, credits); keeps "?" and "!". */
export function withoutFinalPeriod(text: string): string {
  return text.trim().replace(/\.+$/, '').trimEnd();
}

/** A sentence used on its own loses openers like "Para isso,". */
export function standalone(sentence: string): string {
  const stripped = sentence.replace(CONNECTOR, '');
  return stripped === sentence ? sentence : stripped.charAt(0).toLocaleUpperCase('pt-BR') + stripped.slice(1);
}

/** Title-sized phrase: the whole text, else the clause before ":" / " — " / ",", else a word cut. */
export function titlePhrase(text: string, maxChars: number): string {
  return titleCandidates(text, maxChars)[0] ?? cutAtWord(withoutFinalPeriod(text), maxChars);
}

/** Lower-case words without punctuation, for similarity and "same text" checks. */
export function wordsOf(text: string): string[] {
  return text
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function sameText(a: string, b: string): boolean {
  return wordsOf(a).join(' ') === wordsOf(b).join(' ');
}

/** Share of words in common (bag of words, 0–1), cheap and order-free. */
export function overlap(a: string, b: string): number {
  const left = wordsOf(a);
  const right = new Set(wordsOf(b));
  if (left.length === 0 || right.size === 0) return 0;
  return left.filter((word) => right.has(word)).length / Math.max(left.length, right.size);
}
