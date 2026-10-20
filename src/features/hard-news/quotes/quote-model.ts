import { podcastLink } from '../../../domain/citation-library.ts';
import type { CitationInput, CitationView } from '../../../domain/citation-library.ts';
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
    recordedOn: citation.recordedOn ?? citation.createdAt.slice(0, 10),
    verified: citation.authorConfirmed,
    uses: citation.uses.length,
  };
}

/** What saving a quote sends: the citation's words, source and speaker, the desk's context, date and check. */
export function citationInputOf(citation: CitationView, quote: Pick<BankQuote, 'context' | 'recordedOn' | 'verified'>): CitationInput {
  return {
    sourceId: citation.ref.sourceId,
    sourceVersion: citation.ref.sourceVersion,
    text: citation.text,
    productionId: citation.productionId,
    ...(citation.personId ? { personId: citation.personId } : {}),
    authorConfirmed: quote.verified,
    relevance: quote.context.trim(),
    ...(citation.podcastName ? { podcastName: citation.podcastName } : {}),
    ...(citation.podcastUrl ? { podcastUrl: citation.podcastUrl } : {}),
    ...(quote.recordedOn ? { recordedOn: quote.recordedOn } : {}),
    ...(citation.location ? { location: citation.location } : {}),
  };
}
