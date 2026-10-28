import type { MemoryCheck, MemoryDecision, MemoryDecisionInput, MemoryEvidence, MemoryEvidenceRef, MemoryEvidenceView,
  MemoryMaterial, MemoryMetadata, MemoryNumericValue, MemoryPage, MemoryPolicy, MemoryProcessingStatus, MemoryQuery, MemorySelection, MemoryStatistic, MemoryUse } from '../domain/editorial-memory.ts';

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
export type MemoryDetail = MemoryEvidenceView & { checks: MemoryCheck[]; decisions: MemoryDecision[]; revisions: MemoryEvidence[]; occurrences: MemoryUse[] };
/** Request ids scope idempotency to one workspace and payload; mismatched replay is a conflict. */
export interface EditorialMemory {
  query(input: MemoryQuery): Promise<MemoryPage<MemoryEvidenceView>>;
  detail(id: string): Promise<MemoryDetail>;
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
  policy(): Promise<MemoryPolicy>;
}
