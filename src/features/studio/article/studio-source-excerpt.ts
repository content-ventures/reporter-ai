import { memoryWritingExcerpt, type SourceExcerptSelection } from '../../../domain/editorial-memory-excerpt.ts';
import { segmentRef, type SourceRef } from '../../../domain/refs.ts';
import type { SourceDetail } from '../../../ports/production-queries.ts';

export type StudioExcerptSelection = SourceExcerptSelection & { sourceId?: string; sourceVersion?: number };
export type StudioInsertion = SourceExcerptSelection & { sourceId: string; sourceVersion: number; kind: 'citation' | 'statistic'; ref: SourceRef };

/** Replies carry their own source/version; only a selection in Material uses the open pane. */
export function studioSourceExcerpt(details: readonly SourceDetail[] | undefined, current: SourceDetail | undefined, selected: StudioExcerptSelection): StudioInsertion | undefined {
  const explicit = selected.sourceId !== undefined || selected.sourceVersion !== undefined;
  const source = explicit ? details?.find(detail => detail.source.id === selected.sourceId)?.source : current?.source;
  const number = explicit ? selected.sourceVersion : current?.version.number;
  const version = source?.versions.find(version => version.number === number);
  if (!source || !version || !source.rights.authorized) return undefined;
  if (source.memory) {
    const excerpt = memoryWritingExcerpt(source, version.number, selected);
    return excerpt ? { ...excerpt, sourceId: source.id, sourceVersion: version.number } : undefined;
  }
  const segment = version.content.segments.find(segment => segment.id === selected.segmentId), { start, end } = selected;
  if (!segment || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > segment.text.length
    || segment.text.slice(start, end) !== selected.text || !selected.text.trim()) return undefined;
  return { ...selected, sourceId: source.id, sourceVersion: version.number, kind: 'citation', text: selected.text.replace(/\s+/g, ' ').trim(),
    ref: segmentRef(source.id, version.number, selected.segmentId, { from: start, to: end }) };
}
