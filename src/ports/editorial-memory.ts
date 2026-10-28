import type { MemoryCheck, MemoryDecision, MemoryDecisionInput, MemoryEvidence, MemoryEvidenceRef, MemoryEvidenceView,
  MemoryArticleOrigin, MemoryHistoryKind, MemoryMaterial, MemoryMetadata, MemoryNumericValue, MemoryPage, MemoryPolicy, MemoryProcessingStatus, MemoryQuery, MemorySelection, MemoryStatistic, MemoryUse } from '../domain/editorial-memory.ts';
import type { SourceVersionRef } from '../domain/refs.ts';
import type { TranscriptSegment } from '../domain/source.ts';
import type { Piece, Version } from '../domain/piece.ts';
import type { MemoryArticlePosition, MemoryArticleReport, MemoryLegacyReport } from '../domain/editorial-memory-legacy.ts';

export type MemoryImportInput = {
  title: string; kind: MemoryMaterial['kind']; text: string; metadata: MemoryMetadata; authorized: boolean;
  primaryOrigin: string | null; originalFileId: string | null;
};
export type MemoryJob = {
  id: string; revision: number; kind: 'extract' | 'check' | 'archive'; materialId: string; evidenceId: string | null;
  sourceVersion: number; status: MemoryProcessingStatus;
  totalBlocks: number; completedBlocks: number; failedBlocks: number; evidenceCount: number;
  error: string | null; createdAt: string; updatedAt: string;
};
export type MemoryCorrection =
  | { kind: 'citation'; metadata?: Partial<MemoryMetadata>; personId?: string | null; authorConfirmed?: boolean }
  | { kind: 'statistic'; metadata?: Partial<MemoryMetadata>; indicator?: string; value?: MemoryNumericValue; unit?: string;
    period?: MemoryStatistic['period']; geography?: string | null; population?: string | null; qualifier?: string | null;
    issuingInstitution?: string | null; declaringPersonId?: string | null };
export type MemoryHistoryQuery = { cursor?: string; limit?: number };
export type MemoryHistoryEntry = MemoryCheck | MemoryDecision | MemoryEvidence | MemoryUse;
export type MemoryDetail = Omit<MemoryEvidenceView, 'material'> & { material: MemoryMaterial; policy: MemoryPolicy;
  source: { ref: SourceVersionRef; authorized: boolean; segments: TranscriptSegment[] };
  checks: MemoryPage<MemoryCheck>; decisions: MemoryPage<MemoryDecision>; revisions: MemoryPage<MemoryEvidence>; occurrences: MemoryPage<MemoryUse> };
/** Request ids scope idempotency to one workspace and payload; mismatched replay is a conflict. */
export interface EditorialMemory {
  query(input: MemoryQuery): Promise<MemoryPage<MemoryEvidenceView>>;
  detail(id: string): Promise<MemoryDetail>;
  history(id: string, kind: MemoryHistoryKind, input: MemoryHistoryQuery): Promise<MemoryPage<MemoryHistoryEntry>>;
  materials(input: { cursor?: string; limit?: number }): Promise<MemoryPage<MemoryMaterial & { job: MemoryJob | null }>>;
  import(input: MemoryImportInput, requestId: string): Promise<{ material: MemoryMaterial; job: MemoryJob }>;
  job(id: string): Promise<MemoryJob>;
  retry(jobId: string, requestId: string): Promise<MemoryJob>;
  cancel(jobId: string, baseRevision: number, requestId: string): Promise<MemoryJob>;
  review(id: string, input: MemoryDecisionInput, requestId: string): Promise<MemoryDecision>;
  check(id: string, expected: MemoryEvidenceRef, requestId: string): Promise<MemoryJob>;
  correct(id: string, input: { expected: MemoryEvidenceRef; reason: string; changes: MemoryCorrection }, requestId: string): Promise<MemoryEvidenceView>;
  reviseMaterial(id: string, input: { baseRevision: number; source: MemoryMaterial['source']; text: string; reason: string },
    requestId: string): Promise<{ material: MemoryMaterial; job: MemoryJob }>;
  select(input: { id?: string; baseRevision: number; productionId: string | null; evidence: MemoryEvidenceRef[] }, requestId: string): Promise<MemorySelection>;
  selection(id: string): Promise<MemorySelection>;
  policy(): Promise<MemoryPolicy>;
  lookupLegacy(id: string): Promise<{ id: string; materialId: string }[]>;
  originalArticle(id: string, snapshot?: string): Promise<{ origin: MemoryArticleOrigin; doc: Piece | Version; importedBy: string; importedAt: string }>;
  reconcileLegacy(input: { after?: string | null; limit?: number }, requestId: string): Promise<MemoryLegacyReport>;
  reconcileArticles(input: { after?: MemoryArticlePosition | null; limit?: number }, requestId: string): Promise<MemoryArticleReport>;
  resolveLegacy(id: string, input: { expected: MemoryEvidenceRef; legacyHash: string; choice: 'keep_bank' | 'apply_legacy'; reason: string }, requestId: string): Promise<MemoryEvidenceView>;
  resolveDuplicate(id: string, input: { expected: MemoryEvidenceRef; canonical: MemoryEvidenceRef; choice: 'keep_variant' | 'use_curated'; reason: string },
    requestId: string): Promise<MemoryEvidenceView>;
}
