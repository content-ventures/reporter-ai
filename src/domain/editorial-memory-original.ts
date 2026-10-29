import { resolveMemoryAnchor, type MemoryAnchor } from './editorial-memory.ts';
import type { Source } from './source.ts';

/** Human-requested original context is bounded and never becomes writer input. Offsets remain UTF-16. */
export function memoryOriginalContext(source: Source, anchor: MemoryAnchor): { before: string; excerpt: string; after: string } | undefined {
  const excerpt = resolveMemoryAnchor(source, anchor);
  if (excerpt === undefined) return undefined;
  const version = source.versions.find(version => version.number === anchor.source.sourceVersion)!;
  const first = anchor.spans[0], last = anchor.spans.at(-1)!;
  const firstIndex = version.content.segments.findIndex(segment => segment.id === first.segmentId), lastIndex = version.content.segments.findIndex(segment => segment.id === last.segmentId);
  let before = version.content.segments[firstIndex].text.slice(0, first.from), after = version.content.segments[lastIndex].text.slice(last.to);
  for (let i = firstIndex - 1; i >= 0 && before.length < 1000; i--) before = version.content.segments[i].text.slice(-1000) + '\n' + before;
  for (let i = lastIndex + 1; i < version.content.segments.length && after.length < 1000; i++) after += '\n' + version.content.segments[i].text.slice(0, 1000);
  before = before.slice(-1000); after = after.slice(0, 1000);
  if (/^[\uDC00-\uDFFF]/.test(before)) before = before.slice(1);
  if (/[\uD800-\uDBFF]$/.test(after)) after = after.slice(0, -1);
  return { before, excerpt, after };
}
