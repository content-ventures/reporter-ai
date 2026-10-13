import { firstName, refKey } from '../../domain/index.ts';
import type { SourceRef, TranscriptSegment } from '../../domain/index.ts';
import type { Participant } from '../../ports/index.ts';

/**
 * A visible transcript excerpt with "Helena · 03:12" as its metadata. Built from the
 * production's material (segments by id, each label
 * with the person it is linked to). Pure; the screen formats the time.
 */

export type QuoteView = {
  key: string;
  ref: SourceRef;
  /** First name of the person who says it ("Helena"), else the transcript label ("Mediador"). */
  speaker: string;
  startMs?: number;
  /** The quoted words (the sentence range when the reference has one, else the whole line). */
  excerpt: string;
};

export type QuoteMaterial = { segments: readonly TranscriptSegment[]; speakers: readonly Participant[] };

export function quoteView(ref: SourceRef, material: QuoteMaterial): QuoteView {
  const key = refKey(ref);
  const locator = ref.locator;
  const segment = locator.type === 'segment' ? material.segments.find((candidate) => candidate.id === locator.segmentId) : undefined;
  const participant = segment?.speaker ? material.speakers.find((entry) => entry.label === segment.speaker) : undefined;
  const speaker = participant?.person ? firstName(participant.person.name) : (segment?.speaker ?? 'Fala');
  const text = segment ? (locator.type === 'segment' && locator.from !== undefined ? segment.text.slice(locator.from, locator.to) : segment.text) : '';
  const view: QuoteView = { key, ref, speaker, excerpt: (text || segment?.text || '').replace(/\s+/g, ' ').trim() };
  if (segment?.startMs !== undefined) view.startMs = segment.startMs;
  return view;
}
