import { imageRightsRecord, normalizeImageRef } from './asset.ts';
import type { AssetLookup, ImageRef, ImageRightsRecord } from './asset.ts';
import type { AssetId, BlockId } from './ids.ts';
import type { SourceRef, TextRange } from './refs.ts';
import { ok, refuse } from './result.ts';
import type { Result } from './result.ts';
import { contentHash } from './text/hash.ts';
import { textStats } from './text/stats.ts';
import type { TextStats } from './text/stats.ts';

/**
 * Article body as DOMAIN BLOCKS (not TipTap JSON): portable to a CMS, diffable per block,
 * testable without ProseMirror. Block ids are stable across versions.
 */

export type InlineMark = 'bold' | 'italic' | 'underline' | 'strike' | 'link';

/** Canonical mark order used when normalising and hashing. */
export const INLINE_MARKS: readonly InlineMark[] = ['bold', 'italic', 'underline', 'strike', 'link'];

/** A run of text with the same formatting. `href` is present exactly when `marks` has `link`. */
export type Inline = { text: string; marks?: InlineMark[]; href?: string };

export type AiReviewState = 'unreviewed' | 'reviewed';

type BlockBase = {
  id: BlockId;
  /** Evidence this block is based on (transcript segments now; URLs/quotes/media later). */
  sourceRefs?: SourceRef[];
  /** Present on AI-written blocks until a person reviews them (check "Blocos da IA revisados"). */
  ai?: AiReviewState;
};

export type ParagraphBlock = BlockBase & { type: 'paragraph'; inlines: Inline[] };
export type HeadingBlock = BlockBase & { type: 'heading'; level: 2 | 3; inlines: Inline[] };
export type QuoteBlock = BlockBase & { type: 'quote'; inlines: Inline[] };
export type ListBlock = BlockBase & { type: 'list'; ordered: boolean; items: Inline[][] };
export type DividerBlock = BlockBase & { type: 'divider' };
/**
 * An image inside the body, with its caption (credit lives on the asset). Figures are blocks for
 * ids, outline and diff, but have no text: word counts, quotes and text ranges ignore them.
 */
export type FigureBlock = BlockBase & { type: 'figure'; image: ImageRef };

export type ArticleBlock = ParagraphBlock | HeadingBlock | QuoteBlock | ListBlock | DividerBlock | FigureBlock;
export type ArticleBlockType = ArticleBlock['type'];
export type InlineBlock = ParagraphBlock | HeadingBlock | QuoteBlock;

export type ArticleBody = {
  type: 'article';
  title: string;
  blocks: ArticleBlock[];
  /** "Imagem de destaque" (16:9, above the title). Absent on articles without one. */
  cover?: ImageRef;
};

/**
 * Pseudo block id that addresses the cover in check targets and diffs (like `title`). Real block
 * ids are generated with a prefix, so they never collide with it.
 */
export const COVER_BLOCK_ID = 'cover';

/** Separator between list items in `blockText`, so text ranges can address list items. */
export const LIST_ITEM_SEPARATOR = '\n';

export function hasInlines(block: ArticleBlock): block is InlineBlock {
  return block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote';
}

export function inlinesText(inlines: readonly Inline[]): string {
  return inlines.map((inline) => inline.text).join('');
}

/** Plain text of a block; list items are joined with `LIST_ITEM_SEPARATOR`. */
export function blockText(block: ArticleBlock): string {
  if (hasInlines(block)) return inlinesText(block.inlines);
  if (block.type === 'list') return block.items.map(inlinesText).join(LIST_ITEM_SEPARATOR);
  return '';
}

/** Body text without the title, blocks separated by blank lines. */
export function articlePlainText(body: ArticleBody): string {
  return body.blocks
    .map(blockText)
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/** Word count and reading time of the body (title excluded, as editors count it). */
export function articleStats(body: ArticleBody): TextStats {
  return textStats(articlePlainText(body));
}

export function findBlock(body: ArticleBody, blockId: BlockId): ArticleBlock | undefined {
  return body.blocks.find((block) => block.id === blockId);
}

function sortMarks(marks: readonly InlineMark[]): InlineMark[] {
  return INLINE_MARKS.filter((mark) => marks.includes(mark));
}

function sameFormat(a: Inline, b: Inline): boolean {
  const aMarks = a.marks ?? [];
  const bMarks = b.marks ?? [];
  return aMarks.length === bMarks.length && aMarks.every((mark, index) => mark === bMarks[index]) && a.href === b.href;
}

/** Canonical inlines: no empty runs, sorted unique marks, `href` only with `link`, adjacent runs merged. */
export function normalizeInlines(inlines: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    if (!inline.text) continue;
    let marks = sortMarks(inline.marks ?? []);
    if (marks.includes('link') && !inline.href) marks = marks.filter((mark) => mark !== 'link');
    const next: Inline = { text: inline.text };
    if (marks.length > 0) next.marks = marks;
    if (marks.includes('link') && inline.href) next.href = inline.href;
    const last = out[out.length - 1];
    if (last && sameFormat(last, next)) last.text += next.text;
    else out.push(next);
  }
  return out;
}

function normalizeBlock(block: ArticleBlock): ArticleBlock {
  if (hasInlines(block)) return { ...block, inlines: normalizeInlines(block.inlines) };
  if (block.type === 'list') return { ...block, items: block.items.map(normalizeInlines) };
  if (block.type === 'figure') return { ...block, image: normalizeImageRef(block.image) };
  return block;
}

export function normalizeArticle(body: ArticleBody): ArticleBody {
  const out: ArticleBody = { type: 'article', title: body.title.trim(), blocks: body.blocks.map(normalizeBlock) };
  if (body.cover) out.cover = normalizeImageRef(body.cover);
  return out;
}

function imageKey(image: ImageRef): [AssetId, string, string] {
  return [image.assetId, image.alt ?? '', image.caption ?? ''];
}

/**
 * Hash of the publishable content only: title, cover, block structure, text, marks, links and
 * images (asset, alt, caption). Block ids, AI review flags and source refs are provenance, so they
 * don't change the hash; restoring a version therefore reproduces the exact hash of the restored
 * content. The cover enters only when present, so articles without images keep their hashes.
 */
export function articleHash(body: ArticleBody): string {
  const normalized = normalizeArticle(body);
  const inlinesKey = (inlines: Inline[]) => inlines.map((inline) => [inline.text, inline.marks ?? [], inline.href ?? '']);
  return contentHash({
    title: normalized.title,
    cover: normalized.cover ? imageKey(normalized.cover) : undefined,
    blocks: normalized.blocks.map((block) => {
      switch (block.type) {
        case 'heading':
          return { type: block.type, level: block.level, inlines: inlinesKey(block.inlines) };
        case 'paragraph':
        case 'quote':
          return { type: block.type, inlines: inlinesKey(block.inlines) };
        case 'list':
          return { type: block.type, ordered: block.ordered, items: block.items.map(inlinesKey) };
        case 'divider':
          return { type: block.type };
        case 'figure':
          return { type: block.type, image: imageKey(block.image) };
      }
    }),
  });
}

/** Inlines between two offsets, formatting preserved. */
export function sliceInlines(inlines: readonly Inline[], from: number, to: number): Inline[] {
  const out: Inline[] = [];
  let offset = 0;
  for (const inline of inlines) {
    const start = offset;
    const end = offset + inline.text.length;
    offset = end;
    const sliceStart = Math.max(from, start);
    const sliceEnd = Math.min(to, end);
    if (sliceStart >= sliceEnd) continue;
    out.push({ ...inline, text: inline.text.slice(sliceStart - start, sliceEnd - start) });
  }
  return out;
}

function inlineAt(inlines: readonly Inline[], offset: number): Inline | undefined {
  let position = 0;
  for (const inline of inlines) {
    const end = position + inline.text.length;
    if (offset >= position && offset < end) return inline;
    position = end;
  }
  return undefined;
}

/**
 * Replaces `[from, to)` inside a run of inlines. Inserted text takes the formatting of the
 * first replaced character (or the character before a caret); a link is extended only when
 * the whole replaced range was inside that link.
 */
export function spliceInlines(inlines: readonly Inline[], from: number, to: number, text: string): Inline[] {
  const total = inlinesText(inlines).length;
  const left = sliceInlines(inlines, 0, from);
  const right = sliceInlines(inlines, to, total);
  const reference = from < to ? inlineAt(inlines, from) : inlineAt(inlines, Math.max(0, from - 1));
  const inserted: Inline = { text };
  if (reference?.marks) {
    const insideOneRun = from < to && sliceInlines(inlines, from, to).length === 1;
    const marks = reference.marks.filter((mark) => mark !== 'link' || insideOneRun);
    if (marks.length > 0) inserted.marks = marks;
    if (marks.includes('link') && reference.href) inserted.href = reference.href;
  }
  return normalizeInlines([...left, inserted, ...right]);
}

export type RangeRefusal = 'unknown_block' | 'no_text' | 'out_of_bounds' | 'spans_list_items';

function validRange(text: string, range: TextRange): boolean {
  return range.from >= 0 && range.to <= text.length && range.from <= range.to;
}

export function sliceText(body: ArticleBody, range: TextRange): string | undefined {
  const block = findBlock(body, range.blockId);
  if (!block) return undefined;
  const text = blockText(block);
  if (!validRange(text, range)) return undefined;
  return text.slice(range.from, range.to);
}

/** Replaces the text of one range, keeping the rest of the block (and its formatting) intact. */
export function replaceTextRange(body: ArticleBody, range: TextRange, text: string): Result<ArticleBody, RangeRefusal> {
  const index = body.blocks.findIndex((block) => block.id === range.blockId);
  if (index < 0) return refuse('unknown_block', 'O trecho não existe mais no texto.');
  const block = body.blocks[index];
  const current = blockText(block);
  if (block.type === 'divider' || block.type === 'figure') return refuse('no_text', 'Este bloco não tem texto.');
  if (!validRange(current, range)) return refuse('out_of_bounds', 'O trecho selecionado mudou.');

  let next: ArticleBlock;
  if (block.type === 'list') {
    let start = 0;
    const itemIndex = block.items.findIndex((item) => {
      const end = start + inlinesText(item).length;
      if (range.from >= start && range.to <= end) return true;
      start = end + LIST_ITEM_SEPARATOR.length;
      return false;
    });
    if (itemIndex < 0) return refuse('spans_list_items', 'Selecione um item da lista por vez.');
    const items = block.items.map((item, position) =>
      position === itemIndex ? spliceInlines(item, range.from - start, range.to - start, text) : item,
    );
    next = { ...block, items };
  } else {
    next = { ...block, inlines: spliceInlines(block.inlines, range.from, range.to, text) };
  }
  const blocks = body.blocks.slice();
  blocks[index] = next;
  return ok({ ...body, blocks });
}

export function unreviewedAiBlockIds(body: ArticleBody): BlockId[] {
  return body.blocks.filter((block) => block.ai === 'unreviewed').map((block) => block.id);
}

export function aiBlockIds(body: ArticleBody): BlockId[] {
  return body.blocks.filter((block) => block.ai !== undefined).map((block) => block.id);
}

export function markBlocksReviewed(body: ArticleBody, blockIds: readonly BlockId[]): ArticleBody {
  const ids = new Set(blockIds);
  return {
    ...body,
    blocks: body.blocks.map((block) => (ids.has(block.id) && block.ai === 'unreviewed' ? { ...block, ai: 'reviewed' } : block)),
  };
}

/** Every link in the body, with the block it lives in. */
export function articleLinks(body: ArticleBody): { blockId: BlockId; href: string; text: string }[] {
  const links: { blockId: BlockId; href: string; text: string }[] = [];
  for (const block of body.blocks) {
    const runs = hasInlines(block) ? block.inlines : block.type === 'list' ? block.items.flat() : [];
    for (const inline of runs) {
      if (inline.marks?.includes('link')) links.push({ blockId: block.id, href: inline.href ?? '', text: inline.text });
    }
  }
  return links;
}

type BlockOptions = { sourceRefs?: SourceRef[]; ai?: AiReviewState };

function withOptions<B extends ArticleBlock>(block: B, options: BlockOptions = {}): B {
  const out = { ...block };
  if (options.sourceRefs && options.sourceRefs.length > 0) out.sourceRefs = options.sourceRefs;
  if (options.ai) out.ai = options.ai;
  return out;
}

function plain(text: string): Inline[] {
  return text ? [{ text }] : [];
}

export function paragraphBlock(id: BlockId, text: string | Inline[], options?: BlockOptions): ParagraphBlock {
  const inlines = typeof text === 'string' ? plain(text) : normalizeInlines(text);
  return withOptions({ id, type: 'paragraph', inlines }, options);
}

export function headingBlock(id: BlockId, text: string, level: 2 | 3 = 2, options?: BlockOptions): HeadingBlock {
  return withOptions({ id, type: 'heading', level, inlines: plain(text) }, options);
}

export function quoteBlock(id: BlockId, text: string, options?: BlockOptions): QuoteBlock {
  return withOptions({ id, type: 'quote', inlines: plain(text) }, options);
}

export function listBlock(id: BlockId, items: string[], ordered = false, options?: BlockOptions): ListBlock {
  return withOptions({ id, type: 'list', ordered, items: items.map(plain) }, options);
}

export function dividerBlock(id: BlockId): DividerBlock {
  return { id, type: 'divider' };
}

export function figureBlock(id: BlockId, image: ImageRef, options?: BlockOptions): FigureBlock {
  return withOptions({ id, type: 'figure', image: normalizeImageRef(image) }, options);
}

/** True for blocks that carry text (everything but dividers and figures). */
export function hasText(block: ArticleBlock): boolean {
  return block.type !== 'divider' && block.type !== 'figure';
}

export type ArticleImageUse = {
  role: 'cover' | 'figure';
  /** The figure block, or `COVER_BLOCK_ID`. */
  blockId: BlockId;
  image: ImageRef;
};

/** Every image the article uses, in reading order: the cover first, then the figures. */
export function articleImages(body: ArticleBody): ArticleImageUse[] {
  const uses: ArticleImageUse[] = [];
  if (body.cover) uses.push({ role: 'cover', blockId: COVER_BLOCK_ID, image: body.cover });
  for (const block of body.blocks) {
    if (block.type === 'figure') uses.push({ role: 'figure', blockId: block.id, image: block.image });
  }
  return uses;
}

/** Distinct asset ids used by the article (cover first). */
export function articleAssetIds(body: ArticleBody): AssetId[] {
  return [...new Set(articleImages(body).map((use) => use.image.assetId))];
}

/** Credit and rights of every image the article uses, as they stand now (kept with an approval). */
export function articleImageRights(body: ArticleBody, assets: AssetLookup): ImageRightsRecord[] {
  return articleAssetIds(body).flatMap((assetId) => {
    const asset = assets(assetId);
    return asset ? [imageRightsRecord(asset)] : [];
  });
}

/** Sets or removes ("Remover imagem de destaque") the cover. */
export function setCover(body: ArticleBody, cover: ImageRef | undefined): ArticleBody {
  const next: ArticleBody = { ...body };
  if (cover) next.cover = normalizeImageRef(cover);
  else delete next.cover;
  return next;
}

export function emptyArticle(title = ''): ArticleBody {
  return { type: 'article', title, blocks: [] };
}
