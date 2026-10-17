import 'server-only';
import type { ProductionRecord } from '../domain/record.ts';
import { activeRun, pendingReview } from '../domain/record.ts';
import { contentHash } from '../domain/text/hash.ts';
import type { ArticleImageTask } from '../ports/connected-workspace.ts';

/** The full body includes review flags and image choices, not just its plain-text hash. */
export function articleImageTarget(record: ProductionRecord, pieceId: string): ArticleImageTask | undefined {
  const piece = record.pieces.find(piece => piece.id === pieceId);
  if (!piece?.draft.basedOn || piece.draft.body.type !== 'article') return undefined;
  return { status: 'queued',revision: piece.draft.revision,basedOn: piece.draft.basedOn,
    hash: contentHash(piece.draft.body),attempts: 0 };
}

/** An approval, restore, new generation, review flag or manual image choice makes it obsolete. */
export function articleImageTargetMatches(record: ProductionRecord, pieceId: string, target: ArticleImageTask): boolean {
  const piece = record.pieces.find(piece => piece.id === pieceId);
  return Boolean(!record.production.archivedAt && piece?.draft.body.type === 'article'
    && piece.draft.revision === target.revision && piece.draft.basedOn === target.basedOn
    && contentHash(piece.draft.body) === target.hash && !activeRun(record,pieceId) && !pendingReview(record,pieceId)
    && !record.decisions.some(decision => decision.subject.kind === 'version' && decision.subject.versionId === target.basedOn));
}
