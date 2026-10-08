import { firstName, refKey } from '../../domain/index.ts';
import type { SourceRef, TranscriptSegment } from '../../domain/index.ts';
import type { Participant } from '../../ports/index.ts';

/**
 * How a quote of the structure reads on screen (COPY §6.4): "Helena · 03:12" on the chip, the
 * line itself in the preview. Built from the production's material (segments by id, each label
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

const MAX_EXCERPT = 280;

function clip(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= MAX_EXCERPT) return clean;
  const cut = clean.slice(0, MAX_EXCERPT);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_EXCERPT * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function quoteView(ref: SourceRef, material: QuoteMaterial): QuoteView {
  const key = refKey(ref);
  const locator = ref.locator;
  const segment = locator.type === 'segment' ? material.segments.find((candidate) => candidate.id === locator.segmentId) : undefined;
  const participant = segment?.speaker ? material.speakers.find((entry) => entry.label === segment.speaker) : undefined;
  const speaker = participant?.person ? firstName(participant.person.name) : (segment?.speaker ?? 'Fala');
  const text = segment ? (locator.type === 'segment' && locator.from !== undefined ? segment.text.slice(locator.from, locator.to) : segment.text) : '';
  const view: QuoteView = { key, ref, speaker, excerpt: clip(text || segment?.text || '') };
  if (segment?.startMs !== undefined) view.startMs = segment.startMs;
  return view;
}
