import type { MemoryDocumentDelimiter } from '../domain/editorial-memory-document.ts';
import type { MemoryOriginalFile } from '../domain/editorial-memory-original-file.ts';
import type { MemoryImportInput, MemoryJob } from './editorial-memory.ts';
import type { SourceVersionRef } from '../domain/refs.ts';
import type { MemoryPage } from '../domain/editorial-memory.ts';
import type { MemoryHistoryQuery } from './editorial-memory.ts';

export const MEMORY_BATCH_MAX_ITEMS = 100;
export type MemoryBatchFile = { name: string; size: number; checksum: string | null; delimiter: MemoryDocumentDelimiter | null };
export type MemoryBatchFields = Omit<MemoryImportInput, 'text' | 'originalFileId'>;
export type MemoryBatchIssue = { code: string; message: string; terminal: boolean };
export type MemoryBatchItemInput = { id: string; file: MemoryBatchFile; input: MemoryBatchFields };
export type MemoryBatchCandidate = { id: string; revision: number; source: SourceVersionRef };
export type MemoryBatchItem = MemoryBatchItemInput & {
  position: number; revision: number; status: 'needs_file' | 'uploading' | 'ready' | 'failed' | 'refused' | 'included' | 'existing' | 'pending_review';
  original: MemoryOriginalFile | null; materialId: string | null; candidate: MemoryBatchCandidate | null;
  issue: MemoryBatchIssue | null; job: MemoryJob | null; reason: string | null; updatedBy: string; updatedAt: string;
};
export type MemoryBatch = { id: string; workspaceId: string; title: string; createdBy: string; createdAt: string; updatedAt: string; items: MemoryBatchItem[] };
export type MemoryBatchInput = { title: string; items: MemoryBatchItemInput[] };
export type MemoryBatchSummary = Omit<MemoryBatch, 'items'> & { total: number; resolved: number; pendingReview: number; refused: number };
export type MemoryBatchProcessInput = { revision: number; decision?: { choice: 'reuse' | 'distinct'; expected: MemoryBatchCandidate; reason: string } };
export interface MemoryBatchLibrary {
  batches(input: MemoryHistoryQuery): Promise<MemoryPage<MemoryBatchSummary>>;
  batch(id: string): Promise<MemoryBatch>;
  createBatch(input: MemoryBatchInput, requestId: string): Promise<MemoryBatch>;
  updateBatchItem(batch: string, item: string, input: { revision: number; file: MemoryBatchFile; input: MemoryBatchFields; reason: string }, requestId: string): Promise<MemoryBatch>;
  uploadBatchItem(batch: string, item: string, input: { revision: number; bytes: Uint8Array }, requestId: string): Promise<MemoryBatch>;
  processBatchItem(batch: string, item: string, input: MemoryBatchProcessInput, requestId: string): Promise<MemoryBatch>;
}
