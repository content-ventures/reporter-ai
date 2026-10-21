/**
 * The hard-news rules (notícia) measured in a written text: the lide, the headline, attribution,
 * tone, self-claims, relative dates and quotations. A rehearsal metric only: it never changes,
 * blocks or scores a text in the studio.
 *
 * Where each rule looks:
 * - the lide is the first sentence of the first paragraph;
 * - the body is every paragraph and quote block; a section is the blocks under one heading, and a
 *   text without headings has no sections;
 * - body rules run with every quotation (“…”, "…", «…») blanked out, so a speaker's own words never
 *   count against the newsroom; the headline is read whole, because it is always the newsroom's.
 * Word boundaries are Unicode-aware: "único" and "amanhã" match as whole words, "unicórnio" does not.
 */
import { inlinesText } from './article.ts';
import type { ArticleBody, ParagraphBlock } from './article.ts';
import { directQuotes, quoteKey } from './article-policy.ts';
import { articleSentences } from './text/sentences.ts';
import { countCharacters, countWords, words } from './text/stats.ts';

export type HardNewsIssueCode = 'LEAD_TOO_LONG' | 'LEAD_QUOTE' | 'LEAD_RITUAL' | 'HEADLINE_TOO_LONG' | 'HEADLINE_SOFT_VERB'
  | 'HEADLINE_SELF_CLAIM' | 'EVALUATIVE_ATTRIBUTION' | 'PROMOTIONAL_WORD' | 'CRUTCH' | 'SELF_CLAIM_UNATTRIBUTED'
  | 'RELATIVE_DATE' | 'QUOTES_BELOW_MINIMUM' | 'REPEATED_QUOTE' | 'LONG_QUOTE' | 'SECTION_WITHOUT_QUOTE';
export type HardNewsMetrics = { leadWords: number; leadQuoted: boolean; leadRitual: boolean; leadSharesHeadline: boolean; leadNumber: boolean;
  headlineChars: number; headlineSoftVerbs: string[]; headlineNumber: boolean; neutral: number; evaluative: number;
  promotional: string[]; crutches: string[]; selfClaimsUnattributed: number; relativeDates: number;
  quotes: number; repeatedQuotes: number; averageQuoteWords: number; longQuotes: number; longQuoteShare: number;
  sections: number; sectionsWithQuote: number; quotableSections?: number; quotableSectionsWithQuote?: number };
export type HardNewsLintOptions = { minQuotes: number; eventName?: string; quotableSections?: readonly boolean[];
  /** A quoted span that is a real quotation (default: 4+ words). The harness passes "literal in a spoken line". */
  isQuotation?: (quote: string) => boolean };
export type HardNewsIssue = { code: HardNewsIssueCode; detail: string };
type LeadIssueCode = 'LEAD_TOO_LONG' | 'LEAD_QUOTE' | 'LEAD_RITUAL';

export const LEAD_MAX_WORDS = 40, HEADLINE_MAX_CHARS = 90, LONG_QUOTE_WORDS = 45, LONG_QUOTE_SENTENCES = 2;

/** A pattern of whole words: no letter or digit may touch either end. */
const W = (pattern: string, flags = 'giu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, flags);
const found = (pattern: RegExp, text: string) => [...text.matchAll(pattern)].map(match => match[0]);
const outsideQuotes = (text: string) => text.replace(/“[^”]*”|"[^"]*"|«[^»]*»/gu, ' ');
/** Lower-case words without accents, for comparing names and content words. */
const folded = (text: string) => words(text.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase('pt-BR'));
const fourWords = (quote: string) => countWords(quote) >= 4;

/** A lide that opens with the event, the ceremony, the agenda, someone's presence or a scene. */
const RITUAL_OPENING = /^(?:(?:A|O|Na|No|Nesta|Neste|Durante(?: a| o)?|Em)\s+)?(?:abertura|cerimônia|noite|manhã|tarde|primeiro dia|segundo dia|terceiro dia|último dia|programação|edição|feira|evento|painel|palestra|debate|episódio|podcast|programa|entrevista|conversa)(?![\p{L}])/iu;
const RITUAL = [
  W('foi marcad[oa]|marcou o início|reuniu'),
  W('Quem (?:anda|passa|visita)'),
  W('(?:participa|participou|marca presença|marcou presença|esteve presente|está presente) (?:d[aeo]s?|n[aeo]s?)'),
];
/** Words that may come before the event's name when a lide opens with it ("Na APAS Show…"). */
const EVENT_LEAD_IN = new Set(['a', 'o', 'as', 'os', 'na', 'no', 'nas', 'nos', 'em', 'nesta', 'neste', 'durante']);
const SOFT_VERB = W('destaca(?:m)?|aposta(?:m)? em|reforça(?:m)?|discute(?:m)?|debate(?:m)?|leva(?:m)?|traz(?:em)?|foca(?:m)? em');
/** "marca" after one of these is the noun ("A marca Rio lança…"), not the soft verb. */
const MARCA_NOUN_AFTER = new Set(['a', 'à', 'da', 'na', 'pela', 'sua', 'uma', 'nova', 'própria', 'de', 'com', 'sem', 'cada', 'mesma', 'essa', 'esta', 'nossa']);
const EVALUATIVE = W('(?:ressalt|avali|pontu|destac|enfatiz|salient|comemor|celebr|fris|sublinh)(?:a|ou|am|aram)');
const NEUTRAL = W('disse|disseram|afirmou|afirmaram|informou|informaram|explicou|contou|declarou|acrescentou|relatou|segundo|de acordo com');
/** Case-sensitive, so an award named "Prêmio Excelência" passes. */
const PROMOTIONAL = W('inovador(?:a|es|as)?|revolucionári[oa]s?|incríve(?:l|is)|excelência|renomad[oa]s?|imperdíve(?:l|is)|sofisticad[oa]s?|de ponta|de alta qualidade|alto padrão|grande destaque|sucesso|principais players|maior feira|diferenciad[oa]s?', 'gu');
const CRUTCH = W('em resumo|em síntese|sendo assim|neste sentido|vale ressaltar|vale destacar|vale lembrar|é importante (?:destacar|ressaltar)|diante disso|confira|veja os vencedores');
const SELF_CLAIM = W('(?:o|a|os|as) (?:únic[oa]s?|pioneir[oa]s?|primeir[oa]s?) (?:empresa|marca|indústria|fabricante|laboratório|produto|vacina|do Brasil|do país|do mercado|no Brasil|no país|no mercado|a oferecer|a lançar|a produzir)|líder(?:es)? (?:de|do|no|em) (?:mercado|segmento|setor)|pioneir[oa]s?');
const CLAIM_ATTRIBUTION = W('disse|afirmou|informou|segundo|de acordo com|diz ser|afirma ser|se diz|se apresenta como');
const RELATIVE_DATE = W('amanhã|ontem');
/** Folded function words of four letters or more: sharing one says nothing about the lide's subject. */
const STOPWORDS = new Set(['para', 'pela', 'pelo', 'pelas', 'pelos', 'como', 'mais', 'menos', 'entre', 'sobre', 'esta', 'este', 'estas', 'estes',
  'essa', 'esse', 'isso', 'isto', 'desta', 'deste', 'dessa', 'desse', 'nesta', 'neste', 'nessa', 'nesse', 'seus', 'suas', 'mesmo', 'mesma',
  'ainda', 'depois', 'antes', 'quando', 'onde', 'tambem', 'foram', 'sera', 'serao', 'estao', 'apos', 'contra', 'desde', 'durante', 'segundo',
  'porque', 'muito', 'muita', 'outro', 'outra', 'outros', 'outras', 'cada', 'todo', 'toda', 'todos', 'todas', 'qual', 'quais', 'assim',
  'nossa', 'nosso', 'dela', 'dele', 'delas', 'deles', 'elas', 'eles', 'numa', 'acordo']);

function opensWithEvent(lead: string, eventName?: string): boolean {
  const name = folded(eventName ?? '').slice(0, 2);
  if (!name.length) return false;
  const tokens = folded(lead);
  let start = 0;
  while (start < 2 && tokens[start] !== name[0] && EVENT_LEAD_IN.has(tokens[start] ?? '')) start += 1;
  return name.every((word, index) => tokens[start + index] === word);
}

function ritualLead(lead: string, eventName?: string): boolean {
  const text = outsideQuotes(lead).trim();
  return RITUAL_OPENING.test(text) || RITUAL.some(pattern => found(pattern, text).length > 0) || opensWithEvent(text, eventName);
}

/** What breaks a lide: over 40 words, a quotation, or an opening on the event, a ritual or a scene. */
export function leadIssues(sentence: string, eventName?: string, isQuotation: (quote: string) => boolean = fourWords): LeadIssueCode[] {
  const issues: LeadIssueCode[] = [];
  if (countWords(sentence) > LEAD_MAX_WORDS) issues.push('LEAD_TOO_LONG');
  if (directQuotes(sentence).some(isQuotation)) issues.push('LEAD_QUOTE');
  if (ritualLead(sentence, eventName)) issues.push('LEAD_RITUAL');
  return issues;
}

function headlineSoftVerbs(title: string): string[] {
  const soft = found(SOFT_VERB, title).map(verb => verb.toLocaleLowerCase('pt-BR'));
  const tokens = words(title.toLocaleLowerCase('pt-BR'));
  tokens.forEach((token, index) => {
    if ((token === 'marca' || token === 'marcam') && !MARCA_NOUN_AFTER.has(tokens[index - 1] ?? '')) soft.push(token);
  });
  return soft;
}

/** Content words: folded, four letters or more, function words left out. */
function contentWords(text: string): Set<string> {
  return new Set(folded(text).filter(word => (word.match(/\p{L}/gu)?.length ?? 0) >= 4 && !STOPWORDS.has(word)));
}

const share = (part: number, whole: number) => whole ? Math.round(part / whole * 100) / 100 : 0;

export function hardNewsLint(body: ArticleBody, options: HardNewsLintOptions): { metrics: HardNewsMetrics; issues: HardNewsIssue[] } {
  const isQuotation = options.isQuotation ?? fourWords;
  const issues: HardNewsIssue[] = [];
  const report = (code: HardNewsIssueCode, detail: string) => issues.push({ code, detail });
  const quotationsOf = (text: string) => directQuotes(text).filter(isQuotation);

  const texts: string[] = [];
  const sections: { title: string; texts: string[] }[] = [];
  for (const block of body.blocks) {
    if (block.type === 'heading') sections.push({ title: inlinesText(block.inlines), texts: [] });
    else if (block.type === 'paragraph' || block.type === 'quote') {
      texts.push(inlinesText(block.inlines));
      sections.at(-1)?.texts.push(inlinesText(block.inlines));
    }
  }

  const opening = body.blocks.find((block): block is ParagraphBlock => block.type === 'paragraph');
  const lead = opening ? articleSentences(inlinesText(opening.inlines))[0] ?? '' : '';
  const leadWords = countWords(lead);
  const lideIssues = leadIssues(lead, options.eventName, isQuotation);
  if (lideIssues.includes('LEAD_TOO_LONG')) report('LEAD_TOO_LONG', `${leadWords} words`);
  if (lideIssues.includes('LEAD_QUOTE')) report('LEAD_QUOTE', directQuotes(lead).filter(isQuotation).join(' | '));
  if (lideIssues.includes('LEAD_RITUAL')) report('LEAD_RITUAL', lead);

  const headlineChars = countCharacters(body.title);
  if (headlineChars > HEADLINE_MAX_CHARS) report('HEADLINE_TOO_LONG', `${headlineChars} characters`);
  const softVerbs = headlineSoftVerbs(body.title);
  for (const verb of softVerbs) report('HEADLINE_SOFT_VERB', verb);
  for (const claim of found(SELF_CLAIM, body.title)) report('HEADLINE_SELF_CLAIM', claim);

  const unquoted = texts.map(outsideQuotes).join('\n');
  const evaluative = found(EVALUATIVE, unquoted);
  for (const verb of evaluative) report('EVALUATIVE_ATTRIBUTION', verb);
  const promotional = found(PROMOTIONAL, unquoted);
  for (const word of promotional) report('PROMOTIONAL_WORD', word);
  const crutches = found(CRUTCH, unquoted);
  for (const crutch of crutches) report('CRUTCH', crutch);
  const relativeDates = found(RELATIVE_DATE, unquoted);
  for (const date of relativeDates) report('RELATIVE_DATE', date);
  const unattributed = texts.flatMap(text => articleSentences(text))
    .filter(sentence => found(SELF_CLAIM, outsideQuotes(sentence)).length > 0 && found(CLAIM_ATTRIBUTION, sentence).length === 0);
  for (const sentence of unattributed) report('SELF_CLAIM_UNATTRIBUTED', sentence);

  const quotations = texts.flatMap(quotationsOf);
  const seen = new Set<string>();
  for (const quotation of quotations) {
    const key = quoteKey(quotation);
    if (seen.has(key)) report('REPEATED_QUOTE', quotation);
    seen.add(key);
  }
  if (seen.size < options.minQuotes) report('QUOTES_BELOW_MINIMUM', `${seen.size} of ${options.minQuotes}`);
  const long = quotations.filter(quotation => articleSentences(quotation).length > LONG_QUOTE_SENTENCES || countWords(quotation) > LONG_QUOTE_WORDS);
  for (const quotation of long) report('LONG_QUOTE', quotation);
  const quoteWords = quotations.reduce((sum, quotation) => sum + countWords(quotation), 0);

  const quoted = sections.map(section => section.texts.some(text => quotationsOf(text).length > 0));
  const quotable = options.quotableSections ? sections.map((_section, index) => Boolean(options.quotableSections?.[index])) : undefined;
  quotable?.forEach((flag, index) => { if (flag && !quoted[index]) report('SECTION_WITHOUT_QUOTE', sections[index].title); });

  const headlineWords = contentWords(body.title);
  const metrics: HardNewsMetrics = {
    leadWords,
    leadQuoted: lideIssues.includes('LEAD_QUOTE'),
    leadRitual: lideIssues.includes('LEAD_RITUAL'),
    leadSharesHeadline: [...contentWords(lead)].some(word => headlineWords.has(word)),
    leadNumber: /\p{N}/u.test(lead),
    headlineChars,
    headlineSoftVerbs: softVerbs,
    headlineNumber: /\p{N}/u.test(body.title),
    neutral: found(NEUTRAL, unquoted).length,
    evaluative: evaluative.length,
    promotional,
    crutches,
    selfClaimsUnattributed: unattributed.length,
    relativeDates: relativeDates.length,
    quotes: seen.size,
    repeatedQuotes: quotations.length - seen.size,
    averageQuoteWords: quotations.length ? Math.round(quoteWords / quotations.length * 10) / 10 : 0,
    longQuotes: long.length,
    longQuoteShare: share(long.length, quotations.length),
    sections: sections.length,
    sectionsWithQuote: quoted.filter(Boolean).length,
    ...(quotable ? {
      quotableSections: quotable.filter(Boolean).length,
      quotableSectionsWithQuote: quotable.filter((flag, index) => flag && quoted[index]).length,
    } : {}),
  };
  return { metrics, issues };
}
