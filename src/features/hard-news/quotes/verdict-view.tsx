'use client';

import { Badge, Meter, SourceChip, type ChartColor, type MeterTone, type Tone } from '@content-ventures/design-system/v3';
import { CLAIM_VERDICT_LABELS, VERDICT_LABELS } from '@/domain/fact-check';
import type { CitationScore, CitationVerdict, ClaimKind, ClaimVerdict, FactSource } from '@/domain/fact-check';
import { REVIEW_BELOW } from './quote-model';
import type { RankedQuote } from './quote-model';

/** Validated is "ok", not validated asks attention, disputed is a loss; the rest is parked. */
export const VERDICT_TONE: Record<CitationVerdict, Tone> = { validated: 'green', not_validated: 'amber', disputed: 'red', not_checkable: 'gray', pending: 'gray' };
export const VERDICT_COLOR: Record<CitationVerdict, ChartColor> = { validated: 'green', not_validated: 'amber', disputed: 'red', not_checkable: 'gray', pending: 'neutral' };
/** Kinds are series, not states. */
export const KIND_COLOR: Record<ClaimKind, ChartColor> = { fact: 'blue', declared: 'sky', opinion: 'violet', forecast: 'pink' };

export function VerdictBadge({ verdict }: { verdict: CitationVerdict }) {
  return <Badge tone={VERDICT_TONE[verdict]} variant="soft" size="sm" dot={verdict !== 'pending'}>{VERDICT_LABELS[verdict]}</Badge>;
}

/** A quote's seal: "Sugerida" while an outline passage waits for a person, then its verdict. */
export function QuoteSeal({ entry }: { entry: RankedQuote }) {
  return entry.quote.suggested ? <Badge tone="violet" variant="soft" size="sm">Sugerida</Badge> : <VerdictBadge verdict={entry.verdict} />;
}

export function ClaimVerdictBadge({ verdict }: { verdict: ClaimVerdict }) {
  return <Badge tone={VERDICT_TONE[verdict]} variant="soft" size="sm" dot>{CLAIM_VERDICT_LABELS[verdict]}</Badge>;
}

export function scoreTone(score: CitationScore): MeterTone {
  return score.capped ? 'red' : score.total < REVIEW_BELOW ? 'amber' : 'neutral';
}

/** The 0–100 score as the table-cell bar with its number; unchecked quotes have none. */
export function ScoreMeter({ score }: { score: CitationScore }) {
  return <Meter value={score.total} label={`Score ${score.total} de 100`} tone={scoreTone(score)} inline />;
}

function dayOf(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
}

/** A web source of a claim: site, date and the excerpt that was judged, opening the page. */
export function FactSourceChip({ source, compact = false }: { source: FactSource; compact?: boolean }) {
  return (
    <SourceChip
      kind="url"
      label={source.site}
      {...(source.publishedOn && !compact ? { meta: dayOf(source.publishedOn) } : {})}
      preview={`${source.title} — ${source.excerpt}`}
      onOpen={() => window.open(source.url, '_blank', 'noopener,noreferrer')}
    />
  );
}
