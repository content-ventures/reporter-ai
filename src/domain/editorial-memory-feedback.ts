import type { MemoryCheckRef, MemoryEvidenceRef, MemoryQuery } from './editorial-memory.ts';
import type { SourceVersionRef } from './refs.ts';

export type MemoryFeedbackKind = 'correction' | 'rejection' | 'conflict_resolution' | 'relevance';
/** Editorial outcomes are observations, never automatic truth labels or factual confidence. */
export type MemoryFeedback = {
  id: string; workspaceId: string; kind: MemoryFeedbackKind; action: string;
  target: { kind: 'evidence' | 'material'; id: string }; before: MemoryEvidenceRef | null; after: MemoryEvidenceRef | null;
  related: MemoryEvidenceRef[]; source: SourceVersionRef | null; previousSource: SourceVersionRef | null;
  check: MemoryCheckRef | null; policyRevision: number | null; decisionId: string | null;
  selection: { id: string; revision: number } | null; productionId: string | null;
  query: Omit<MemoryQuery, 'cursor' | 'limit'> | null; rating: 'useful' | 'not_useful' | null; resolution: string | null;
  reason: string; personId: string; at: string;
};
export type MemoryFeedbackQuery = { kind?: MemoryFeedbackKind; evidenceId?: string; materialId?: string; cursor?: string; limit?: number };
export type MemoryRelevanceInput = { selection: { id: string; revision: number }; evidence: MemoryEvidenceRef; rating: 'useful' | 'not_useful'; reason: string };
