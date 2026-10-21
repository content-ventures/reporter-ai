'use client';

import { useEffect, useMemo, useState } from 'react';
import { foldForMatch, quoteMatches, type CheckResult, type TextRange } from '@/domain';
import type { CitationView } from '@/domain/citation-library';
import { veracityCheck } from '@/domain/veracity-check';
import { useRuntime } from '@/state';

/**
 * Background checks run after the text (and after its images): look again this often while a
 * quotation waits, for up to ten minutes after each generation. The read is one production's.
 */
const RECHECK_MS = 20000, RECHECKS = 30;

/**
 * "Veracidade das falas" for the studio: the fact checks of this production's citations, matched
 * to the quotations of the text. Read when the studio opens and when a generation ends, scoped to
 * this production; a build without the citation library (the preview) has no row.
 */
export function useArticleVeracity(productionId: string, quotes: readonly { range: TextRange; text: string }[], generating: boolean): CheckResult | undefined {
  const port = useRuntime().runtime?.citations;
  const [citations, setCitations] = useState<CitationView[]>();
  // Re-reads since the last generation ended; a new generation starts the count again.
  const [poll, setPoll] = useState({ generating, round: 0 });
  if (poll.generating !== generating) setPoll({ generating, round: 0 });
  const round = poll.round;
  useEffect(() => {
    if (!port || generating) return undefined;
    let live = true;
    void port.forProduction(productionId).then((view) => {
      // Quotes without their person are never checked now: one already checked still counts, one
      // never checked would wait forever.
      if (live) setCitations(view.items.filter((item) => item.personId || item.factCheck));
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [port, productionId, generating, round]);
  const waiting = useMemo(() => Boolean(citations?.some((citation) => !citation.factCheck
    && quotes.some((quote) => quoteMatches(quote.text, foldForMatch(citation.text))))), [citations, quotes]);
  useEffect(() => {
    if (generating || !waiting || round >= RECHECKS) return undefined;
    const timer = setTimeout(() => setPoll((value) => ({ ...value, round: value.round + 1 })), RECHECK_MS);
    return () => clearTimeout(timer);
  }, [generating, waiting, round]);
  return useMemo(() => (citations ? veracityCheck(quotes, citations) : undefined), [citations, quotes]);
}
