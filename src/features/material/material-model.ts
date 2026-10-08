import type { TranscriptSegment as ViewerSegment, TranscriptSpeaker } from '@content-ventures/design-system/v3';
import type { ArticleBlock, PieceBody, SourceId, SourceVersion } from '@/domain';
import type { Participant } from '@/ports';

/**
 * Pure mapping from the versioned source to the DS TranscriptViewer: speakers carry the person
 * they are mapped to (name and photo; never initials), timestamps stay in milliseconds, and the
 * segments the article cites are marked "Usado".
 */

/** Speaker as the viewer draws it; the transcript label stays the id (stable across versions). */
export function viewerSpeaker(label: string, participant: Participant | undefined): TranscriptSpeaker {
  const person = participant?.person;
  return { id: label, name: person?.name ?? label, ...(person?.avatarUrl ? { src: person.avatarUrl } : {}) };
}

export function viewerSegments(version: SourceVersion, participants: readonly Participant[]): ViewerSegment[] {
  const speakers = new Map<string, TranscriptSpeaker>();
  for (const participant of participants) speakers.set(participant.label, viewerSpeaker(participant.label, participant));
  return version.content.segments.map((segment) => {
    const entry: ViewerSegment = { id: segment.id, text: segment.text };
    if (segment.speaker) entry.speaker = speakers.get(segment.speaker) ?? viewerSpeaker(segment.speaker, undefined);
    if (segment.startMs !== undefined) entry.start = segment.startMs;
    if (segment.endMs !== undefined) entry.end = segment.endMs;
    return entry;
  });
}

function blockRefs(block: ArticleBlock) {
  return block.sourceRefs ?? [];
}

/** Segment ids of `sourceId` cited by an article body (any source version: segment ids are stable). */
export function citedSegmentIds(body: PieceBody | undefined, sourceId: SourceId): string[] {
  if (!body || body.type !== 'article') return [];
  const ids = new Set<string>();
  for (const block of body.blocks) {
    for (const ref of blockRefs(block)) {
      if (ref.sourceId === sourceId && ref.locator.type === 'segment') ids.add(ref.locator.segmentId);
    }
  }
  return [...ids];
}

/**
 * Value of the speaker Select: a person id, still undecided (`UNSET`, "sem pessoa"), explicitly
 * nobody ("Sem atribuição"), or a person created on save.
 */
export const UNSET = '';
export const NO_PERSON = '__none__';
export const NEW_PERSON = '__new__';

/** Who a person is in the text (wireframe R1·1 "Participantes"). */
export type PersonFields = { name: string; title: string; organization: string };

export const EMPTY_PERSON: PersonFields = { name: '', title: '', organization: '' };
