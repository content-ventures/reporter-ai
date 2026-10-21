/**
 * Grounding check of event-format texts (João, 2026-10-19: "não pode de forma alguma criar
 * conteúdo, inventar nada"). Every number and every proper name a generated text uses must exist
 * in what the newsroom gave the system: the material, the confirmed speakers (name, role,
 * organisation) and the event data a person typed. A term that exists nowhere there is reported,
 * so the writing step revises the part and, as a last resort, the sentence is removed: the text
 * may come out shorter, never with an invented fact. Pure and deterministic.
 */

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
const lexicalKey = (text: string) => fold(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const UNITS = ['zero', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze',
  'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function below1000(n: number): string {
  if (n === 100) return 'cem';
  const parts: string[] = [];
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? ' e ' + UNITS[rest % 10] : ''));
  else if (rest > 0 || !parts.length) parts.push(UNITS[rest]);
  return parts.join(' e ');
}

/** "2026" → "dois mil e vinte e seis" (folded, without accents): how a transcript may say a number. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return '';
  if (n < 1000) return below1000(n);
  const groups: [number, string, string][] = [[1e9, 'bilhao', 'bilhoes'], [1e6, 'milhao', 'milhoes'], [1e3, 'mil', 'mil']];
  const parts: string[] = [];
  let rest = n;
  for (const [size, one, many] of groups) {
    const count = Math.floor(rest / size);
    if (!count) continue;
    parts.push(size === 1e3 && count === 1 ? 'mil' : `${below1000(count)} ${count === 1 ? one : many}`);
    rest %= size;
  }
  if (rest) parts.push((rest < 100 || rest % 100 === 0 ? 'e ' : '') + below1000(rest));
  return parts.join(' ');
}

/** The digit groups of a number as written ("R$ 17,8" → ["17", "8"], "2.500" → ["2500"]). */
function numberKeys(token: string): string[] {
  const clean = token.replace(/[^\d.,]/g, '');
  // "2.500" and "1.200.000": dots between groups of three are thousands separators.
  const thousands = /^\d{1,3}(\.\d{3})+$/.test(clean) ? clean.replace(/\./g, '') : clean;
  return thousands.split(/[.,]/).filter(Boolean);
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Every digit group the corpus states, as digits or in words ("trinta" counts for 30). */
function corpusNumbers(corpus: string): { digits: Set<string>; words: string } {
  const digits = new Set<string>();
  for (const match of corpus.matchAll(NUMBER)) {
    const keys = numberKeys(match[0]);
    keys.forEach((key) => digits.add(String(Number(key))));
    digits.add(String(Number(keys.join(''))));
  }
  return { digits, words: ` ${fold(corpus).replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ')} ` };
}

function numberGrounded(token: string, numbers: { digits: Set<string>; words: string }): boolean {
  const keys = numberKeys(token);
  if (!keys.length) return true;
  return keys.every((key) => {
    const value = Number(key);
    if (numbers.digits.has(String(value))) return true;
    // Decimals and ordinals spelled out ("dezessete vírgula oito", "quarta edição") are rare; the
    // cardinal words cover what a transcript says for counts, years, prices and percentages.
    const words = numberWords(value);
    return Boolean(words) && numbers.words.includes(` ${words} `);
  });
}

/** Capitalised words that are not names in the outlet's prose ("País", "Estado"). */
const GENERIC = new Set(['brasil', 'pais', 'estado', 'governo', 'uniao', 'nacional']);

/** Standard Brazilian UF spellings are lexical aliases, not proof of a city's location. */
const STATE_ALIASES: readonly [string, string][] = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'], ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins'],
];

function geographicalAliases(corpus: string): string {
  let remaining = ` ${fold(corpus).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `;
  const aliases: string[] = [];
  // Consume longer names first: Mato Grosso do Sul does not establish Mato Grosso.
  for (const [abbreviation, name] of [...STATE_ALIASES].sort((a, b) => b[1].length - a[1].length)) {
    const phrase = ` ${fold(name)} `;
    if (remaining.includes(phrase)) { aliases.push(abbreviation); remaining = remaining.replaceAll(phrase, ' '); }
    // Lowercase prose such as "se" or "para" is not a supplied UF abbreviation.
    if (new RegExp(`(?<![\\p{L}\\p{N}])${abbreviation}(?![\\p{L}\\p{N}])`, 'u').test(corpus)) aliases.push(name);
  }
  return aliases.join(' ');
}

/**
 * Names in a text: capitalised words and acronyms that do not open a sentence, plus
 * sentence-initial acronyms ("ASMI"). Words inside quotation marks are the speaker's literal
 * words and are checked by the quotation rule instead.
 */
function nameTokens(text: string): string[] {
  const unquoted = text.replace(/[“"«][^”"»]*[”"»]/g, ' ');
  const tokens: string[] = [];
  for (const sentence of unquoted.split(/(?<=[.!?:;])\s+|\n+/)) {
    const words = sentence.split(/[\s,()–—/]+/).map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
    words.forEach((word, index) => {
      const acronym = /^\p{Lu}{2,}$/u.test(word) || /^\p{Lu}+\p{Ll}*\p{Lu}+/u.test(word);
      const capital = /^\p{Lu}\p{Ll}{2,}/u.test(word);
      // A word in another script (a model glitch such as "معلمFIELDERROR") is checked like a name.
      const foreign = /\p{L}/u.test(word) && /[^\p{Script=Latin}\p{N}\p{P}\p{S}]/u.test(word);
      if (acronym || foreign || capital && index > 0) tokens.push(word);
    });
  }
  return tokens;
}

/**
 * The numbers and names of `text` that `corpus` (material, speakers and event data) does not
 * contain, in order of appearance, without repetitions. Empty means grounded.
 */
export function ungroundedTerms(text: string, corpus: string): string[] {
  const numbers = corpusNumbers(corpus);
  const known = ` ${lexicalKey(corpus + ' ' + geographicalAliases(corpus))} `;
  const missing: string[] = [];
  const add = (term: string) => { if (!missing.includes(term)) missing.push(term); };
  const unquoted = text.replace(/[“"«][^”"»]*[”"»]/g, ' ');
  for (const match of unquoted.matchAll(NUMBER)) if (!numberGrounded(match[0], numbers)) add(match[0]);
  for (const token of nameTokens(text)) {
    const folded = lexicalKey(token);
    if (GENERIC.has(folded)) continue;
    if (!known.includes(` ${folded} `)) add(token);
  }
  return missing;
}

/** Sentences of a paragraph, split after a stop followed by a capital or an opening quote. */
function sentencesOf(text: string): string[] {
  return text.trim().split(/(?<=[.!?…][”"'’»)]*)\s+(?=[\p{Lu}“"«(])/u);
}

/**
 * The last resort when revisions did not remove an invented term: drop the sentences that hold
 * one. A paragraph left without sentences disappears. Nothing is rewritten or added.
 */
export function dropUngroundedSentences<T extends { text: string }>(paragraphs: readonly T[], corpus: string): T[] {
  return paragraphs.flatMap((paragraph) => {
    const kept = sentencesOf(paragraph.text).filter((sentence) => ungroundedTerms(sentence, corpus).length === 0);
    return kept.length ? [{ ...paragraph, text: kept.join(' ') }] : [];
  });
}

const contentWords = (text: string) => new Set((fold(text).match(/\p{L}{4,}/gu) ?? []));

/**
 * Sentences of `text` (outside quotations) that restate a sentence already written: at least
 * three quarters of their words of four letters or more are in one sentence of `history`. The
 * outlet never says the same fact twice in a short text.
 */
export function repeatedSentences(text: string, history: string): string[] {
  const written = sentencesOf(history.replace(/[“"«][^”"»]*[”"»]/g, ' ')).map(contentWords).filter((words) => words.size >= 4);
  if (!written.length) return [];
  return sentencesOf(text).filter((sentence) => {
    const words = contentWords(sentence.replace(/[“"«][^”"»]*[”"»]/g, ' '));
    if (words.size < 6) return false;
    return written.some((previous) => [...words].filter((word) => previous.has(word)).length / words.size >= 0.75);
  });
}

/** Full names already introduced in `history` that `text` introduces again (later mentions use the surname). */
export function reintroducedPeople(text: string, history: string, names: readonly string[]): string[] {
  return names.filter((name) => name.trim().includes(' ') && history.includes(name) && text.replace(/[“"«][^”"»]*[”"»]/g, ' ').includes(name));
}
