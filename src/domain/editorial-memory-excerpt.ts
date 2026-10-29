import type { MemorySourceBinding } from './editorial-memory.ts';
import { segmentRef, type SourceRef } from './refs.ts';
import { currentSourceVersion, sourceContentHash, type Source } from './source.ts';

export type SourceExcerptSelection = { segmentId: string; start: number; end: number; text: string };
export type MemoryWritingExcerpt = SourceExcerptSelection & { kind: 'citation' | 'statistic'; ref: SourceRef };

/** Resolve the immutable collection entry, including historical reading, without a latest fallback. */
export function memorySourceSegment(source: Source, number: number, segmentId: string): MemorySourceBinding['items'][number] | undefined {
  const version = source.versions.find(version => version.number === number);
  const receipt = source.memory?.find(receipt => receipt.version.number === number && receipt.version.hash === version?.hash);
  if (!version || !receipt || receipt.retired || sourceContentHash(version.content) !== version.hash) return undefined;
  const segment = version.content.segments.find(segment => segment.id === segmentId);
  const binding = receipt.items.find(item => item.segmentId === segmentId);
  return segment && binding && segment.text === binding.anchor.excerpt ? binding : undefined;
}

/** Statistics always carry the full contextual datum; citation fragments retain exact UTF-16 offsets. */
export function memoryWritingExcerpt(source: Source, number: number, selected: SourceExcerptSelection): MemoryWritingExcerpt | undefined {
  if (!source.rights.authorized || currentSourceVersion(source).number !== number) return undefined;
  const binding = memorySourceSegment(source, number, selected.segmentId);
  if (!binding) return undefined;
  const text = binding.anchor.excerpt, { start, end } = selected;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length
    || text.slice(start, end) !== selected.text || !selected.text.trim()) return undefined;
  const from = binding.kind === 'statistic' ? 0 : start, to = binding.kind === 'statistic' ? text.length : end;
  return { kind: binding.kind, segmentId: selected.segmentId, start: from, end: to, text: text.slice(from, to),
    ref: segmentRef(source.id, number, selected.segmentId, { from, to }) };
}
