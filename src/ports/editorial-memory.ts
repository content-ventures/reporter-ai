import type { MemoryCheck, MemoryDecision, MemoryDecisionInput, MemoryEvidence, MemoryEvidenceRef, MemoryEvidenceView,
  MemoryArticleOrigin, MemoryBlock, MemoryHistoryKind, MemoryMaterial, MemoryMetadata, MemoryNumericValue, MemoryPage, MemoryPolicy, MemoryProcessingStatus, MemoryQuery, MemorySelection, MemoryStatistic, MemoryUse } from '../domain/editorial-memory.ts';
import type { SourceVersionRef } from '../domain/refs.ts';
import type { Source, TranscriptSegment } from '../domain/source.ts';
import type { Piece, Version } from '../domain/piece.ts';
import type { MemoryArticlePosition, MemoryArticleReport, MemoryLegacyReport } from '../domain/editorial-memory-legacy.ts';
import type { BriefInput } from './production-commands.ts';
import type { MemoryWritingIssueCode } from '../domain/editorial-memory-guard.ts';
import type { MemoryRefreshConcern } from '../domain/editorial-memory-refresh.ts';

export type MemoryWritingInput = { baseRevision: number } & (
  | { title: string; brief: BriefInput }
  | { target: { productionId: string; updatedAt: string } }
);
export type MemoryWritingResult = { productionId: string; pieceId: string; sourceId: string };
export type MemorySourceRefreshInput = {
  target: { productionId: string; updatedAt: string; draftRevision: number }; expected: SourceVersionRef;
  selection: { id: string; revision: number } | null; updateDraftReferences: boolean; reason: string;
};
export type MemorySourceRefreshResult = {
  productionId: string; pieceId: string; source: SourceVersionRef; selection: { id: string; revision: number } | null;
  draftRevision: number; updatedReferences: number; concerns: MemoryRefreshConcern[]; retired: boolean;
};
/** Advisory read of current bank gates; generation still rechecks inside its own transaction. */
export type MemoryWritingStatus = {
  productionId: string; updatedAt: string; checkedAt: string; sources: SourceVersionRef[];
  issues: { source: SourceVersionRef; code: MemoryWritingIssueCode; message: string }[];
};

export type MemoryImportInput = {
  title: string; kind: MemoryMaterial['kind']; text: string; metadata: MemoryMetadata; authorized: boolean;
  primaryOrigin: string | null; originalFileId: string | null;
};
export type MemoryJob = {
  id: string; workspaceId: string; revision: number; kind: 'extract' | 'check' | 'archive'; materialId: string; evidenceId: string | null;
  sourceVersion: number; sourceHash: string; extractorVersion: string; model?: string; generation: number; status: MemoryProcessingStatus;
  totalBlocks: number; completedBlocks: number; failedBlocks: number; evidenceCount: number;
  checkInput?: { evidence: MemoryEvidenceRef; policyRevision: number; previousCheckRevision: number }; attempts?: number;
  error: string | null; createdBy: string; createdAt: string; updatedAt: string;
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
  checkJob?: MemoryJob | null; checks: MemoryPage<MemoryCheck>; decisions: MemoryPage<MemoryDecision>; revisions: MemoryPage<MemoryEvidence>; occurrences: MemoryPage<MemoryUse> };
/** Request ids scope idempotency to one workspace and payload; mismatched replay is a conflict. */
export interface EditorialMemory {
  query(input: MemoryQuery): Promise<MemoryPage<MemoryEvidenceView>>;
  detail(id: string): Promise<MemoryDetail>;
  history(id: string, kind: MemoryHistoryKind, input: MemoryHistoryQuery): Promise<MemoryPage<MemoryHistoryEntry>>;
  materials(input: { cursor?: string; limit?: number }): Promise<MemoryPage<MemoryMaterial & { job: MemoryJob | null }>>;
  material(id: string): Promise<{ material: MemoryMaterial; source: Source; job: MemoryJob | null }>;
  import(input: MemoryImportInput, requestId: string): Promise<{ material: MemoryMaterial; job: MemoryJob }>;
  authorizeMaterial(id: string, input: { baseRevision: number; authorized: boolean; reason: string }, requestId: string): Promise<MemoryMaterial>;
  job(id: string): Promise<MemoryJob>;
  blocks(jobId: string, input: MemoryHistoryQuery): Promise<MemoryPage<MemoryBlock>>;
  retry(jobId: string, requestId: string): Promise<MemoryJob>;
  cancel(jobId: string, baseRevision: number, requestId: string): Promise<MemoryJob>;
  review(id: string, input: MemoryDecisionInput, requestId: string): Promise<MemoryDecision>;
  check(id: string, expected: MemoryEvidenceRef, requestId: string): Promise<MemoryJob>;
  correct(id: string, input: { expected: MemoryEvidenceRef; reason: string; changes: MemoryCorrection }, requestId: string): Promise<MemoryEvidenceView>;
  reviseMaterial(id: string, input: { baseRevision: number; source: MemoryMaterial['source']; text: string; reason: string },
    requestId: string): Promise<{ material: MemoryMaterial; job: MemoryJob }>;
  select(input: { id?: string; baseRevision: number; productionId: string | null; evidence: MemoryEvidenceRef[] }, requestId: string): Promise<MemorySelection>;
  selection(id: string): Promise<MemorySelection>;
  selections(input: MemoryHistoryQuery): Promise<MemoryPage<MemorySelection>>;
  writeSelection(id: string, input: MemoryWritingInput, requestId: string): Promise<MemoryWritingResult>;
  refreshSource(id: string, input: MemorySourceRefreshInput, requestId: string): Promise<MemorySourceRefreshResult>;
  writingStatus(productionId: string): Promise<MemoryWritingStatus>;
  policy(): Promise<MemoryPolicy>;
  lookupLegacy(id: string): Promise<{ id: string; materialId: string }[]>;
  originalArticle(id: string, snapshot?: string): Promise<{ origin: MemoryArticleOrigin; doc: Piece | Version; importedBy: string; importedAt: string }>;
  reconcileLegacy(input: { after?: string | null; limit?: number }, requestId: string): Promise<MemoryLegacyReport>;
  reconcileArticles(input: { after?: MemoryArticlePosition | null; limit?: number }, requestId: string): Promise<MemoryArticleReport>;
  resolveLegacy(id: string, input: { expected: MemoryEvidenceRef; legacyHash: string; choice: 'keep_bank' | 'apply_legacy'; reason: string }, requestId: string): Promise<MemoryEvidenceView>;
  resolveDuplicate(id: string, input: { expected: MemoryEvidenceRef; canonical: MemoryEvidenceRef; choice: 'keep_variant' | 'use_curated'; reason: string },
    requestId: string): Promise<MemoryEvidenceView>;
}
/** Available library operations; processing capabilities join this port when their workers ship. */
export type MemoryLibrary = Omit<EditorialMemory, 'reviseMaterial'>;
