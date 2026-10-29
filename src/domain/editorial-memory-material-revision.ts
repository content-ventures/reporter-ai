import type { MemoryMaterial } from './editorial-memory.ts';
import type { CommandContext } from './result.ts';
import { currentSourceVersion, sourceContentHash, toSourceVersionRef, type Source, type SourceVersion } from './source.ts';

/** Corrected originals append exact text; existing anchors and observations keep their own version. */
export function reviseMemoryMaterial(material: MemoryMaterial, source: Source, text: string, reason: string, ctx: CommandContext) {
  const previous = currentSourceVersion(source);
  if (source.memory || material.workspaceId !== source.workspaceId || material.source.sourceId !== source.id
    || material.source.sourceVersion !== previous.number || material.source.hash !== previous.hash) throw new Error('MEMORY_CONFLICT');
  const content = { type: 'transcript' as const, format: 'plain' as const, segments: [{ id: 'original', text }] };
  const hash = sourceContentHash(content);
  if (hash === previous.hash) throw new Error('MEMORY_NO_CHANGES');
  const version: SourceVersion = { number: previous.number + 1, hash, content, createdAt: ctx.now, createdBy: ctx.actorId, note: reason };
  const nextSource = { ...source, versions: [...source.versions, version] };
  return { source: nextSource, version, material: { ...material, revision: material.revision + 1, source: toSourceVersionRef(nextSource) } };
}
