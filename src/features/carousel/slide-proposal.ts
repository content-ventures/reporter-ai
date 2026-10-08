import type { BlockId, Slide, SlideAssistAction, SlideId, Suggestion } from '../../domain/index.ts';

/**
 * A slide proposal as the studio shows it (from a stored `Suggestion` with proposal kind
 * `slide`): which action made it, the slots it changes and the article blocks behind the slide
 * after the change. Pure, so the preview render and the tests share it.
 */
export type SlideProposal = {
  kind: SlideAssistAction;
  slideId: SlideId;
  slots: Record<string, string>;
  sourceBlockIds?: BlockId[];
};

/** The slide after accepting a proposal (preview of "Proposta"; the store applies the same). */
export function applyProposal(slide: Slide, proposal: Pick<SlideProposal, 'slots' | 'sourceBlockIds'>): Slide {
  const next: Slide = { ...slide, slots: { ...slide.slots, ...proposal.slots } };
  if (proposal.sourceBlockIds) next.sourceBlockIds = [...proposal.sourceBlockIds];
  if (slide.ai) next.ai = 'reviewed';
  return next;
}

/** A stored slide suggestion as a proposal, with the slot texts it was made on. */
export function slideProposalOf(suggestion: Suggestion): { proposal: SlideProposal; base: Record<string, string> } | undefined {
  const { proposal } = suggestion;
  if (proposal.kind !== 'slide') return undefined;
  const base = Object.fromEntries(Object.keys(proposal.slots).map((slot, index) => [slot, suggestion.anchorText[index] ?? '']));
  const out: SlideProposal = { kind: proposal.action ?? 'rewrite', slideId: proposal.slideId, slots: proposal.slots };
  if (proposal.sourceBlockIds) out.sourceBlockIds = proposal.sourceBlockIds;
  return { proposal: out, base };
}
