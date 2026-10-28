import type { MemoryBlock, MemoryMaterial, MemoryMetadata } from './editorial-memory.ts';
import type { CommandContext } from './result.ts';
import type { Source } from './source.ts';
import { createTranscriptSource, toSourceVersionRef } from './source.ts';
import { contentHash } from './text/hash.ts';

export const MEMORY_BLOCK_CHARACTERS = 1000;
/** Partition the exact original UTF-16 text without splitting surrogate pairs or trimming whitespace. */
export function memoryBlocks(material: MemoryMaterial, jobId: string, text: string): MemoryBlock[] {
  const blocks: MemoryBlock[] = [];
  for (let from = 0; from < text.length;) {
    let to = Math.min(from + MEMORY_BLOCK_CHARACTERS, text.length);
    if (to < text.length && text.charCodeAt(to - 1) >= 0xd800 && text.charCodeAt(to - 1) <= 0xdbff && text.charCodeAt(to) >= 0xdc00 && text.charCodeAt(to) <= 0xdfff) to--;
    blocks.push({ id: `${jobId}-b${blocks.length}`, workspaceId: material.workspaceId, materialId: material.id, jobId, ordinal: blocks.length,
      anchor: { source: material.source, spans: [{ segmentId: 'original', from, to }], excerpt: text.slice(from, to) },
      status: 'pending', attempts: 0, error: null, evidenceIds: [] });
    from = to;
  }
  return blocks;
}
export function createMemoryMaterial(input: { title: string; kind: MemoryMaterial['kind']; text: string; metadata: MemoryMetadata; authorized: boolean;
  primaryOrigin: string | null; originalFileId: string | null }, workspaceId: string, ctx: CommandContext): { source: Source; material: MemoryMaterial } {
  const source = createTranscriptSource({ workspaceId, title: input.title, origin: 'other', authorized: input.authorized,
    parsed: { format: 'plain', speakers: [], segments: [{ id: 'original', text: input.text }], warnings: [] },
    ...(input.metadata.recordedOn ? { recordedOn: input.metadata.recordedOn } : {}), ...(input.metadata.originalUrl ? { sourceUrl: input.metadata.originalUrl } : {}) }, ctx);
  if (input.kind !== 'transcript') source.kind = 'news';
  return { source, material: { id: ctx.newId('memory-material'), workspaceId, revision: 1, title: input.title, kind: input.kind, source: toSourceVersionRef(source),
    metadata: structuredClone(input.metadata), primaryOrigin: input.primaryOrigin ?? input.metadata.originalUrl ?? `text:${contentHash(input.text)}`,
    originalFileId: input.originalFileId, importedAt: ctx.now, importedBy: ctx.actorId } };
}
