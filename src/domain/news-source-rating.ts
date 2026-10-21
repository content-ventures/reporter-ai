/** An editor's assessment of a publication for this portal, independent of feed activity or audience. */
export type SourceTier = 'A1' | 'A2' | 'B' | 'C';
export type SourceRelevance = 'high' | 'medium' | 'low';
export type SourceRatingInput = { tier: SourceTier; relevance: SourceRelevance; rationale: string };
export type SourceRating = SourceRatingInput & { updatedAt: string };

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  A1: 'Referência', A2: 'Especializada', B: 'Complementar', C: 'Monitoramento',
};
export const SOURCE_RELEVANCE_LABELS: Record<SourceRelevance, string> = {
  high: 'Alta', medium: 'Média', low: 'Baixa',
};
export const SOURCE_TIER_DESCRIPTIONS: Record<SourceTier, string> = {
  A1: 'Referência editorial para apuração e acompanhamento do setor.',
  A2: 'Cobertura especializada que sustenta pautas do setor.',
  B: 'Acrescenta contexto e perspectivas à apuração.',
  C: 'Ajuda a identificar assuntos que exigem apuração adicional.',
};

/** Ascending order places the strongest assessed publications first and unassessed ones last. */
export function sourceRatingRank(rating?: Pick<SourceRating, 'tier'>): number {
  return rating ? { A1: 0, A2: 1, B: 2, C: 3 }[rating.tier] : 4;
}

/** Alerts and keyword feeds combine publications and cannot inherit a publication's rating. */
export function isRateableNewsSource(source: { kind?: string; keyword?: string }): boolean {
  return source.kind !== 'google-alerts' && !source.keyword?.trim();
}
