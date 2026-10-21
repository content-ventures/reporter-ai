import { Badge, MetaList, Tooltip } from '@content-ventures/design-system/v3';
import { SOURCE_RELEVANCE_LABELS, SOURCE_TIER_DESCRIPTIONS, SOURCE_TIER_LABELS } from '@/domain/news-source-rating';
import type { SourceRating } from '@/domain/news-source-rating';

/** The newsroom's source assessment, kept distinct from an article's priority. */
export function SourceRatingBadge({ rating, relevance = false, compact = false }: {
  rating?: SourceRating; relevance?: boolean; compact?: boolean;
}) {
  const tier = rating ? `${rating.tier}${compact ? '' : ` · ${SOURCE_TIER_LABELS[rating.tier]}`}` : 'Não avaliada';
  const detail = rating
    ? `Força editorial da fonte: ${rating.tier} · ${SOURCE_TIER_DESCRIPTIONS[rating.tier]} Relevância para o veículo: ${SOURCE_RELEVANCE_LABELS[rating.relevance]}. ${rating.rationale}`
    : 'A força editorial desta fonte ainda não foi avaliada.';
  const badge = <Tooltip content={detail}><Badge tone="gray" variant="outline" size="sm">{tier}</Badge></Tooltip>;
  return relevance && rating
    ? <MetaList size="sm" items={[badge, `Relevância ${SOURCE_RELEVANCE_LABELS[rating.relevance].toLowerCase()}`]} />
    : badge;
}
