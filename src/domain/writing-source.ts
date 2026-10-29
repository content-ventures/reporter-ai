import { segmentRef } from './refs.ts';
import type { SourceRef } from './refs.ts';
import { currentSourceVersion, writingSources } from './source.ts';
import type { Source } from './source.ts';
import { contentHash } from './text/hash.ts';
import { memorySourceSegment } from './editorial-memory-excerpt.ts';
import type { MemorySourceBinding } from './editorial-memory.ts';

type BoundItem = MemorySourceBinding['items'][number];
export type WritingMemoryContext = Pick<BoundItem, 'kind' | 'materialId' | 'selected' | 'metadata' | 'market' | 'marketContext'> & { origin: Omit<BoundItem['anchor'], 'excerpt'> };
export type WritingSourceCandidate = { key: string; text: string; speaker?: string; ref: SourceRef; memory?: WritingMemoryContext };

export function writingMemoryContext(binding: BoundItem): WritingMemoryContext {
  return { kind: binding.kind, materialId: binding.materialId, selected: structuredClone(binding.selected), metadata: structuredClone(binding.metadata),
    ...(binding.market ? { market: structuredClone(binding.market) } : {}),
    ...(binding.marketContext ? { marketContext: structuredClone(binding.marketContext) } : {}),
    origin: { source: { ...binding.anchor.source }, spans: structuredClone(binding.anchor.spans) } };
}

/** Complete original turns, including questions and qualifiers; no editorial reduction. */
export function writingSourceCandidates(sources: readonly Source[]): WritingSourceCandidate[] {
  return writingSources(sources).filter(source => !source.research).flatMap(source => {
    const version = currentSourceVersion(source);
    return version.content.segments.filter(segment => segment.text.trim()).flatMap(segment => {
      const binding = memorySourceSegment(source, version.number, segment.id);
      if (source.memory && !binding) return [];
      const ref = segmentRef(source.id, version.number, segment.id);
      return [{ key: 'source-' + contentHash(ref), text: segment.text, ...(segment.speaker && binding?.kind !== 'statistic' ? { speaker: segment.speaker } : {}), ref,
        ...(binding ? { memory: writingMemoryContext(binding) } : {}) }];
    });
  });
}
