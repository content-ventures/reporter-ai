import { blockText, findBlock, hasInlines, markBlocksReviewed, normalizeInlines, replaceTextRange, sliceText } from './article.ts';
import type { ArticleBlock, ArticleBody, Inline } from './article.ts';
import type { CarouselBody, SlideAssistAction } from './carousel.ts';
import type { BlockId, IsoDateTime, PersonId, PieceId, RunId, SlideId, SuggestionId } from './ids.ts';
import type { TextRange } from './refs.ts';
import { ok, refuse } from './result.ts';
import type { Result } from './result.ts';

/**
 * AI proposals the person accepts or discards (inline rewrite, alternative titles, slide copy;
 * later F2.13 links, F3.5, R6). While a suggestion streams the document does not change.
 */

export type SuggestionState = 'streaming' | 'ready' | 'stale' | 'applied' | 'discarded' | 'error';

export type SuggestionProposal =
  | { kind: 'replace-text'; text: string }
  | { kind: 'replace-blocks'; blocks: ArticleBlock[] }
  | { kind: 'title'; text: string }
  | {
      kind: 'slide';
      slideId: SlideId;
      /** Only the slots that change. */
      slots: Record<string, string>;
      /** Article blocks behind the slide after the change (a new point). */
      sourceBlockIds?: BlockId[];
      /** Which slide action proposed it. */
      action?: SlideAssistAction;
    }
  | { kind: 'add-link'; href: string };

export type Suggestion = {
  id: SuggestionId;
  runId: RunId;
  pieceId: PieceId;
  /** Draft revision the suggestion was computed against. */
  baseRevision: number;
  /** Ranges inside blocks; a selection inside a paragraph is one range. */
  target: TextRange[];
  /** Text of each target when the suggestion was created; detects edits to the target. */
  anchorText: string[];
  proposal: SuggestionProposal;
  state: SuggestionState;
  /** Action label: "Mais direto", "Encurtar", "Título alternativo"… */
  label?: string;
  createdAt: IsoDateTime;
  decidedAt?: IsoDateTime;
  decidedBy?: PersonId;
  vote?: 'up' | 'down';
};

export function isSuggestionPending(suggestion: Pick<Suggestion, 'state'>): boolean {
  return suggestion.state === 'streaming' || suggestion.state === 'ready';
}

/**
 * Finds where each target is now. A range whose text still matches stays; otherwise the
 * anchor text is searched in the same block and must occur exactly once. Returns `undefined`
 * when any target was edited or removed (the suggestion is stale: "Trecho mudou · Reaplicar").
 */
export function locateTargets(body: ArticleBody, suggestion: Pick<Suggestion, 'target' | 'anchorText'>): TextRange[] | undefined {
  const located: TextRange[] = [];
  for (const [index, range] of suggestion.target.entries()) {
    const expected = suggestion.anchorText[index];
    if (expected === undefined) return undefined;
    if (sliceText(body, range) === expected) {
      located.push(range);
      continue;
    }
    const block = findBlock(body, range.blockId);
    if (!block || !expected) return undefined;
    const text = blockText(block);
    const first = text.indexOf(expected);
    if (first < 0 || text.indexOf(expected, first + 1) >= 0) return undefined;
    located.push({ blockId: range.blockId, from: first, to: first + expected.length });
  }
  return located;
}

export function isSuggestionStale(body: ArticleBody, suggestion: Suggestion): boolean {
  if (suggestion.proposal.kind === 'title' || suggestion.proposal.kind === 'slide') return false;
  return locateTargets(body, suggestion) === undefined;
}

export type ApplySuggestionRefusal = 'stale' | 'not_pending' | 'unsupported' | 'invalid_target';

/** Applies an article suggestion as one change; touched blocks count as reviewed. */
export function applySuggestion(body: ArticleBody, suggestion: Suggestion): Result<ArticleBody, ApplySuggestionRefusal> {
  if (suggestion.state !== 'ready') return refuse('not_pending', 'Esta sugestão não está mais disponível.');
  const { proposal } = suggestion;
  if (proposal.kind === 'title') return ok({ ...body, title: proposal.text.trim() });
  if (proposal.kind === 'slide') return refuse('unsupported', 'Sugestão de slide não se aplica ao artigo.');

  const targets = locateTargets(body, suggestion);
  if (!targets) return refuse('stale', 'O trecho mudou desde a sugestão.');

  if (proposal.kind === 'replace-text' || proposal.kind === 'add-link') {
    if (targets.length !== 1) return refuse('invalid_target', 'A sugestão precisa de um único trecho.');
    const [range] = targets;
    if (proposal.kind === 'replace-text') {
      const replaced = replaceTextRange(body, range, proposal.text);
      if (!replaced.ok) return refuse('invalid_target', replaced.refusal.message);
      return ok(markBlocksReviewed(replaced.value, [range.blockId]));
    }
    return addLink(body, range, proposal.href);
  }

  const ids = [...new Set(targets.map((range) => range.blockId))];
  const positions = ids.map((id) => body.blocks.findIndex((block) => block.id === id)).sort((a, b) => a - b);
  const contiguous = positions.every((position, index) => index === 0 || position === positions[index - 1] + 1);
  if (positions.some((position) => position < 0) || !contiguous) {
    return refuse('invalid_target', 'Os blocos da sugestão precisam ser vizinhos.');
  }
  const replacement = proposal.blocks.map((block) => (block.ai ? { ...block, ai: 'reviewed' as const } : block));
  const blocks = [
    ...body.blocks.slice(0, positions[0]),
    ...replacement,
    ...body.blocks.slice(positions[positions.length - 1] + 1),
  ];
  return ok({ ...body, blocks });
}

function addLink(body: ArticleBody, range: TextRange, href: string): Result<ArticleBody, ApplySuggestionRefusal> {
  const index = body.blocks.findIndex((block) => block.id === range.blockId);
  const block = body.blocks[index];
  if (!block || !hasInlines(block)) return refuse('invalid_target', 'Links só entram em parágrafos, intertítulos e citações.');
  const inlines: Inline[] = [];
  let offset = 0;
  for (const inline of block.inlines) {
    const start = offset;
    const end = offset + inline.text.length;
    offset = end;
    const cuts = [start, Math.min(Math.max(range.from, start), end), Math.min(Math.max(range.to, start), end), end];
    for (let part = 0; part < 3; part += 1) {
      const text = inline.text.slice(cuts[part] - start, cuts[part + 1] - start);
      if (!text) continue;
      if (part === 1) {
        const marks = [...new Set([...(inline.marks ?? []), 'link' as const])];
        inlines.push({ text, marks, href });
      } else {
        inlines.push({ ...inline, text });
      }
    }
  }
  const blocks = body.blocks.slice();
  blocks[index] = { ...block, inlines: normalizeInlines(inlines) };
  return ok({ ...body, blocks });
}

/** Applies a slide suggestion to a carousel body (slot texts replaced, slide marked reviewed). */
export function applySlideSuggestion(body: CarouselBody, suggestion: Suggestion): Result<CarouselBody, ApplySuggestionRefusal> {
  if (suggestion.state !== 'ready') return refuse('not_pending', 'Esta sugestão não está mais disponível.');
  const { proposal } = suggestion;
  if (proposal.kind !== 'slide') return refuse('unsupported', 'Sugestão de texto não se aplica ao carrossel.');
  const index = body.slides.findIndex((slide) => slide.id === proposal.slideId);
  if (index < 0) return refuse('stale', 'O slide não existe mais.');
  const slides = body.slides.slice();
  const slide = slides[index];
  slides[index] = {
    ...slide,
    slots: { ...slide.slots, ...proposal.slots },
    ...(proposal.sourceBlockIds ? { sourceBlockIds: [...proposal.sourceBlockIds] } : {}),
    ...(slide.ai ? { ai: 'reviewed' as const } : {}),
  };
  return ok({ ...body, slides });
}
