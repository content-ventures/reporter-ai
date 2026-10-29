import { sameRef, type SourceVersionRef } from '../../../domain/refs.ts';
import type { MemoryWritingStatus } from '../../../ports/editorial-memory.ts';

export type BankWritingSnapshot = { productionId: string; updatedAt: string; sources: SourceVersionRef[];
  draft?: NonNullable<MemoryWritingStatus['draft']>; sourceVersions?: SourceVersionRef[]; draftSources?: { sourceId: string; sourceVersion: number }[] };
export type BankWritingReadiness = { reason: string | null; issue?: MemoryWritingStatus['issues'][number]; draftIssue?: MemoryWritingStatus['draftIssues'][number] };

/** A response for another pauta or source snapshot cannot enable a generation control. */
export function bankWritingReadiness(snapshot: BankWritingSnapshot, status: MemoryWritingStatus | undefined): BankWritingReadiness {
  if (!snapshot.sources.length) return { reason: null };
  if (!status) return { reason: 'Conferindo as evidências do banco.' };
  if (status.productionId !== snapshot.productionId || status.updatedAt !== snapshot.updatedAt
    || status.sources.length !== snapshot.sources.length || snapshot.sources.some(ref => !status.sources.some(actual => sameRef(ref, actual)))
    || status.issues.some(issue => !snapshot.sources.some(ref => sameRef(ref, issue.source)))) {
    return { reason: 'As fontes mudaram. Aguarde a atualização da pauta.' };
  }
  const issue = status.issues[0];
  if (issue) return { reason: issue.message, issue };
  const draft = snapshot.draft;
  const draftIssue = draft && status.draft?.pieceId === draft.pieceId && status.draft.revision === draft.revision && status.draft.hash === draft.hash
    ? status.draftIssues.find(issue => snapshot.sources.some(ref => ref.sourceId === issue.source.sourceId)
      && (issue.source.hash === null ? snapshot.draftSources?.some(ref => ref.sourceId === issue.source.sourceId && ref.sourceVersion === issue.source.sourceVersion)
        : (snapshot.sourceVersions ?? snapshot.sources).some(ref => ref.sourceId === issue.source.sourceId && ref.sourceVersion === issue.source.sourceVersion && ref.hash === issue.source.hash))) : undefined;
  return draftIssue ? { reason: null, draftIssue } : { reason: null };
}
