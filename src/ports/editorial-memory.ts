import type { MemoryCheck, MemoryDecision, MemoryDecisionInput, MemoryEvidence, MemoryEvidenceRef, MemoryEvidenceView,
  MemoryArticleOrigin, MemoryBlock, MemoryEvidenceChoice, MemoryHistoryKind, MemoryMaterial, MemoryMetadata, MemoryNumericValue, MemoryPage, MemoryPolicy, MemoryProcessingStatus, MemoryQuery, MemoryReplacement, MemorySelection, MemorySourceBinding, MemoryStatistic, MemoryUse } from '../domain/editorial-memory.ts';
import type { SourceVersionRef } from '../domain/refs.ts';
import type { Source, TranscriptSegment } from '../domain/source.ts';
import type { Piece, Version } from '../domain/piece.ts';
import type { MemoryArticlePosition, MemoryArticleReport, MemoryLegacyReport } from '../domain/editorial-memory-legacy.ts';
import type { BriefInput } from './production-commands.ts';
import type { MemoryWritingIssueCode } from '../domain/editorial-memory-guard.ts';
import type { MemoryRefreshConcern } from '../domain/editorial-memory-refresh.ts';
import type { MemoryFeedback, MemoryFeedbackQuery, MemoryRelevanceInput } from '../domain/editorial-memory-feedback.ts';
import type { MemoryCalibrationCase, MemoryCalibrationCaseInput } from '../domain/editorial-memory-calibration.ts';
import type { MemoryPolicyProposal, MemoryPolicyProposalInput } from '../domain/editorial-memory-policy.ts';
import type { MemoryPolicyReassessment, MemoryPolicyReassessmentInput } from '../domain/editorial-memory-reassessment.ts';
import type { MemoryOriginalFile } from '../domain/editorial-memory-original-file.ts';
import type { MemoryDocumentDelimiter } from '../domain/editorial-memory-document.ts';
import type { MemoryBatchLibrary } from './editorial-memory-batch.ts';

export type MemoryWritingInput = { baseRevision: number } & (
  | { title: string; brief: BriefInput }
  | { target: { productionId: string; updatedAt: string } }
);
export type MemoryWritingResult = { productionId: string; pieceId: string; sourceId: string };
export type MemorySelectedContextInput = { sourceId: string; sourceVersion: number; segmentId: string };
export type MemorySelectedContext = {
  productionId: string; collection: SourceVersionRef; segmentId: string; binding: MemorySourceBinding['items'][number];
  selection: Pick<MemorySelection, 'id' | 'revision' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>; snapshot: string;
  evidence: MemoryEvidence; material: MemoryMaterial; policy: MemoryPolicy; check: MemoryCheck | null; decision: MemoryDecision | null;
  checkRestricted: boolean; decisionRestricted: boolean;
  original: { ref: SourceVersionRef; authorized: boolean; before: string; excerpt: string; after: string };
  current: { evidence: MemoryEvidenceRef; matchesSelection: boolean; usable: boolean }; readOnly: boolean;
};
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
  draft: { pieceId: string; revision: number; hash: string } | null;
  draftIssues: { source: Omit<SourceVersionRef, 'hash'> & { hash: string | null }; blockId: string; code: MemoryWritingIssueCode; message: string }[];
};

export type MemoryImportInput = {
  title: string; kind: MemoryMaterial['kind']; text: string; metadata: MemoryMetadata; authorized: boolean;
  primaryOrigin: string | null; originalFileId: string | null;
};
export type MemoryOriginalUploadInput = { name: string; bytes: Uint8Array; delimiter?: MemoryDocumentDelimiter };
export type MemoryFileImportInput = Omit<MemoryImportInput, 'text' | 'originalFileId'> & { originalFileId: string };
export type MemoryMaterialRevisionInput = { baseRevision: number; source: MemoryMaterial['source']; text: string; reason: string };
export type MemoryMaterialRevisionResult = { material: MemoryMaterial; job: MemoryJob; affectedEvidence: number };
export type MemoryImpactScope = { kind: 'material' | 'evidence'; id: string };
/** Advisory references to changed/withdrawn evidence; ordinary writing gates still recheck every proof. */
export type MemoryImpactTarget =
  | { kind: 'selection'; id: string; revision: number; productionId: string | null; totalEvidence: number; changedEvidence: number; updatedAt: string }
  | { kind: 'production'; id: string; title: string; updatedAt: string; selectedEvidence: number; draftEvidence: number };
export type MemoryCorrectionImpact = MemoryPage<MemoryImpactTarget> & { scope: MemoryImpactScope; currentRevision: number; materialId: string };
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
export type MemoryRelevanceContext = { selection: MemoryRelevanceInput['selection']; item: MemorySelection['items'][number]; evidence: MemoryEvidence;
  source: SourceVersionRef; material: { id: string; title: string }; productionId: string | null; productionTitle: string | null };
export type MemoryReplacementInput = { expected: MemoryEvidenceRef; replacement: MemoryEvidenceRef; reason: string };
export type MemoryReplacementResult = { previous: MemoryEvidenceView; current: MemoryEvidenceView; relation: MemoryReplacement };
export type MemoryReplacementComparison = { relation: MemoryReplacement; previous: MemoryEvidence; current: MemoryEvidence; materials: { previous: string; current: string } };
export type MemoryHistoryEntry = MemoryCheck | MemoryDecision | MemoryEvidence | MemoryUse;
export type MemoryDetail = Omit<MemoryEvidenceView, 'material'> & { material: MemoryMaterial; policy: MemoryPolicy;
  source: { ref: SourceVersionRef; authorized: boolean; segments: TranscriptSegment[] };
  replacements?: { previous: MemoryReplacement | null; next: MemoryReplacement | null };
  policyReassessment?: MemoryPolicyReassessment | null;
  checkJob?: MemoryJob | null; checks: MemoryPage<MemoryCheck>; decisions: MemoryPage<MemoryDecision>; revisions: MemoryPage<MemoryEvidence>; occurrences: MemoryPage<MemoryUse> };
/** Request ids scope idempotency to one workspace and payload; mismatched replay is a conflict. */
export interface EditorialMemory extends MemoryBatchLibrary {
  query(input: MemoryQuery): Promise<MemoryPage<MemoryEvidenceView>>;
  detail(id: string): Promise<MemoryDetail>;
  history(id: string, kind: MemoryHistoryKind, input: MemoryHistoryQuery): Promise<MemoryPage<MemoryHistoryEntry>>;
  materials(input: { cursor?: string; limit?: number }): Promise<MemoryPage<MemoryMaterial & { job: MemoryJob | null }>>;
  material(id: string, revision?: number): Promise<{ material: MemoryMaterial; source: Source; job: MemoryJob | null }>;
  import(input: MemoryImportInput, requestId: string): Promise<{ material: MemoryMaterial; job: MemoryJob }>;
  uploadOriginal(input: MemoryOriginalUploadInput, requestId: string): Promise<MemoryOriginalFile>;
  importFile(input: MemoryFileImportInput, requestId: string): Promise<{ material: MemoryMaterial; job: MemoryJob }>;
  /** Fresh authorized bytes for a rendered DS download anchor; never a public storage URL. */
  downloadOriginal(id: string): Promise<{ name: string; href: string }>;
  authorizeMaterial(id: string, input: { baseRevision: number; authorized: boolean; reason: string }, requestId: string): Promise<MemoryMaterial>;
  job(id: string): Promise<MemoryJob>;
  blocks(jobId: string, input: MemoryHistoryQuery): Promise<MemoryPage<MemoryBlock>>;
  retry(jobId: string, requestId: string): Promise<MemoryJob>;
  cancel(jobId: string, baseRevision: number, requestId: string): Promise<MemoryJob>;
  review(id: string, input: MemoryDecisionInput, requestId: string): Promise<MemoryDecision>;
  check(id: string, expected: MemoryEvidenceRef, requestId: string): Promise<MemoryJob>;
  reassessPolicy(id: string, input: MemoryPolicyReassessmentInput, requestId: string): Promise<MemoryCheck>;
  correct(id: string, input: { expected: MemoryEvidenceRef; reason: string; changes: MemoryCorrection }, requestId: string): Promise<MemoryEvidenceView>;
  reviseMaterial(id: string, input: MemoryMaterialRevisionInput, requestId: string): Promise<MemoryMaterialRevisionResult>;
  correctionImpact(scope: MemoryImpactScope, input: MemoryHistoryQuery): Promise<MemoryCorrectionImpact>;
  replace(id: string, input: MemoryReplacementInput, requestId: string): Promise<MemoryReplacementResult>;
  replacement(id: string): Promise<MemoryReplacementComparison>;
  select(input: { id?: string; baseRevision: number; productionId: string | null; evidence: MemoryEvidenceChoice[] }, requestId: string): Promise<MemorySelection>;
  selection(id: string): Promise<MemorySelection>;
  selections(input: MemoryHistoryQuery): Promise<MemoryPage<MemorySelection>>;
  writeSelection(id: string, input: MemoryWritingInput, requestId: string): Promise<MemoryWritingResult>;
  refreshSource(id: string, input: MemorySourceRefreshInput, requestId: string): Promise<MemorySourceRefreshResult>;
  writingStatus(productionId: string): Promise<MemoryWritingStatus>;
  selectedContext(productionId: string, input: MemorySelectedContextInput): Promise<MemorySelectedContext>;
  policy(): Promise<MemoryPolicy>;
  calibrationCases(input: MemoryHistoryQuery): Promise<MemoryPage<MemoryCalibrationCase>>;
  annotateCalibration(input: MemoryCalibrationCaseInput, requestId: string): Promise<MemoryCalibrationCase>;
  policyProposals(input: MemoryHistoryQuery): Promise<MemoryPage<MemoryPolicyProposal>>;
  policyProposal(id: string): Promise<MemoryPolicyProposal>;
  proposePolicy(input: MemoryPolicyProposalInput, requestId: string): Promise<MemoryPolicyProposal>;
  restorePolicy(input: { baseRevision: number; targetRevision: number; reason: string }, requestId: string): Promise<MemoryPolicyProposal>;
  activatePolicy(id: string, input: { baseRevision: number; reason: string }, requestId: string): Promise<MemoryPolicy>;
  policyVersions(input: MemoryHistoryQuery): Promise<MemoryPage<MemoryPolicy>>;
  feedback(input: MemoryFeedbackQuery): Promise<MemoryPage<MemoryFeedback>>;
  rateRelevance(input: MemoryRelevanceInput, requestId: string): Promise<MemoryFeedback>;
  relevanceContext(input: Pick<MemoryRelevanceInput, 'selection' | 'evidence'>): Promise<MemoryRelevanceContext>;
  lookupLegacy(id: string): Promise<{ id: string; materialId: string }[]>;
  originalArticle(id: string, snapshot?: string): Promise<{ origin: MemoryArticleOrigin; doc: Piece | Version; importedBy: string; importedAt: string }>;
  reconcileLegacy(input: { after?: string | null; limit?: number }, requestId: string): Promise<MemoryLegacyReport>;
  reconcileArticles(input: { after?: MemoryArticlePosition | null; limit?: number }, requestId: string): Promise<MemoryArticleReport>;
  resolveLegacy(id: string, input: { expected: MemoryEvidenceRef; legacyHash: string; choice: 'keep_bank' | 'apply_legacy'; reason: string }, requestId: string): Promise<MemoryEvidenceView>;
  resolveDuplicate(id: string, input: { expected: MemoryEvidenceRef; canonical: MemoryEvidenceRef; choice: 'keep_variant' | 'use_curated'; reason: string },
    requestId: string): Promise<MemoryEvidenceView>;
}
/** Available library operations; processing capabilities join this port when their workers ship. */
export type MemoryLibrary = EditorialMemory;
