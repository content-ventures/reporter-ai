import { podcastLink, UNNAMED_PODCAST } from '../../../domain/citation-library.ts';
import type { CitationInput, CitationView } from '../../../domain/citation-library.ts';
import { isSuggestedCitation } from '../../../domain/citation-suggestions.ts';
import { CITATION_VERDICTS, CLAIM_KINDS, citationScore, citationVerdict, effectiveClaims } from '../../../domain/fact-check.ts';
import type { CitationScore, CitationVerdict, ClaimKind } from '../../../domain/fact-check.ts';
import type { BankQuote } from '../../../domain/hard-news.ts';
import { placeLabel } from '../../../domain/source.ts';

/**
 * The R1 citation library (`CitationLibrary` port) read as the R2 quote bank. An R1 citation is a
 * literal passage of a transcript: its words, source and speaker never change. The desk edits only
 * what R1 lets an editor edit: the context ("relevância"), the date and the check with the source.
 */

/** "14:32", "1:02:05": the passage's position in the recording. */
export function locatorOf(startMs: number | undefined): string | undefined {
  if (startMs === undefined || !Number.isFinite(startMs) || startMs < 0) return undefined;
  const total = Math.floor(startMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** An R1 citation as a quote of the bank (an interview, with no topic or role in R1); "Parte 2 · 3:12" in a material sent in parts. */
export function quoteOf(citation: CitationView): BankQuote {
  const sourceUrl = podcastLink(citation.podcastUrl);
  const locator = citation.place ? placeLabel(citation.place, locatorOf) : locatorOf(citation.startMs);
  return {
    id: citation.id,
    text: citation.text,
    author: citation.speaker,
    role: '',
    topic: '',
    origin: 'transcript',
    sourceTitle: citation.podcastName || citation.sourceTitle,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(locator ? { locator } : {}),
    context: citation.relevance,
    // The recording date only when the source has one: the day the text was written is not it.
    recordedOn: citation.recordedOn ?? '',
    verified: citation.authorConfirmed,
    suggested: isSuggestedCitation(citation),
    uses: citation.uses.length,
    usedIn: citation.uses,
    ...(citation.factCheck ? { factCheck: citation.factCheck } : {}),
    attribution: { sourceNamed: citation.podcast !== UNNAMED_PODCAST, dated: Boolean(citation.recordedOn) },
    checkable: citation.authorized,
    identified: Boolean(citation.personId),
    ...(citation.personId ? { personId: citation.personId } : {}),
    participants: citation.participants,
  };
}

/** A quote is a quote only with the person who said it: one without stays under "Sem autor". */
export const identified = (quote: Pick<BankQuote, 'identified'>): boolean => quote.identified !== false;

/** What saving a quote sends: the citation's words, source and speaker, the desk's context, date and check. */
export function citationInputOf(citation: CitationView, quote: Pick<BankQuote, 'context' | 'recordedOn' | 'verified' | 'attribution' | 'personId'>): CitationInput {
  // The person the editor linked in the drawer, else the one the transcript already had.
  const personId = quote.personId ?? citation.personId;
  return {
    sourceId: citation.ref.sourceId,
    sourceVersion: citation.ref.sourceVersion,
    text: citation.text,
    productionId: citation.productionId,
    ...(personId ? { personId } : {}),
    authorConfirmed: quote.verified,
    relevance: quote.context.trim(),
    ...(citation.podcastName ? { podcastName: citation.podcastName } : {}),
    ...(citation.podcastUrl ? { podcastUrl: citation.podcastUrl } : {}),
    // The recording day only when the citation had one or the editor set it (the drawer marks a day it
    // sets as `dated`). The card no longer shows the creation day, so any other day was set by someone.
    ...(quote.recordedOn && (citation.recordedOn || (quote.attribution?.dated ?? true)) ? { recordedOn: quote.recordedOn } : {}),
    ...(citation.location ? { location: citation.location } : {}),
  };
}

// ── Gestão: veracity, score and the ranking ─────────────────────────────────────────────────

/** Undefined until the quote is checked, and for a quote without its author, which is never ranked. */
export function quoteScore(quote: BankQuote): CitationScore | undefined {
  if (!identified(quote)) return undefined;
  return citationScore({ check: quote.factCheck, authorConfirmed: quote.verified,
    sourceNamed: quote.attribution?.sourceNamed ?? Boolean(quote.sourceTitle.trim()),
    dated: quote.attribution?.dated ?? Boolean(quote.recordedOn), linked: Boolean(quote.sourceUrl), uses: quote.uses });
}

export const quoteVerdict = (quote: BankQuote): CitationVerdict => citationVerdict(quote.factCheck);

/** A quote with its seal and score, computed once per render. */
export type RankedQuote = { quote: BankQuote; verdict: CitationVerdict; score?: CitationScore };
export const rankQuote = (quote: BankQuote): RankedQuote => ({ quote, verdict: quoteVerdict(quote), score: quoteScore(quote) });

/** "Melhores" starts here; "A revisar" below `REVIEW_BELOW`. */
export const BEST_FROM = 70;
export const REVIEW_BELOW = 50;

export type QuoteTab = 'all' | 'best' | 'review' | 'pending' | 'suggested' | 'unattributed';
/** "Sugeridas" is listed only while the bank holds a suggestion (or the tab is open). */
export const QUOTE_TABS: { value: QuoteTab; label: string }[] = [
  { value: 'all', label: 'Todas' }, { value: 'best', label: 'Melhores' }, { value: 'review', label: 'A revisar' }, { value: 'pending', label: 'Pendentes' },
  { value: 'suggested', label: 'Sugeridas' }, { value: 'unattributed', label: 'Sem autor' },
];

/**
 * "Sem autor" holds the quotes waiting for their person; every other tab holds only quotes with
 * one. An outline passage nobody confirmed has its own tab: it is not waiting for a check.
 */
export function inTab(entry: RankedQuote, tab: QuoteTab): boolean {
  if (tab === 'unattributed') return !identified(entry.quote);
  if (!identified(entry.quote)) return false;
  if (tab === 'suggested') return Boolean(entry.quote.suggested);
  if (tab === 'pending') return entry.verdict === 'pending' && !entry.quote.suggested;
  if (tab === 'best') return Boolean(entry.score && entry.score.total >= BEST_FROM);
  if (tab === 'review') return entry.verdict === 'disputed' || entry.verdict === 'not_validated' || Boolean(entry.score && entry.score.total < REVIEW_BELOW);
  return true;
}

export type QuoteFilters = { kind: ClaimKind | ''; verdict: CitationVerdict | ''; author: string; source: string; authorship: 'confirmed' | 'pending' | '' };
export const NO_FILTERS: QuoteFilters = { kind: '', verdict: '', author: '', source: '', authorship: '' };

export function matchesFilters(entry: RankedQuote, filters: QuoteFilters): boolean {
  const { quote } = entry;
  return (!filters.kind || Boolean(quote.factCheck && effectiveClaims(quote.factCheck).some(claim => claim.kind === filters.kind)))
    && (!filters.verdict || entry.verdict === filters.verdict)
    && (!filters.author || quote.author === filters.author)
    && (!filters.source || quote.sourceTitle === filters.source)
    && (!filters.authorship || (filters.authorship === 'confirmed' ? quote.verified : !quote.verified && !quote.suggested));
}

export type QuoteSortKey = 'score' | 'uses' | 'recordedOn' | 'author';
export type QuoteSort = { key: QuoteSortKey; direction: 'asc' | 'desc' };
export const DEFAULT_SORT: QuoteSort = { key: 'score', direction: 'desc' };

/** Unchecked quotes have no score: they always come last, whatever the direction. */
export function sortQuotes(entries: readonly RankedQuote[], sort: QuoteSort): RankedQuote[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const compare = (a: RankedQuote, b: RankedQuote): number => {
    if (sort.key === 'score') {
      if (!a.score || !b.score) return a.score ? -1 : b.score ? 1 : 0;
      return sign * (a.score.total - b.score.total);
    }
    if (sort.key === 'uses') return sign * (a.quote.uses - b.quote.uses);
    if (sort.key === 'recordedOn') return sign * a.quote.recordedOn.localeCompare(b.quote.recordedOn);
    return sign * a.quote.author.localeCompare(b.quote.author, 'pt-BR');
  };
  return [...entries].sort((a, b) => compare(a, b) || b.quote.recordedOn.localeCompare(a.quote.recordedOn));
}

export type BankSummary = { total: number; checked: number; disputed: number; averageScore?: number; uses: number };

export function bankSummary(entries: readonly RankedQuote[]): BankSummary {
  const scores = entries.flatMap(entry => entry.score ? [entry.score.total] : []);
  return { total: entries.length, checked: entries.filter(entry => entry.verdict !== 'pending').length,
    disputed: entries.filter(entry => entry.verdict === 'disputed').length,
    ...(scores.length ? { averageScore: Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) } : {}),
    uses: entries.reduce((sum, entry) => sum + entry.quote.uses, 0) };
}

/** Claims of every checked quote, by kind: what the bank is made of. */
export function kindDistribution(entries: readonly RankedQuote[]): Record<ClaimKind, number> {
  const counts = Object.fromEntries(CLAIM_KINDS.map(kind => [kind, 0])) as Record<ClaimKind, number>;
  for (const { quote } of entries) for (const claim of quote.factCheck ? effectiveClaims(quote.factCheck) : []) counts[claim.kind] += 1;
  return counts;
}

export function verdictDistribution(entries: readonly RankedQuote[]): Record<CitationVerdict, number> {
  const counts = Object.fromEntries(CITATION_VERDICTS.map(verdict => [verdict, 0])) as Record<CitationVerdict, number>;
  for (const entry of entries) counts[entry.verdict] += 1;
  return counts;
}

/** "Checar pendentes" checks at most this many per click: each one spends up to three searches. Suggestions wait for a person. */
export const CHECK_BATCH = 20;
export const pendingBatch = (entries: readonly RankedQuote[]) => entries
  .filter(entry => inTab(entry, 'pending') && entry.quote.checkable !== false).slice(0, CHECK_BATCH).map(entry => entry.quote.id);
