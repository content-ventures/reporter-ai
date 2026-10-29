import type { MemoryDocumentDelimiter, MemoryDocumentFormat } from './editorial-memory-document.ts';

/** File identity is distinct from a material, source version, historical edition or use. */
export type MemoryOriginalFile = {
  id: string; workspaceId: string; name: string; size: number; checksum: string;
  format: MemoryDocumentFormat; delimiter: MemoryDocumentDelimiter | null;
  parserVersion: 'memory-document-v1'; storage: 'local' | 's3';
  createdBy: string; createdAt: string;
  status: 'pending' | 'stored'; storedBy: string | null; storedAt: string | null;
};
