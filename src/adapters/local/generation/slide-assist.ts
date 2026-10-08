import { blockText } from '../../../domain/article.ts';
import type { ArticleBlock, ArticleBody } from '../../../domain/article.ts';
import { findLayout, listItems } from '../../../domain/carousel.ts';
import type { CarouselBody, CarouselTemplate, Slide, SlideAssistAction, SlideLayout, SlotSpec } from '../../../domain/carousel.ts';
import type { BlockId, SlideId } from '../../../domain/ids.ts';
import { extractQuotes } from '../../../domain/quotes.ts';
import { fitSentences, overlap, sameText, sentences, standalone, titleCandidates, titlePhrase, wordCuts } from '../../../domain/text/slide-text.ts';
import { findFigure } from './carousel-features.ts';

/**
 * Plans of the "carousel.assist" run ("Reescrever", "Encurtar para caber", "Trocar ponto") and the
 * per-slide update when the article gets a newer approved version. Simulated deterministically and
 * extractively: it only selects and cuts text of the article version the carousel comes from (or
 * the newly approved one), never invents words, and keeps quotations literal. Every proposal
 * becomes a stored `Suggestion` (proposal kind `slide`) the person accepts or discards.
 */

export type SlideAssistKind = SlideAssistAction;

export type SlideProposal = {
  kind: SlideAssistKind;
  slideId: SlideId;
  /** Only the slots that change. */
  slots: Record<string, string>;
  /** Article blocks behind the slide after the change (new point, moved paragraph). */
  sourceBlockIds?: BlockId[];
};

export type AssistResult = { ok: true; proposal: SlideProposal } | { ok: false; reason: string };

export type AssistContext = {
  slide: Slide;
  template: CarouselTemplate | undefined;
  /** Approved article version the carousel is written from. */
  article: ArticleBody | undefined;
  /** All slides, to avoid points other slides already use. */
  slides: readonly Slide[];
};

const refuse = (reason: string): AssistResult => ({ ok: false, reason });

function propose(kind: SlideAssistKind, slide: Slide, slots: Record<string, string>, sourceBlockIds?: BlockId[]): AssistResult {
  const changed = Object.fromEntries(Object.entries(slots).filter(([id, value]) => value.trim() && value.trim() !== (slide.slots[id] ?? '').trim()));
  const movedPoint = sourceBlockIds !== undefined && sourceBlockIds.join('|') !== slide.sourceBlockIds.join('|');
  if (Object.keys(changed).length === 0 && !movedPoint) return refuse('Sem outra opção no artigo aprovado.');
  const proposal: SlideProposal = { kind, slideId: slide.id, slots: changed };
  if (movedPoint) proposal.sourceBlockIds = sourceBlockIds;
  return { ok: true, proposal };
}

const slotOf = (layout: SlideLayout | undefined, role: SlotSpec['role']) => layout?.slots.find((slot) => slot.role === role);

const isCover = (slide: Slide, template: CarouselTemplate | undefined) => slide.layout === (template?.coverLayoutId ?? 'cover');

function blockById(article: ArticleBody, id: BlockId): ArticleBlock | undefined {
  return article.blocks.find((block) => block.id === id);
}

/** The heading of the section a block belongs to. */
function headingBefore(article: ArticleBody, id: BlockId): ArticleBlock | undefined {
  let heading: ArticleBlock | undefined;
  for (const block of article.blocks) {
    if (block.id === id) return heading;
    if (block.type === 'heading') heading = block;
  }
  return undefined;
}

const isProse = (block: ArticleBlock) => block.type === 'paragraph' || block.type === 'list';

function usedElsewhere(slides: readonly Slide[], slideId: SlideId): Set<BlockId> {
  return new Set(slides.filter((slide) => slide.id !== slideId).flatMap((slide) => slide.sourceBlockIds));
}

/** Sentences joined from `start` to the end of the block, inside the budget. */
function sentenceWindow(pool: readonly string[], start: number, maxChars: number): string {
  let text = '';
  for (let at = start % pool.length; at < pool.length; at += 1) {
    const sentence = pool[at];
    const piece = text ? sentence : standalone(sentence);
    const next = text ? `${text} ${piece}` : piece;
    if (next.length > maxChars) break;
    text = next;
  }
  return text || fitSentences(standalone(pool[start % pool.length]), maxChars);
}

// ── Reescrever ───────────────────────────────────────────────────────────────────────────

export function rewriteSlide({ slide, template, article }: AssistContext): AssistResult {
  if (!article) return refuse('A versão aprovada do artigo ainda está carregando.');
  const layout = findLayout(template, slide.layout);
  if (isCover(slide, template)) {
    const title = slotOf(layout, 'title');
    if (!title) return refuse('Este layout não tem título.');
    const lead = article.blocks.find(isProse);
    const candidates = [titlePhrase(article.title, title.maxChars), lead ? titlePhrase(sentences(blockText(lead))[0] ?? '', title.maxChars) : ''];
    const next = candidates.find((candidate) => candidate && !sameText(candidate, slide.slots[title.id] ?? ''));
    return next ? propose('rewrite', slide, { [title.id]: next }) : refuse('A capa já usa o título do artigo.');
  }
  const quote = slotOf(layout, 'quote');
  if (quote) {
    const pool = slide.sourceBlockIds.flatMap((id) => {
      const block = blockById(article, id);
      return block ? sentences(blockText(block)) : [];
    });
    const next = pool.find((sentence) => sentence.length <= quote.maxChars && !sameText(sentence, slide.slots[quote.id] ?? ''));
    return next ? propose('rewrite', slide, { [quote.id]: next }) : refuse('A citação é literal. Use “Trocar ponto” para outra fala.');
  }
  if (slotOf(layout, 'stat')) return refuse('O texto acompanha o número. Use “Trocar ponto” para outro número.');
  const body = slotOf(layout, 'body');
  if (!body) return refuse('Este layout não tem texto corrido.');
  const pool = slide.sourceBlockIds
    .map((id) => blockById(article, id))
    .filter((block): block is ArticleBlock => Boolean(block && isProse(block)))
    .flatMap((block) => sentences(blockText(block)));
  if (pool.length === 0) return refuse('O slide não tem trecho de origem no artigo.');
  const current = slide.slots[body.id] ?? '';
  const first = sentences(current)[0] ?? current;
  let at = 0;
  pool.forEach((sentence, index) => {
    if (overlap(first, sentence) > overlap(first, pool[at])) at = index;
  });
  // The article's own wording of the same point first, then the neighbouring sentences.
  for (let shift = 0; shift <= pool.length; shift += 1) {
    const candidate = sentenceWindow(pool, at + shift, body.maxChars);
    if (candidate && !sameText(candidate, current)) return propose('rewrite', slide, { [body.id]: candidate });
  }
  return refuse('O trecho de origem não tem outra redação.');
}

// ── Encurtar para caber ──────────────────────────────────────────────────────────────────

/** Shorter versions of a slot text, preferred first: whole sentences, clauses, then word cuts. */
function shorterVersions(value: string, spec: SlotSpec): string[] {
  const steps: string[] = [];
  const push = (text: string) => {
    const clean = text.trim();
    if (clean && clean !== value.trim() && !steps.includes(clean)) steps.push(clean);
  };
  if (spec.role === 'stat') return steps;
  if (spec.role === 'list') {
    // Fewer items first (a list keeps at least two), never a cut inside an item.
    const items = listItems(value);
    for (let keep = items.length - 1; keep >= 2; keep -= 1) push(items.slice(0, keep).join('\n'));
    return steps;
  }
  const prose = spec.role === 'body' || spec.role === 'quote';
  if (prose) {
    const parts = sentences(value);
    for (let keep = parts.length - 1; keep >= 1; keep -= 1) push(parts.slice(0, keep).join(' '));
    push(fitSentences(value, spec.maxChars));
    for (const cut of wordCuts(value, 0.4, { ellipsis: true })) push(cut);
  } else {
    // Same order as the generation and the start page's preview (`titleCandidates`).
    for (const candidate of titleCandidates(value, spec.maxChars)) push(candidate);
  }
  return steps;
}

/**
 * "Encurtar para caber": every slot over its budget or flagged by the renderer gets the longest
 * shorter version that fits. `fits(slotId, text)` asks the renderer (approximate, by lines).
 */
export function fitSlide(
  { slide, template }: Pick<AssistContext, 'slide' | 'template'>,
  overflowing: ReadonlySet<string>,
  fits: (slotId: string, text: string) => boolean,
): AssistResult {
  const layout = findLayout(template, slide.layout);
  if (!layout) return refuse('Layout fora do modelo.');
  const slots: Record<string, string> = {};
  for (const spec of layout.slots) {
    const value = slide.slots[spec.id]?.trim() ?? '';
    if (!value || (!overflowing.has(spec.id) && value.length <= spec.maxChars)) continue;
    const shorter = shorterVersions(value, spec).find((text) => text.length <= spec.maxChars && fits(spec.id, text));
    if (shorter) slots[spec.id] = shorter;
  }
  if (Object.keys(slots).length === 0) {
    const over = layout.slots.some((spec) => overflowing.has(spec.id) || (slide.slots[spec.id]?.length ?? 0) > spec.maxChars);
    return refuse(over ? 'Não há corte que preserve o sentido.' : 'Todos os textos já cabem.');
  }
  return propose('fit', slide, slots);
}

// ── Trocar ponto ─────────────────────────────────────────────────────────────────────────

export function swapPoint({ slide, template, article, slides }: AssistContext): AssistResult {
  if (!article) return refuse('A versão aprovada do artigo ainda está carregando.');
  if (isCover(slide, template)) return refuse('A capa segue o título do artigo.');
  const layout = findLayout(template, slide.layout);
  const taken = usedElsewhere(slides, slide.id);
  const quote = slotOf(layout, 'quote');
  if (quote) {
    const quotes = extractQuotes(article);
    const start = Math.max(0, quotes.findIndex((entry) => slide.sourceBlockIds.includes(entry.blockId)));
    for (let step = 1; step <= quotes.length; step += 1) {
      const entry = quotes[(start + step) % quotes.length];
      if (!entry || taken.has(entry.blockId) || sameText(entry.text, slide.slots[quote.id] ?? '')) continue;
      return propose('swap', slide, { [quote.id]: fitSentences(entry.text, quote.maxChars) }, [entry.blockId]);
    }
    return refuse('Não há outra citação livre no artigo.');
  }
  const body = slotOf(layout, 'body');
  const title = slotOf(layout, 'title');
  if (!body) return refuse('Este layout não tem texto corrido.');
  const paragraphs = article.blocks.filter(isProse);
  const stat = slotOf(layout, 'stat');
  if (stat) {
    // A data slide swaps to the next paragraph with a figure, and keeps figure, text and title together.
    const from = Math.max(0, paragraphs.findIndex((block) => slide.sourceBlockIds.includes(block.id)));
    for (let step = 1; step <= paragraphs.length; step += 1) {
      const block = paragraphs[(from + step) % paragraphs.length];
      if (!block || taken.has(block.id) || slide.sourceBlockIds.includes(block.id)) continue;
      const figure = findFigure(blockText(block), stat.maxChars);
      if (!figure || sameText(figure.stat, slide.slots[stat.id] ?? '')) continue;
      const heading = headingBefore(article, block.id);
      const slots: Record<string, string> = { [stat.id]: figure.stat, [body.id]: fitSentences(figure.body, body.maxChars) };
      if (title && heading) slots[title.id] = titlePhrase(blockText(heading), title.maxChars);
      return propose('swap', slide, slots, heading ? [heading.id, block.id] : [block.id]);
    }
    return refuse('Não há outro número livre no artigo.');
  }
  const start = Math.max(0, paragraphs.findIndex((block) => slide.sourceBlockIds.includes(block.id)));
  for (let step = 1; step <= paragraphs.length; step += 1) {
    const block = paragraphs[(start + step) % paragraphs.length];
    if (!block || taken.has(block.id) || slide.sourceBlockIds.includes(block.id)) continue;
    const text = blockText(block);
    const heading = headingBefore(article, block.id);
    const slots: Record<string, string> = { [body.id]: fitSentences(standalone(text), body.maxChars) };
    if (title && slide.layout !== 'context') {
      slots[title.id] = titlePhrase(heading ? blockText(heading) : (sentences(text)[0] ?? text), title.maxChars);
    }
    return propose('swap', slide, slots, heading ? [heading.id, block.id] : [block.id]);
  }
  return refuse('Todos os pontos do artigo já estão nos slides.');
}

// ── Atualizar slides (artigo reaprovado) ─────────────────────────────────────────────────

function mostSimilar(article: ArticleBody, text: string, type: ArticleBlock['type']): ArticleBlock | undefined {
  let best: { block: ArticleBlock; score: number } | undefined;
  for (const block of article.blocks) {
    if (block.type !== type) continue;
    const score = overlap(text, blockText(block));
    if (!best || score > best.score) best = { block, score };
  }
  return best && best.score >= 0.5 ? best.block : undefined;
}

/** Body copy from what changed in a paragraph: the new sentences first, in text order. */
function updatedBody(oldText: string, newText: string, maxChars: number): string {
  const before = sentences(oldText);
  const after = sentences(newText);
  const changed = after.filter((sentence) => !before.some((old) => sameText(old, sentence)));
  const pool = changed.length > 0 ? changed : after;
  let text = '';
  for (const sentence of pool) {
    const piece = text ? sentence : standalone(sentence);
    const next = text ? `${text} ${piece}` : piece;
    if (next.length > maxChars) break;
    text = next;
  }
  return text || fitSentences(standalone(pool[0] ?? newText), maxChars);
}

/**
 * One proposal per slide whose article blocks changed between the version the carousel was made
 * from and the newly approved one. Slides that still match get nothing; edits are never dropped.
 */
export function updateProposals(body: CarouselBody, template: CarouselTemplate | undefined, before: ArticleBody, after: ArticleBody): SlideProposal[] {
  const proposals: SlideProposal[] = [];
  for (const slide of body.slides) {
    const layout = findLayout(template, slide.layout);
    if (!layout) continue;
    const slots: Record<string, string> = {};
    const ids = [...slide.sourceBlockIds];
    const title = slotOf(layout, 'title');
    if (isCover(slide, template) && title && !sameText(before.title, after.title) && sameText(slide.slots[title.id] ?? '', before.title)) {
      slots[title.id] = titlePhrase(after.title, title.maxChars);
    }
    slide.sourceBlockIds.forEach((id, index) => {
      const old = blockById(before, id);
      let next = blockById(after, id);
      if (old && next && blockText(old) === blockText(next)) return;
      if (!next && old) {
        next = mostSimilar(after, blockText(old), old.type);
        if (next) ids[index] = next.id;
      }
      if (!next || !old) return;
      const oldText = blockText(old);
      const newText = blockText(next);
      if (old.type === 'heading') {
        const current = slide.slots[title?.id ?? ''] ?? '';
        if (title && overlap(current, oldText) >= 0.5) slots[title.id] = titlePhrase(newText, title.maxChars);
        return;
      }
      const quote = slotOf(layout, 'quote');
      if (quote) {
        const current = slide.slots[quote.id] ?? '';
        const still = sentences(newText).some((sentence) => sameText(sentence, current)) || sameText(newText, current);
        if (!still) {
          const best = sentences(newText).reduce((pick, sentence) => (overlap(current, sentence) > overlap(current, pick) ? sentence : pick), newText);
          slots[quote.id] = fitSentences(best, quote.maxChars);
        }
        return;
      }
      const prose = slotOf(layout, 'body');
      if (prose) slots[prose.id] = updatedBody(oldText, newText, prose.maxChars);
    });
    const result = propose('update', slide, slots, ids);
    if (result.ok) proposals.push(result.proposal);
  }
  return proposals;
}

// ── Aplicar ──────────────────────────────────────────────────────────────────────────────

/** The slide after accepting a proposal (an accepted AI proposal counts as reviewed). */
export function applyProposal(slide: Slide, proposal: SlideProposal): Slide {
  const next: Slide = { ...slide, slots: { ...slide.slots, ...proposal.slots } };
  if (proposal.sourceBlockIds) next.sourceBlockIds = [...proposal.sourceBlockIds];
  if (slide.ai) next.ai = 'reviewed';
  return next;
}

/** Proposal still valid: the slots it rewrites hold the same text as when it was made. */
export function proposalBase(slide: Slide, proposal: SlideProposal): Record<string, string> {
  return Object.fromEntries(Object.keys(proposal.slots).map((id) => [id, slide.slots[id] ?? '']));
}
