import { blockText, COVER_BLOCK_ID } from './article.ts';
import type { ArticleBlock, ArticleBlockType, ArticleBody, Inline } from './article.ts';
import { creditLine } from './asset.ts';
import type { AssetLookup, ImageRef } from './asset.ts';
import { findLayout, slideText } from './carousel.ts';
import type { CarouselBody, CarouselTemplate } from './carousel.ts';
import { diffSequence, diffWords, wordSimilarity } from './text/diff.ts';
import type { DiffHunk } from './text/diff.ts';
import { words } from './text/stats.ts';

/**
 * Version comparison as DiffBlock[] for the DS DiffView (inline: underline + strikethrough,
 * plus text for screen readers). Blocks are aligned by stable id; regenerated blocks with new
 * ids are paired by word similarity so a rewrite reads as "modified", not delete + add.
 */

export type DiffChange = 'added' | 'removed' | 'modified' | 'unchanged';

export type DiffBlock = {
  id: string;
  change: DiffChange;
  hunks: DiffHunk[];
  /** Block type after the change (before, for removed blocks); `title`/`cover`/`slide` for non-blocks. */
  blockType: ArticleBlockType | 'title' | 'cover' | 'slide';
  level?: 2 | 3;
  /** True when only formatting/type (or an image's alt text) changed and the text is identical. */
  formatOnly?: boolean;
  /** Figures and the cover: the image after the change (before, for removed ones). */
  image?: ImageRef;
  /** Modified figure or cover whose image itself was swapped: the image before. */
  previousImage?: ImageRef;
};

export type ArticleDiffOptions = {
  /** Asset metadata, for the credit in the text of figures ("[Imagem] Legenda — Foto: Crédito"). */
  assets?: AssetLookup;
  /**
   * The images of `before` as they were then (an approved version reads its approval snapshot,
   * see `withApprovedRights`), so a credit or authorisation changed since reads as a change.
   * Default: `assets`.
   */
  beforeAssets?: AssetLookup;
};

/** Pairs a deleted and an inserted block as one modification above this similarity. */
export const PAIRING_SIMILARITY = 0.5;

const TITLE_ID = 'title';

/**
 * Text a figure or the cover reads as in a comparison: "[Imagem] Legenda — Foto: Crédito", with
 * "· uso não autorizado" when the image is not cleared (so a change of either reads as a change).
 */
export function imageDiffText(image: ImageRef, assets?: AssetLookup, label = '[Imagem]'): string {
  const caption = image.caption?.trim();
  const asset = assets?.(image.assetId);
  const credit = creditLine(asset?.credit);
  const text = [caption ? `${label} ${caption}` : label, credit].filter(Boolean).join(' — ');
  return asset && !asset.rights.authorized ? `${text} · uso não autorizado` : text;
}

/** Text of a block as the comparison shows it (figures included). */
function diffText(block: ArticleBlock, assets?: AssetLookup): string {
  return block.type === 'figure' ? imageDiffText(block.image, assets) : blockText(block);
}

function signature(block: ArticleBlock, assets?: AssetLookup): string {
  if (block.type === 'figure') return JSON.stringify([block.type, block.image.assetId, block.image.alt ?? '', diffText(block, assets)]);
  const runs = (inlines: Inline[]) => inlines.map((inline) => [inline.text, inline.marks ?? [], inline.href ?? '']);
  switch (block.type) {
    case 'heading':
      return JSON.stringify([block.type, block.level, runs(block.inlines)]);
    case 'paragraph':
    case 'quote':
      return JSON.stringify([block.type, runs(block.inlines)]);
    case 'list':
      return JSON.stringify([block.type, block.ordered, block.items.map(runs)]);
    case 'divider':
      return block.type;
  }
}

function base(block: ArticleBlock): Pick<DiffBlock, 'blockType' | 'level' | 'image'> {
  if (block.type === 'heading') return { blockType: block.type, level: block.level };
  if (block.type === 'figure') return { blockType: block.type, image: block.image };
  return { blockType: block.type };
}

type Emit = {
  unchanged(block: ArticleBlock): DiffBlock;
  added(block: ArticleBlock): DiffBlock;
  removed(block: ArticleBlock): DiffBlock;
  modified(before: ArticleBlock, after: ArticleBlock): DiffBlock;
  compare(before: ArticleBlock, after: ArticleBlock): DiffBlock;
  similarity(a: ArticleBlock, b: ArticleBlock): number;
};

/**
 * Block-level diff builders bound to the asset lookups (figures read their credit from them):
 * blocks of the older version read `before`, blocks of the newer one `after`.
 */
function emitters(after?: AssetLookup, before: AssetLookup | undefined = after): Emit {
  const text = (block: ArticleBlock) => diffText(block, after);
  const textBefore = (block: ArticleBlock) => diffText(block, before);
  const emit: Emit = {
    unchanged(block) {
      const value = text(block);
      return { id: block.id, change: 'unchanged', hunks: value ? [{ kind: 'equal', text: value }] : [], ...base(block) };
    },
    added(block) {
      const value = text(block);
      return { id: block.id, change: 'added', hunks: value ? [{ kind: 'insert', text: value }] : [], ...base(block) };
    },
    removed(block) {
      const value = textBefore(block);
      return { id: block.id, change: 'removed', hunks: value ? [{ kind: 'delete', text: value }] : [], ...base(block) };
    },
    modified(older, newer) {
      const beforeText = textBefore(older);
      const afterText = text(newer);
      const block: DiffBlock = { id: newer.id, change: 'modified', hunks: diffWords(beforeText, afterText), ...base(newer) };
      const swapped = older.type === 'figure' && (newer.type !== 'figure' || newer.image.assetId !== older.image.assetId);
      if (swapped) block.previousImage = older.image;
      if (beforeText === afterText && !swapped) block.formatOnly = true;
      return block;
    },
    compare(older, newer) {
      return signature(older, before) === signature(newer, after) ? emit.unchanged(newer) : emit.modified(older, newer);
    },
    similarity(a, b) {
      if (a.type === 'divider' || b.type === 'divider') return a.type === b.type ? 1 : 0;
      if (a.type === 'figure' || b.type === 'figure') {
        if (a.type !== b.type) return 0;
        if (a.type === 'figure' && b.type === 'figure' && a.image.assetId === b.image.assetId) return 1;
      }
      return wordSimilarity(words(textBefore(a).toLowerCase()), words(text(b).toLowerCase()));
    },
  };
  return emit;
}

/** Emits a run of deletions/insertions between two aligned anchors, pairing similar blocks. */
function emitRun(deleted: ArticleBlock[], inserted: ArticleBlock[], out: DiffBlock[], emit: Emit): void {
  let next = 0;
  for (const before of deleted) {
    let match = -1;
    for (let candidate = next; candidate < inserted.length; candidate += 1) {
      if (emit.similarity(before, inserted[candidate]) >= PAIRING_SIMILARITY) {
        match = candidate;
        break;
      }
    }
    if (match < 0) {
      out.push(emit.removed(before));
      continue;
    }
    for (; next < match; next += 1) out.push(emit.added(inserted[next]));
    out.push(emit.modified(before, inserted[match]));
    next = match + 1;
  }
  for (; next < inserted.length; next += 1) out.push(emit.added(inserted[next]));
}

const COVER_LABEL = '[Imagem de destaque]';

/** The cover as one comparison entry (id `cover`), when either version has one. */
function diffCover(before: ImageRef | undefined, after: ImageRef | undefined, assets?: AssetLookup, beforeAssets: AssetLookup | undefined = assets): DiffBlock | undefined {
  if (!before && !after) return undefined;
  const beforeText = before ? imageDiffText(before, beforeAssets, COVER_LABEL) : '';
  const afterText = after ? imageDiffText(after, assets, COVER_LABEL) : '';
  if (!before) return { id: COVER_BLOCK_ID, change: 'added', hunks: [{ kind: 'insert', text: afterText }], blockType: 'cover', image: after };
  if (!after) return { id: COVER_BLOCK_ID, change: 'removed', hunks: [{ kind: 'delete', text: beforeText }], blockType: 'cover', image: before };
  const swapped = before.assetId !== after.assetId;
  const same = !swapped && beforeText === afterText && (before.alt ?? '') === (after.alt ?? '');
  if (same) return { id: COVER_BLOCK_ID, change: 'unchanged', hunks: [{ kind: 'equal', text: afterText }], blockType: 'cover', image: after };
  const block: DiffBlock = { id: COVER_BLOCK_ID, change: 'modified', hunks: diffWords(beforeText, afterText), blockType: 'cover', image: after };
  if (swapped) block.previousImage = before;
  else if (beforeText === afterText) block.formatOnly = true;
  return block;
}

export function diffArticles(before: ArticleBody, after: ArticleBody, options: ArticleDiffOptions = {}): DiffBlock[] {
  const emit = emitters(options.assets, options.beforeAssets ?? options.assets);
  const out: DiffBlock[] = [];
  const titleBefore = before.title.trim();
  const titleAfter = after.title.trim();
  if (titleBefore || titleAfter) {
    out.push(
      titleBefore === titleAfter
        ? { id: TITLE_ID, change: 'unchanged', hunks: [{ kind: 'equal', text: titleAfter }], blockType: 'title' }
        : {
            id: TITLE_ID,
            change: !titleBefore ? 'added' : !titleAfter ? 'removed' : 'modified',
            hunks: diffWords(titleBefore, titleAfter),
            blockType: 'title',
          },
    );
  }
  const cover = diffCover(before.cover, after.cover, options.assets, options.beforeAssets ?? options.assets);
  if (cover) out.push(cover);

  const ops = diffSequence(before.blocks, after.blocks, (a, b) => a.id === b.id);
  let deleted: ArticleBlock[] = [];
  let inserted: ArticleBlock[] = [];
  const flush = () => {
    emitRun(deleted, inserted, out, emit);
    deleted = [];
    inserted = [];
  };
  for (const op of ops) {
    if (op.kind === 'delete') deleted.push(...before.blocks.slice(op.aStart, op.aStart + op.length));
    else if (op.kind === 'insert') inserted.push(...after.blocks.slice(op.bStart, op.bStart + op.length));
    else {
      flush();
      for (let offset = 0; offset < op.length; offset += 1) {
        out.push(emit.compare(before.blocks[op.aStart + offset], after.blocks[op.bStart + offset]));
      }
    }
  }
  flush();
  return out;
}

/** Slide-by-slide comparison (aligned by slide id), for the carousel review. */
export function diffCarousels(before: CarouselBody, after: CarouselBody, template?: CarouselTemplate): DiffBlock[] {
  const text = (body: CarouselBody, index: number) => slideText(body.slides[index], findLayout(template, body.slides[index].layout));
  const out: DiffBlock[] = [];
  for (const op of diffSequence(before.slides, after.slides, (a, b) => a.id === b.id)) {
    for (let offset = 0; offset < op.length; offset += 1) {
      if (op.kind === 'insert') {
        const index = op.bStart + offset;
        out.push({ id: after.slides[index].id, change: 'added', hunks: [{ kind: 'insert', text: text(after, index) }], blockType: 'slide' });
      } else if (op.kind === 'delete') {
        const index = op.aStart + offset;
        out.push({ id: before.slides[index].id, change: 'removed', hunks: [{ kind: 'delete', text: text(before, index) }], blockType: 'slide' });
      } else {
        const a = text(before, op.aStart + offset);
        const b = text(after, op.bStart + offset);
        const id = after.slides[op.bStart + offset].id;
        const layoutChanged = before.slides[op.aStart + offset].layout !== after.slides[op.bStart + offset].layout;
        if (a === b && !layoutChanged) out.push({ id, change: 'unchanged', hunks: [{ kind: 'equal', text: b }], blockType: 'slide' });
        else {
          const block: DiffBlock = { id, change: 'modified', hunks: diffWords(a, b), blockType: 'slide' };
          if (a === b) block.formatOnly = true;
          out.push(block);
        }
      }
    }
  }
  return out;
}

/** Counts per change kind, for "3 alterações" summaries. */
export function diffSummary(blocks: readonly DiffBlock[]): Record<DiffChange, number> {
  const summary: Record<DiffChange, number> = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const block of blocks) summary[block.change] += 1;
  return summary;
}

