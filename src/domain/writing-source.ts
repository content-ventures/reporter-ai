import { segmentRef } from './refs.ts';
import type { SourceRef } from './refs.ts';
import { currentSourceVersion, writingSources } from './source.ts';
import type { Source } from './source.ts';
import { contentHash } from './text/hash.ts';

/** Complete original turns, including questions and qualifiers; no editorial reduction. */
export function writingSourceCandidates(sources: readonly Source[]): { key: string; text: string; speaker?: string; ref: SourceRef }[] {
  return writingSources(sources).filter(source => !source.research).flatMap(source => {
    const version = currentSourceVersion(source);
    return version.content.segments.filter(segment => segment.text.trim()).map(segment => {
      const ref = segmentRef(source.id, version.number, segment.id);
      return { key: 'source-' + contentHash(ref), text: segment.text, ...(segment.speaker ? { speaker: segment.speaker } : {}), ref };
    });
  });
}
