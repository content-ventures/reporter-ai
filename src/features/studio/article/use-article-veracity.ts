'use client';

import { useEffect, useMemo, useState } from 'react';
import { foldForMatch, quoteMatches, type CheckResult, type TextRange } from '@/domain';
import type { CitationView } from '@/domain/citation-library';
import { veracityCheck } from '@/domain/veracity-check';
import { useRuntime } from '@/state';

/** Background checks finish after the article: look again this often while a quotation waits. */
const RECHECK_MS = 20000, RECHECKS = 8;

/**
 * "Veracidade das falas" for the studio: the fact checks of this production's citations, matched
 * to the quotations of the text. Read when the studio opens and when a generation ends; a build
 * without the citation library (the preview) has no row.
 */
export function useArticleVeracity(productionId: string, quotes: readonly { range: TextRange; text: string }[], generating: boolean): CheckResult | undefined {
  const port = useRuntime().runtime?.citations;
  const [citations, setCitations] = useState<CitationView[]>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!port || generating) return undefined;
    let live = true;
    void port.get().then((view) => {
      if (live) setCitations(view.items.filter((item) => item.productionId === productionId));
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [port, productionId, generating, round]);
  const waiting = useMemo(() => Boolean(citations?.some((citation) => !citation.factCheck
    && quotes.some((quote) => quoteMatches(quote.text, foldForMatch(citation.text))))), [citations, quotes]);
  useEffect(() => {
    if (!waiting || round >= RECHECKS) return undefined;
    const timer = setTimeout(() => setRound((value) => value + 1), RECHECK_MS);
    return () => clearTimeout(timer);
  }, [waiting, round]);
  return useMemo(() => (citations ? veracityCheck(quotes, citations) : undefined), [citations, quotes]);
}
