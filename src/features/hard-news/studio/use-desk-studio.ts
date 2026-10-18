'use client';

import { useMemo } from 'react';
import type { ArticleBody, CheckResult, QuoteCheck } from '@/domain';
import type { EnrichmentSuggestion, HardNewsDossier } from '@/domain/hard-news';
import type { QuoteSourceState } from '@/editor';
import type { TextRange } from '@/domain';
import { useOptionalHardNews } from '../state/hard-news-provider';
import { evidenceCheck, locateFlags, pendingFlags, placeable, type LocatedFlag } from './evidence-model';

export type DeskStudio = {
  dossier: HardNewsDossier;
  flags: LocatedFlag[];
  suggestions: EnrichmentSuggestion[];
  /** Extra Checagem rows ("Evidências conferidas"). */
  checks: CheckResult[];
  /** Claims waiting for a person, lit in the text like an unbacked quotation. */
  decorations: { range: TextRange; state: QuoteSourceState }[];
  /** R1 checks this story answers differently (quotes are checked against the quote bank). */
  replaces: readonly string[];
  /** Quotations of the text checked against the quote bank and the accepted sources. */
  quoteDecorations: { range: TextRange; state: QuoteSourceState }[];
};

const REPLACES = ['article.quotes'] as const;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * REQ-T.7 for a covered story: a quotation is backed when the quote bank (F2.11) or an accepted
 * source has those words; otherwise it is missing, as an unbacked transcript quote is in R1.
 */
function quotesCheck(quotes: readonly QuoteCheck[], backing: readonly string[]): { check: CheckResult; decorations: DeskStudio['quoteDecorations'] } {
  const folded = backing.map(fold);
  const states = quotes.map((quote) => {
    const words = fold(quote.text);
    const backed = words.length > 0 && folded.some((text) => text.includes(words) || words.includes(text));
    return { range: quote.range, state: backed ? 'used' as const : 'missing' as const };
  });
  const verified = states.filter((entry) => entry.state === 'used').length;
  const missing = states.filter((entry) => entry.state === 'missing').map((entry) => entry.range);
  const check: CheckResult = quotes.length === 0
    ? { id: 'article.quotes', label: 'Citações conferidas', status: 'na', blocking: false, detail: 'Sem citações' }
    : {
      id: 'article.quotes',
      label: 'Citações conferidas',
      status: missing.length > 0 ? 'fail' : 'pass',
      blocking: missing.length > 0,
      detail: `${verified} de ${quotes.length} no banco de citações ou nas fontes`,
      progress: { current: verified, total: quotes.length },
      ...(missing.length > 0 ? { targets: missing } : {}),
    };
  return { check, decorations: states };
}

const NO_CHECKS: CheckResult[] = [];

/**
 * What the R2 news desk adds to the article studio of a covered story: its dossier, the evidence
 * flags located in the current text and the archive suggestions. `undefined` for every other
 * production and before R2, so the R1 studio is unchanged.
 */
export function useDeskStudio(productionId: string, body: ArticleBody, quotes: readonly QuoteCheck[]): DeskStudio | undefined {
  const desk = useOptionalHardNews();
  const bank = desk?.state.quotes;
  const dossier = desk?.state.dossiers[productionId];
  const flags = desk?.state.flags[productionId];
  const suggestions = desk?.state.suggestions[productionId];
  return useMemo(() => {
    if (!dossier || dossier.stage !== 'article') return undefined;
    const located = locateFlags(flags ?? [], body);
    const backing = [
      ...(bank ?? []).filter((quote) => quote.verified).map((quote) => quote.text),
      ...dossier.sources.filter((source) => source.state === 'accepted').map((source) => source.excerpt),
    ];
    const quoting = quotesCheck(quotes, backing);
    return {
      dossier,
      flags: located,
      suggestions: (suggestions ?? []).filter((item) => item.state !== 'pending' || placeable(item, body)),
      checks: [quoting.check, ...(located.length > 0 ? [evidenceCheck(located)] : NO_CHECKS)],
      decorations: pendingFlags(located).flatMap((flag) => (flag.range ? [{ range: flag.range, state: 'missing' as const }] : [])),
      replaces: REPLACES,
      quoteDecorations: quoting.decorations,
    };
  }, [bank, body, dossier, flags, quotes, suggestions]);
}
