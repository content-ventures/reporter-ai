import type { CheckResult } from './checks.ts';
import { checkable, citationVerdict, effectiveClaims } from './fact-check.ts';
import type { CitationVerdict, FactCheck } from './fact-check.ts';
import { quoteMatches } from './quotes.ts';
import type { TextRange } from './refs.ts';
import { foldForMatch } from './text/normalize.ts';

/**
 * "Veracidade das falas" in the studio's Checagem: the fact check of the article's quotations,
 * read from the citation bank. A disputed quotation warns and points at it, and so does one no
 * source could validate; neither blocks sending, because the editor decides (context, a
 * counterpoint, another quote).
 */
export const VERACITY_CHECK_ID = 'article.veracity';

export function veracityCheck(quotes: readonly { range: TextRange; text: string }[],
  citations: readonly { text: string; factCheck?: FactCheck }[]): CheckResult | undefined {
  const found = quotes.flatMap((quote) => {
    // The citation of these very words; else the shortest one containing them (never a longer passage first).
    const folded = foldForMatch(quote.text);
    const citation = citations.find((candidate) => foldForMatch(candidate.text) === folded)
      ?? citations.filter((candidate) => quoteMatches(quote.text, foldForMatch(candidate.text)))
        .sort((a, b) => a.text.length - b.text.length)[0];
    return citation ? [{ range: quote.range, verdict: citationVerdict(citation.factCheck), check: citation.factCheck }] : [];
  });
  if (!found.length) return undefined;
  const count = (verdict: CitationVerdict) => found.filter((entry) => entry.verdict === verdict).length;
  const disputed = found.filter((entry) => entry.verdict === 'disputed');
  const unvalidated = found.filter((entry) => entry.verdict === 'not_validated');
  const pending = count('pending');
  // Opinions and forecasts have nothing to search: they count as settled, not as validated facts.
  const settled = count('validated') + count('not_checkable');
  const claims = found.flatMap((entry) => (entry.check ? effectiveClaims(entry.check).filter((claim) => checkable(claim.kind)) : []));
  const validated = claims.filter((claim) => claim.verdict === 'validated').length;
  const base = { id: VERACITY_CHECK_ID, label: 'Veracidade das falas', blocking: false, progress: { current: settled, total: found.length } };
  if (disputed.length) return { ...base, status: 'warn', detail: `${disputed.length} ${disputed.length === 1 ? 'fala contestada' : 'falas contestadas'}`,
    targets: disputed.map((entry) => entry.range) };
  if (unvalidated.length) return { ...base, status: 'warn', detail: `${unvalidated.length} ${unvalidated.length === 1 ? 'fala não validada' : 'falas não validadas'}`,
    targets: unvalidated.map((entry) => entry.range) };
  if (pending) return { ...base, status: 'info', detail: `${pending} ${pending === 1 ? 'fala aguardando' : 'falas aguardando'} checagem` };
  return { ...base, status: settled === found.length ? 'pass' : 'info',
    detail: claims.length ? `${validated} de ${claims.length} ${claims.length === 1 ? 'afirmação validada' : 'afirmações validadas'}` : 'Só opiniões e previsões' };
}
