import { normalizeImageRef, normalizeInlines, normalizeLink } from '../domain/index.ts';
import type { AiReviewState, ArticleBlock, ArticleBody, AssetId, BlockId, ImageRef, Inline, InlineMark, SourceRef } from '../domain/index.ts';
import { BLOCK_ATTR, DOC_ATTR, FIGURE_ATTR, MARK, NODE } from './schema.ts';

/**
 * Pure converters between the domain `ArticleBody` (blocks, inlines, marks, sourceRefs, ai) and
 * ProseMirror JSON. No TipTap import: the studio, the review previews and the tests share them.
 *
 * Mapping
 * - paragraph ⇄ `paragraph`; heading ⇄ `heading{level 2|3}`; quote ⇄ `blockquote` (textblock);
 *   list ⇄ `bulletList|orderedList > listItem > paragraph`; divider ⇄ `horizontalRule`.
 * - `\n` inside an inline ⇄ `hardBreak` carrying the run's marks (offsets stay 1:1).
 * - Block `id`, `sourceRefs` and `ai` travel as node attrs (`blockId`, `sourceRefs`, `ai`).
 * - Links keep only safe hrefs (`normalizeLink`); an unsafe link loses the link mark, not the text.
 * - figure ⇄ `figure` (atom) with the `ImageRef` as `assetId`/`alt`/`caption` attrs; `credit`,
 *   `src`, `width` and `height` are display only (from `figureSources`), never read back. A figure
 *   without an asset (an image pasted from another page, not adopted yet) is not content.
 * - `cover` ⇄ the `cover` attribute of the document node (not a node: it is not in the text flow).
 */

export type PmMarkJSON = { type: string; attrs?: Record<string, unknown> };

export type PmNodeJSON = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNodeJSON[];
  marks?: PmMarkJSON[];
  text?: string;
};

export type BlockAttrs = { blockId: BlockId | null; sourceRefs: SourceRef[] | null; ai: AiReviewState | null };

/** Schema mark order (TipTap ranks link first); JSON built here matches `editor.getJSON()`. */
const PM_MARK_ORDER: readonly InlineMark[] = ['link', 'bold', 'italic', 'strike', 'underline'];

const DOMAIN_MARKS: Record<string, InlineMark> = {
  [MARK.bold]: 'bold',
  [MARK.italic]: 'italic',
  [MARK.underline]: 'underline',
  [MARK.strike]: 'strike',
  [MARK.link]: 'link',
};

export function blockAttrs(block: Pick<ArticleBlock, 'id' | 'sourceRefs' | 'ai'>): BlockAttrs {
  return {
    blockId: block.id,
    sourceRefs: block.sourceRefs && block.sourceRefs.length > 0 ? [...block.sourceRefs] : null,
    ai: block.ai ?? null,
  };
}

export const EMPTY_BLOCK_ATTRS: BlockAttrs = { blockId: null, sourceRefs: null, ai: null };

// ——— Images ———

/** What the editor shows for an asset: display only, never persisted. */
export type FigureDisplay = { src?: string; credit?: string; width?: number; height?: number };

/** Display data per asset (object URL of the stored file or the link, credit, size). */
export type FigureSources = ReadonlyMap<AssetId, FigureDisplay>;

/** Attributes of a `figure` node (besides the block attributes). */
export type FigureAttrs = {
  assetId: AssetId | null;
  alt: string | null;
  caption: string | null;
  credit: string | null;
  src: string | null;
  width: number | null;
  height: number | null;
};

export const EMPTY_FIGURE_ATTRS: FigureAttrs = { assetId: null, alt: null, caption: null, credit: null, src: null, width: null, height: null };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function size(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** `ImageRef` (+ display data) → figure attributes; empty alt/caption become `null`. */
export function figureAttrs(image: Partial<ImageRef>, display: FigureDisplay = {}): FigureAttrs {
  return {
    assetId: text(image.assetId),
    alt: text(image.alt),
    caption: text(image.caption),
    credit: text(display.credit),
    src: text(display.src),
    width: size(display.width),
    height: size(display.height),
  };
}

/**
 * A normalised `ImageRef` (only its own keys, domain `normalizeImageRef`) read from figure attrs
 * or a stored cover; `null` without an asset.
 */
export function readImageRef(value: unknown): ImageRef | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const assetId = text(record[FIGURE_ATTR.assetId]);
  if (!assetId) return null;
  return normalizeImageRef({ assetId, alt: text(record[FIGURE_ATTR.alt]) ?? undefined, caption: text(record[FIGURE_ATTR.caption]) ?? undefined });
}

function marksJSON(inline: Inline): PmMarkJSON[] | undefined {
  const marks = inline.marks ?? [];
  const out: PmMarkJSON[] = [];
  for (const mark of PM_MARK_ORDER) {
    if (!marks.includes(mark)) continue;
    if (mark === 'link') {
      if (inline.href) out.push({ type: MARK.link, attrs: { href: inline.href } });
    } else {
      out.push({ type: MARK[mark] });
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Inline runs → text and hard-break nodes. */
export function inlinesToJSON(inlines: readonly Inline[]): PmNodeJSON[] {
  const out: PmNodeJSON[] = [];
  for (const inline of inlines) {
    const marks = marksJSON(inline);
    inline.text.split('\n').forEach((segment, index) => {
      if (index > 0) out.push(marks ? { type: NODE.hardBreak, marks } : { type: NODE.hardBreak });
      if (segment) out.push(marks ? { type: NODE.text, text: segment, marks } : { type: NODE.text, text: segment });
    });
  }
  return out;
}

function textblockJSON(type: string, attrs: Record<string, unknown>, inlines: readonly Inline[]): PmNodeJSON {
  const content = inlinesToJSON(inlines);
  return content.length > 0 ? { type, attrs, content } : { type, attrs };
}

export type BlockToJSONOptions = {
  /** Display data of the figures' assets (the read-only views show the image at once). */
  figureSources?: FigureSources;
};

/** One domain block → one top-level ProseMirror node. */
export function blockToJSON(block: ArticleBlock, options: BlockToJSONOptions = {}): PmNodeJSON {
  const attrs = blockAttrs(block);
  switch (block.type) {
    case 'paragraph':
      return textblockJSON(NODE.paragraph, attrs, block.inlines);
    case 'heading':
      return textblockJSON(NODE.heading, { ...attrs, level: block.level }, block.inlines);
    case 'quote':
      return textblockJSON(NODE.quote, attrs, block.inlines);
    case 'list': {
      const items = block.items.length > 0 ? block.items : [[]];
      return {
        type: block.ordered ? NODE.orderedList : NODE.bulletList,
        attrs,
        content: items.map((item) => ({ type: NODE.listItem, content: [textblockJSON(NODE.paragraph, { ...EMPTY_BLOCK_ATTRS }, item)] })),
      };
    }
    case 'divider':
      return { type: NODE.divider, attrs };
    case 'figure':
      return { type: NODE.figure, attrs: { ...attrs, ...figureAttrs(block.image, options.figureSources?.get(block.image.assetId)) } };
  }
}

export type ArticleToDocOptions = BlockToJSONOptions & {
  /** Id for the empty paragraph of an empty body (otherwise the block-id plugin assigns one). */
  emptyBlockId?: BlockId;
};

/**
 * Domain body → ProseMirror document JSON (an empty body becomes one empty paragraph). The cover
 * travels as the document's `cover` attribute (present only when there is one).
 */
export function articleToDoc(body: Pick<ArticleBody, 'blocks' | 'cover'>, options: ArticleToDocOptions = {}): PmNodeJSON {
  const content =
    body.blocks.length > 0
      ? body.blocks.map((block) => blockToJSON(block, options))
      : [{ type: NODE.paragraph, attrs: { ...EMPTY_BLOCK_ATTRS, blockId: options.emptyBlockId ?? null } }];
  const cover = readImageRef(body.cover);
  return cover ? { type: NODE.doc, attrs: { [DOC_ATTR.cover]: cover }, content } : { type: NODE.doc, content };
}

// ——— ProseMirror JSON → domain ———

function readMarks(marks: readonly PmMarkJSON[] | undefined): { marks: InlineMark[]; href?: string } {
  const out: InlineMark[] = [];
  let href: string | undefined;
  for (const mark of marks ?? []) {
    const name = DOMAIN_MARKS[mark.type];
    if (!name) continue;
    if (name === 'link') {
      const normalized = typeof mark.attrs?.href === 'string' ? normalizeLink(mark.attrs.href) : undefined;
      if (!normalized?.ok) continue;
      href = normalized.href;
    }
    out.push(name);
  }
  return href ? { marks: out, href } : { marks: out };
}

/** Inline ProseMirror nodes → normalised domain inlines (`hardBreak` → `\n`). */
export function jsonToInlines(content: readonly PmNodeJSON[] | undefined): Inline[] {
  const inlines: Inline[] = [];
  for (const node of content ?? []) {
    const text = node.type === NODE.text ? (node.text ?? '') : node.type === NODE.hardBreak ? '\n' : '';
    if (!text) continue;
    const { marks, href } = readMarks(node.marks);
    const inline: Inline = { text };
    if (marks.length > 0) inline.marks = marks;
    if (href) inline.href = href;
    inlines.push(inline);
  }
  return normalizeInlines(inlines);
}

function textblocksIn(node: PmNodeJSON): PmNodeJSON[] {
  const found: PmNodeJSON[] = [];
  const visit = (child: PmNodeJSON) => {
    if (child.type === NODE.paragraph || child.type === NODE.heading || child.type === NODE.quote) {
      found.push(child);
      return;
    }
    child.content?.forEach(visit);
  };
  node.content?.forEach(visit);
  return found;
}

/** Several textblocks joined by line breaks (pasted multi-paragraph content, legacy JSON). */
function joinedInlines(blocks: readonly PmNodeJSON[]): Inline[] {
  return normalizeInlines(blocks.flatMap((block, index) => [...(index > 0 ? [{ text: '\n' }] : []), ...jsonToInlines(block.content)]));
}

function plainText(node: PmNodeJSON): string {
  if (node.type === NODE.text) return node.text ?? '';
  if (node.type === NODE.hardBreak) return '\n';
  return (node.content ?? []).map(plainText).join('');
}

function readBlockOptions(attrs: Record<string, unknown> | undefined): Pick<ArticleBlock, 'sourceRefs' | 'ai'> {
  const options: Pick<ArticleBlock, 'sourceRefs' | 'ai'> = {};
  const refs = attrs?.[BLOCK_ATTR.sourceRefs];
  if (Array.isArray(refs) && refs.length > 0) options.sourceRefs = refs as SourceRef[];
  const ai = attrs?.[BLOCK_ATTR.ai];
  if (ai === 'unreviewed' || ai === 'reviewed') options.ai = ai;
  return options;
}

export type DocToArticleOptions = {
  title?: string;
  /**
   * Keep empty paragraphs, headings and quotes. Off by default: the trailing empty paragraph
   * TipTap keeps for the caret is not content, so a draft equal to v1 hashes like v1.
   */
  keepEmpty?: boolean;
  /** Id for a node that has none yet (the block-id plugin normally assigns it first). */
  fallbackId?: (index: number) => BlockId;
};

const defaultFallbackId = (index: number) => `blk-pending-${index}`;

/** One top-level ProseMirror node → one domain block (`null` for an empty textblock). */
export function jsonToBlock(node: PmNodeJSON, index: number, options: DocToArticleOptions = {}): ArticleBlock | null {
  const rawId = node.attrs?.[BLOCK_ATTR.id];
  const id = typeof rawId === 'string' && rawId ? rawId : (options.fallbackId ?? defaultFallbackId)(index);
  const base = { id, ...readBlockOptions(node.attrs) };
  const keep = (inlines: Inline[]) => options.keepEmpty || inlines.length > 0;

  switch (node.type) {
    case NODE.paragraph: {
      const inlines = jsonToInlines(node.content);
      return keep(inlines) ? { ...base, type: 'paragraph', inlines } : null;
    }
    case NODE.heading: {
      const inlines = jsonToInlines(node.content);
      const level: 2 | 3 = Number(node.attrs?.level) >= 3 ? 3 : 2;
      return keep(inlines) ? { ...base, type: 'heading', level, inlines } : null;
    }
    case NODE.quote: {
      const nested = textblocksIn(node);
      const inlines = nested.length > 0 ? joinedInlines(nested) : jsonToInlines(node.content);
      return keep(inlines) ? { ...base, type: 'quote', inlines } : null;
    }
    case NODE.bulletList:
    case NODE.orderedList: {
      const items = (node.content ?? []).flatMap((item) => {
        const lines = textblocksIn(item);
        return lines.length > 0 ? [joinedInlines(lines)] : [[]];
      });
      if (items.length === 0) return null;
      return { ...base, type: 'list', ordered: node.type === NODE.orderedList, items };
    }
    case NODE.divider:
      return { ...base, type: 'divider' };
    case NODE.figure: {
      const image = readImageRef(node.attrs);
      return image ? { ...base, type: 'figure', image } : null;
    }
    default: {
      const text = plainText(node);
      const inlines = normalizeInlines(text ? [{ text }] : []);
      return keep(inlines) ? { ...base, type: 'paragraph', inlines } : null;
    }
  }
}

/** ProseMirror document JSON → domain body (the cover comes from the document attribute). */
export function docToArticle(doc: PmNodeJSON, options: DocToArticleOptions = {}): ArticleBody {
  const blocks: ArticleBlock[] = [];
  (doc.content ?? []).forEach((node, index) => {
    const block = jsonToBlock(node, index, options);
    if (block) blocks.push(block);
  });
  const body: ArticleBody = { type: 'article', title: options.title ?? '', blocks };
  const cover = readImageRef(doc.attrs?.[DOC_ATTR.cover]);
  if (cover) body.cover = cover;
  return body;
}
