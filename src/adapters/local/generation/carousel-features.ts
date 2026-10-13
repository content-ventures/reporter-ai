import { blockText } from '../../../domain/article.ts';
import type { ArticleBlock, ArticleBody } from '../../../domain/article.ts';
import { findLayout } from '../../../domain/carousel.ts';
import type { CarouselTemplate, Slide, SlideLayout, SlotRole } from '../../../domain/carousel.ts';
import type { BlockId } from '../../../domain/ids.ts';
import { fitSentences, sentences, titlePhrase } from '../../../domain/text/slide-text.ts';
import { capitalize, cutAtWord, withoutFinalPeriod } from './sentences.ts';

/**
 * Featured layouts of a template (`featuredLayouts`): after the plan is written, a "Ponto
 * principal" whose material allows it becomes a `data` slide (a figure of its text set large) or
 * a `list` slide (an article list, or an enumeration "…: a, b e c" of its paragraph). Like the
 * rest of the plan it only selects and cuts the article's words. Without the material the slide
 * stays a point; at most one slide per featured layout.
 */

/** A figure: a number with its unit ("38%", "+41%", "1.100", "R$ 2,5 milhões", "9 mil"). */
const FIGURE = /(?<![\p{L}\p{N}])([+−-]?(?:R\$\s?)?\d{1,3}(?:\.\d{3})+(?:,\d+)?|[+−-]?(?:R\$\s?)?\d+(?:,\d+)?)(\s?%|\s(?:mil|milhão|milhões|bilhão|bilhões)(?![\p{L}]))?/gu;

export type Figure = { stat: string; sentence: string; body: string; score: number };

/**
 * The most telling figure of a text within `maxChars`: a percentage, then a magnitude ("9 mil"),
 * then a number of two digits or more. A year ("2015") or a lone digit is not a figure. The
 * body is the rest of the sentence when the figure opens it ("38% do faturamento…" → "do
 * faturamento…"), else the whole sentence.
 */
export function findFigure(text: string, maxChars: number): Figure | undefined {
  let best: Figure | undefined;
  for (const sentence of sentences(text)) {
    for (const match of sentence.matchAll(FIGURE)) {
      const [whole, number, unit] = match;
      const digits = number.replace(/\D/g, '');
      const year = !unit && /^(19|20)\d{2}$/.test(digits);
      const score = unit?.includes('%') ? 3 : unit ? 2 : digits.length >= 2 && !year ? 1 : 0;
      const stat = whole.replace(/\s+/g, ' ').trim();
      if (score === 0 || stat.length > maxChars) continue;
      const at = match.index ?? 0;
      const opens = sentence.slice(0, at).trim() === '';
      const rest = opens ? sentence.slice(at + whole.length).trim() : '';
      const body = rest && /^\p{Ll}/u.test(rest) ? rest : sentence;
      if (!best || score > best.score) best = { stat, sentence, body, score };
    }
  }
  return best;
}

export type Enumeration = { head: string; items: string[] };

/**
 * "A ferramenta passou a ajudar em três frentes: cria…, compara… e gera…" → head and three
 * items. Three items or more, none too long for a line of a list slide.
 */
export function findEnumeration(text: string, maxItem = 64): Enumeration | undefined {
  for (const sentence of sentences(text)) {
    const colon = sentence.indexOf(': ');
    if (colon < 8) continue;
    const head = sentence.slice(0, colon).trim();
    const tail = withoutFinalPeriod(sentence.slice(colon + 2));
    const parts = tail.split(/,\s+|;\s+/);
    const last = parts.pop() ?? '';
    const split = last.split(/\s+e\s+(?=\S)/);
    const items = [...parts, ...(split.length > 1 ? [split.slice(0, -1).join(' e '), split[split.length - 1]] : [last])]
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length >= 3 && items.every((item) => item.length <= maxItem && item.split(/\s+/).length >= 2)) {
      return { head, items: items.map((item) => capitalize(item)) };
    }
  }
  return undefined;
}

const slotOf = (layout: SlideLayout, role: SlotRole) => layout.slots.find((slot) => slot.role === role);

function itemsText(items: readonly string[], maxChars: number, maxItems: number): string | undefined {
  const kept: string[] = [];
  for (const item of items.slice(0, maxItems)) {
    const next = [...kept, item].join('\n');
    if (next.length > maxChars) break;
    kept.push(item);
  }
  return kept.length >= 3 ? kept.join('\n') : undefined;
}

function blocksOf(article: ArticleBody, ids: readonly BlockId[]): ArticleBlock[] {
  return ids.map((id) => article.blocks.find((block) => block.id === id)).filter((block): block is ArticleBlock => Boolean(block));
}

function asData(slide: Slide, layout: SlideLayout, article: ArticleBody): Slide | undefined {
  const stat = slotOf(layout, 'stat');
  const body = slotOf(layout, 'body');
  if (!stat || !body) return undefined;
  const text = slide.slots.body ?? blocksOf(article, slide.sourceBlockIds).filter((block) => block.type === 'paragraph').map(blockText).join(' ');
  const figure = text ? findFigure(text, stat.maxChars) : undefined;
  if (!figure) return undefined;
  const slots: Record<string, string> = { [stat.id]: figure.stat, [body.id]: fitSentences(figure.body, body.maxChars) };
  const title = slotOf(layout, 'title');
  if (title && slide.slots.title) slots[title.id] = titlePhrase(slide.slots.title, title.maxChars);
  return { ...slide, layout: layout.id, slots };
}

/** The heading of the section a block belongs to. */
function headingOf(article: ArticleBody, id: BlockId): string | undefined {
  let heading: string | undefined;
  for (const block of article.blocks) {
    if (block.id === id) return heading;
    if (block.type === 'heading') heading = blockText(block);
  }
  return undefined;
}

function asList(slide: Slide, layout: SlideLayout, article: ArticleBody, taken: ReadonlySet<BlockId>): Slide | undefined {
  const items = slotOf(layout, 'list');
  if (!items) return undefined;
  const own = blocksOf(article, slide.sourceBlockIds);
  const free = article.blocks.filter((block) => !taken.has(block.id));
  const candidates = [...own, ...free.filter((block) => !own.includes(block))];
  const rows = Math.max(3, items.maxLines ?? 6);
  for (const block of candidates) {
    let found: { head?: string; items: string[] } | undefined;
    if (block.type === 'list') found = { items: block.items.map((item) => capitalize(withoutFinalPeriod(item.map((inline) => inline.text).join('')))) };
    else if (block.type === 'paragraph') found = findEnumeration(blockText(block));
    const text = found ? itemsText(found.items.map((item) => cutAtWord(item, 64).text), items.maxChars, rows) : undefined;
    if (!found || !text) continue;
    const slots: Record<string, string> = { [items.id]: text };
    const title = slotOf(layout, 'title');
    // The slide's own title when the list comes from its own material; else the list's lead or section.
    const mine = own.includes(block);
    const heading = (mine ? slide.slots.title : undefined) ?? found.head ?? headingOf(article, block.id);
    if (title && heading) slots[title.id] = titlePhrase(heading, title.maxChars);
    const sourceBlockIds = mine ? slide.sourceBlockIds : [block.id];
    return { ...slide, layout: layout.id, slots, sourceBlockIds };
  }
  return undefined;
}

/** The plan with the template's featured layouts placed where the article has the material. */
export function featureSlides(slides: readonly Slide[], template: CarouselTemplate, article: ArticleBody): Slide[] {
  const out = [...slides];
  for (const featured of template.featuredLayouts ?? []) {
    const layout = findLayout(template, featured);
    if (!layout) continue;
    const order = [...out.keys()].filter((at) => out[at].layout === 'point').concat([...out.keys()].filter((at) => out[at].layout === 'context'));
    for (const at of featured === 'list' ? order.filter((index) => out[index].layout === 'point') : order) {
      const taken = new Set(out.filter((_, index) => index !== at).flatMap((slide) => slide.sourceBlockIds));
      const next = featured === 'data' ? asData(out[at], layout, article) : featured === 'list' ? asList(out[at], layout, article, taken) : undefined;
      if (next) {
        out[at] = next;
        break;
      }
    }
  }
  return out;
}
