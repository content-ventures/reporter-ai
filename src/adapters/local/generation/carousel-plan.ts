import { blockText } from '../../../domain/article.ts';
import type { ArticleBlock, ArticleBody } from '../../../domain/article.ts';
import { DEFAULT_SLIDE_SEQUENCE, findLayout } from '../../../domain/carousel.ts';
import type { CarouselTemplate, Slide, SlideLayout, SlotRole } from '../../../domain/carousel.ts';
import type { BlockId } from '../../../domain/ids.ts';
import { extractQuotes } from '../../../domain/quotes.ts';
import { resolveSourceRef } from '../../../domain/source.ts';
import type { Source, SourceOrigin } from '../../../domain/source.ts';
import { articleTopic, coverKicker } from '../../../domain/text/kicker.ts';
import { sameText, sentences, standalone, titleCandidates } from '../../../domain/text/slide-text.ts';
import type { SlideCopy } from '../../../ports/script-book.ts';
import { featureSlides } from './carousel-features.ts';
import { fitText, sentenceSpans, withoutFinalPeriod } from './sentences.ts';

/**
 * Slide copy for "carousel.copy", taken from the APPROVED article version: Capa · Contexto ·
 * Ponto principal · Citação · Conclusão. Text is selected from the article (never invented) and
 * fitted to each slot's character budget at sentence or word boundaries; the render's line fit is
 * checked by the run's "Conferindo limites" step. The cover's call is "editoria · marca". No slot
 * gets a label for text ("Contexto"): the context slide is titled by the production's working
 * title when it reads as one, else it shows its text alone. Templates that feature `data` or
 * `list` get one of those in place of a point when the article has the material
 * (`carousel-features.ts`). A Curto has no intertítulos: each paragraph after the lead reads as a
 * point, headed by its own first statement.
 */

export type CarouselPlan = { origin: 'script' | 'extractive'; slides: Slide[] };

type NewId = (prefix: string) => string;

type Section = {
  heading?: ArticleBlock;
  blocks: ArticleBlock[];
  /** A paragraph of a text without intertítulos read as a point (its first statement heads it). */
  point?: ArticleBlock;
};

/** Last resort of the cover's call, when neither the editoria nor the brand is known. */
const ORIGIN_KICKERS: Partial<Record<SourceOrigin, string>> = {
  interview: 'Entrevista',
  podcast: 'Podcast',
  event: 'Evento',
  talk: 'Palestra',
};

const CTA_TEXT = 'Leia a matéria completa';

/**
 * A paragraph read as a point: the first statement (the words inside its quotation, without the
 * attribution) heads the slide and the rest of the paragraph is its text.
 */
function pointOf(block: ArticleBlock): { title: string; body: string } {
  const [head = '', ...rest] = sentences(blockText(block));
  const quoted = /“([^”]+)”/.exec(head)?.[1];
  return { title: standalone(withoutFinalPeriod((quoted ?? head).trim())), body: rest.join(' ') };
}

function sectionsOf(body: ArticleBody): Section[] {
  const sections: Section[] = [{ blocks: [] }];
  for (const block of body.blocks) {
    if (block.type === 'heading') sections.push({ heading: block, blocks: [] });
    else sections[sections.length - 1].blocks.push(block);
  }
  return sections.filter((section) => section.heading || section.blocks.length > 0);
}

/** Layout ids to use for `count` slides, mapped onto what the template offers. */
export function slideSequence(template: CarouselTemplate, count: number): string[] {
  const total = Math.min(template.maxSlides, Math.max(template.minSlides, count));
  let sequence: string[];
  if (total <= 3) sequence = ['cover', 'point', 'closing'].slice(0, total);
  else if (total === 4) sequence = ['cover', 'point', 'quote', 'closing'];
  else sequence = [...DEFAULT_SLIDE_SEQUENCE.slice(0, 3), ...Array<string>(total - 5).fill('point'), ...DEFAULT_SLIDE_SEQUENCE.slice(3)];
  const fallback: Record<string, string[]> = {
    cover: [template.coverLayoutId],
    context: ['point'],
    quote: ['point'],
    closing: ['point'],
  };
  return sequence.map((id) => {
    if (findLayout(template, id)) return id;
    const alternative = (fallback[id] ?? []).find((candidate) => findLayout(template, candidate));
    return alternative ?? template.layouts[0].id;
  });
}

function firstSentences(text: string, maxChars: number): string {
  const sentences = sentenceSpans(text);
  return fitText(sentences.map((sentence) => sentence.text).join(' '), maxChars);
}

function paragraphs(blocks: readonly ArticleBlock[]): ArticleBlock[] {
  return blocks.filter((block) => block.type === 'paragraph' || block.type === 'list');
}

export type CarouselPlanInput = {
  article: ArticleBody;
  template: CarouselTemplate;
  slides: number;
  sources: readonly Source[];
  /** Organisation of the people who speak the most (the cover's "marca"). */
  brand?: string;
  /** The production's working title ("Tendências do verão 2027"): the editoria and the context slide read it. */
  subject?: string;
  newId: NewId;
};

type ArticleQuote = ReturnType<typeof extractQuotes>[number];

/** Words a quotation needs to stand alone on its slide ("Aparece, e com números" does not). */
const QUOTE_MIN_WORDS = 8;

/**
 * The quotation the quote slide carries: an unused one that stands alone and fits whole, a block
 * quotation first (the article already lifted it); else the longest unused one that fits.
 */
function slideQuote(quotes: readonly ArticleQuote[], used: ReadonlySet<BlockId>, maxChars: number): ArticleQuote | undefined {
  const words = (quote: ArticleQuote) => quote.text.split(/\s+/).filter(Boolean).length;
  const free = quotes.filter((quote) => !used.has(quote.blockId) && quote.text.length <= maxChars);
  const standing = free.filter((quote) => words(quote) >= QUOTE_MIN_WORDS);
  return (
    standing.find((quote) => quote.kind === 'block') ??
    standing[0] ??
    [...free].sort((a, b) => words(b) - words(a))[0] ??
    quotes.find((quote) => !used.has(quote.blockId)) ??
    quotes[0]
  );
}

/** A working title that reads as a slide title: three words or more, not the cover again. */
function contextTitle(subject: string | undefined, coverTitle: string, maxChars: number): string | undefined {
  const [candidate] = subject ? titleCandidates(subject, maxChars) : [];
  if (!candidate || candidate.split(/\s+/).length < 3 || sameText(candidate, coverTitle)) return undefined;
  return candidate;
}

/**
 * Plan from hand-written slide copy, when it still fits: same number of slides, layouts the
 * template has, and every source block present in the approved article version.
 */
export function planFromCarouselScript(
  copy: readonly SlideCopy[],
  input: Pick<CarouselPlanInput, 'article' | 'template' | 'slides' | 'newId'>,
): CarouselPlan | undefined {
  const blockIds = new Set(input.article.blocks.map((block) => block.id));
  const fits =
    copy.length === input.slides &&
    copy.every((slide) => findLayout(input.template, slide.layout) && slide.sourceBlockIds.every((id) => blockIds.has(id)));
  if (!fits) return undefined;
  const slides: Slide[] = copy.map((slide) => ({
    id: input.newId('sld'),
    layout: slide.layout,
    slots: { ...slide.slots },
    sourceBlockIds: [...slide.sourceBlockIds],
    ai: 'unreviewed',
  }));
  return { origin: 'script', slides: featureSlides(slides, input.template, input.article) };
}

export function extractiveCarouselPlan(input: CarouselPlanInput): CarouselPlan {
  const { article, template } = input;
  const sections = sectionsOf(article);
  let intro = sections.find((section) => !section.heading);
  let bodySections = sections.filter((section) => section.heading);
  if (bodySections.length === 0 && intro) {
    // A Curto writes no intertítulos: the lead opens, every paragraph after it is a point.
    const [lead, ...rest] = paragraphs(intro.blocks);
    if (rest.length > 0) {
      bodySections = rest.map((block) => ({ blocks: [block], point: block }));
      intro = { blocks: lead ? [lead] : [] };
    }
  }
  const headless = bodySections.length > 0 && bodySections.every((section) => section.point);
  const used = new Set<BlockId>();
  const quotes = extractQuotes(article);
  const origin = input.sources[0]?.origin;
  let pointIndex = 0;

  const speakerOf = (block: ArticleBlock): string | undefined => {
    for (const ref of block.sourceRefs ?? []) {
      const resolved = resolveSourceRef(input.sources, ref);
      const label = resolved?.speaker?.label ?? resolved?.segment?.speaker;
      if (label) return label;
    }
    return undefined;
  };

  const unusedParagraph = (blocks: readonly ArticleBlock[]) => paragraphs(blocks).find((block) => !used.has(block.id));

  const content = (layoutId: string): { values: Partial<Record<SlotRole, string>>; blocks: BlockId[] } => {
    const values: Partial<Record<SlotRole, string>> = {};
    const blocks: BlockId[] = [];
    const take = (block: ArticleBlock | undefined) => {
      if (!block) return '';
      used.add(block.id);
      blocks.push(block.id);
      return blockText(block);
    };
    switch (layoutId) {
      case 'cover': {
        values.title = article.title;
        const budget = findLayout(template, layoutId)?.slots.find((slot) => slot.role === 'kicker')?.maxChars ?? 32;
        const topic = articleTopic({ title: [article.title, input.subject].filter(Boolean).join(' · '), text: article.blocks.map(blockText).join(' ') });
        const kicker = coverKicker({ topic, brand: input.brand, fallback: origin ? ORIGIN_KICKERS[origin] : undefined }, budget);
        if (kicker) values.kicker = kicker;
        break;
      }
      case 'context': {
        const lead = unusedParagraph(intro?.blocks ?? []) ?? unusedParagraph(bodySections[0]?.blocks ?? []);
        const titleSlot = findLayout(template, layoutId)?.slots.find((slot) => slot.role === 'title');
        const title = titleSlot ? contextTitle(input.subject, article.title, titleSlot.maxChars) : undefined;
        if (title) values.title = title;
        values.body = take(lead);
        break;
      }
      case 'quote': {
        const quote = slideQuote(quotes, used, findLayout(template, layoutId)?.slots.find((slot) => slot.role === 'quote')?.maxChars ?? 140);
        if (quote) {
          const block = article.blocks.find((candidate) => candidate.id === quote.blockId);
          if (block) {
            used.add(block.id);
            blocks.push(block.id);
            values.quote = quote.text;
            const speaker = speakerOf(block);
            if (speaker) values.attribution = speaker;
          }
        } else {
          values.title = bodySections[0]?.heading ? blockText(bodySections[0].heading) : article.title;
          values.body = take(unusedParagraph(article.blocks));
        }
        break;
      }
      case 'closing': {
        if (headless) {
          const last = [...bodySections].reverse().find((section) => section.point && !used.has(section.point.id)) ?? bodySections[bodySections.length - 1];
          if (last.point) {
            const point = pointOf(last.point);
            values.title = point.title;
            if (!used.has(last.point.id) && point.body) values.body = point.body;
            used.add(last.point.id);
            blocks.push(last.point.id);
          }
          values.cta = CTA_TEXT;
          break;
        }
        const last = bodySections[bodySections.length - 1] ?? intro;
        if (last?.heading) values.title = blockText(last.heading);
        const closingBlock = [...paragraphs(last?.blocks ?? [])].reverse().find((block) => !used.has(block.id));
        values.body = take(closingBlock);
        values.cta = CTA_TEXT;
        break;
      }
      default: {
        const free = headless ? bodySections.find((section) => section.point && !used.has(section.point.id)) : undefined;
        if (free?.point) {
          const point = pointOf(free.point);
          values.title = point.title;
          if (point.body) values.body = point.body;
          used.add(free.point.id);
          blocks.push(free.point.id);
          break;
        }
        const section = bodySections[pointIndex] ?? bodySections[bodySections.length - 1] ?? intro;
        pointIndex += 1;
        if (section?.heading) values.title = blockText(section.heading);
        values.body = take(unusedParagraph(section?.blocks ?? []));
        if (section?.heading) blocks.unshift(section.heading.id);
      }
    }
    return { values, blocks };
  };

  const slides = slideSequence(template, input.slides).map((layoutId) => {
    const layout = findLayout(template, layoutId) as SlideLayout;
    const { values, blocks } = content(layoutId);
    const slots: Record<string, string> = {};
    for (const slot of layout.slots) {
      const raw = values[slot.role];
      if (!raw) continue;
      const fitted =
        slot.role === 'body'
          ? firstSentences(raw, slot.maxChars)
          : slot.role === 'title'
            ? (titleCandidates(raw, slot.maxChars)[0] ?? fitText(withoutFinalPeriod(raw), slot.maxChars))
            : fitText(raw, slot.maxChars);
      if (fitted) slots[slot.id] = fitted;
    }
    const slide: Slide = { id: input.newId('sld'), layout: layoutId, slots, sourceBlockIds: [...new Set(blocks)], ai: 'unreviewed' };
    return slide;
  });
  return { origin: 'extractive', slides: featureSlides(slides, template, article) };
}
