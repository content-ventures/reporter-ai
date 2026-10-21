import type { ArticleBody } from './article.ts';
import { articleContractFor } from './formats.ts';
import type { Piece } from './piece.ts';
import type { ProductionRecord } from './record.ts';
import { writingArticleLimits } from './writing-checks.ts';

/** Follow the version that supplied this text, never the workspace's current configuration. */
export function articleMinimumQuotesFor(record: ProductionRecord, piece: Piece, body: ArticleBody = piece.draft.body as ArticleBody): number | undefined {
  const versions = record.versions.filter(version => version.pieceId === piece.id);
  let version = body === piece.draft.body ? undefined : versions.find(candidate => candidate.body === body);
  version ??= versions.find(candidate => candidate.id === piece.draft.basedOn);
  const visited = new Set<string>();
  while (version && !visited.has(version.id)) {
    visited.add(version.id);
    // A fresh legacy generation starts a new policy lineage even if older text used orchestration.
    if (version.origin === 'generation') {
      const runId = version.runId;
      const minimum = record.runs.find(run => run.id === runId)?.articlePolicy?.minimumQuotes;
      return minimum !== undefined && Number.isInteger(minimum) && minimum >= 0 && minimum <= 5 ? minimum : undefined;
    }
    const parent = version.restoredFrom ?? version.basedOn;
    version = versions.find(candidate => candidate.id === parent);
  }
}

export function articleGateForPiece(record: ProductionRecord, piece: Piece, body: ArticleBody = piece.draft.body as ArticleBody) {
  return writingArticleLimits(record.production.brief, articleMinimumQuotesFor(record, piece, body));
}

export function articleContractForPiece(record: ProductionRecord, piece: Piece, body: ArticleBody = piece.draft.body as ArticleBody) {
  const minimumQuotes = articleMinimumQuotesFor(record, piece, body);
  return { ...articleContractFor(record.production.brief), ...(minimumQuotes === undefined ? {} : { minQuotes: minimumQuotes }) };
}
