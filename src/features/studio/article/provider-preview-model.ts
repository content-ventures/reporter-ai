import { blockText } from '../../../domain/article.ts';
import type { ArticleBlock, ArticleBody } from '../../../domain/article.ts';

function isTextBlock(block: ArticleBlock): boolean {
  return block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' || block.type === 'list';
}

function withText(block: ArticleBlock, text: string): ArticleBlock {
  if (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote') {
    return { ...block, inlines: text ? [{ text }] : [] };
  }
  if (block.type === 'list') {
    return { ...block, items: text.split('\n').map((item) => item ? [{ text: item }] : []) };
  }
  return block;
}

function visiblePrefix(text: string, characters: number): string {
  return Array.from(text).slice(0,characters).join('');
}

/** An empty frame keeps the reviewed article shape while the first received characters animate. */
export function emptyProviderPreview(body: ArticleBody): ArticleBody {
  return { ...body, blocks: body.blocks.map((block) => isTextBlock(block) ? withText(block, '') : block) };
}

/** Advances one short typing tick without ever deleting text already shown to the author. */
export function advanceProviderPreview(visible: ArticleBody, target: ArticleBody, characters = 2): ArticleBody {
  const oldById = new Map(visible.blocks.map((block) => [block.id, block]));
  const oldIndex = new Map(visible.blocks.map((block, index) => [block.id, index]));
  const next: ArticleBlock[] = [];
  const included = new Set<string>();
  let previousCursor = 0;
  let remaining = Math.max(1, Math.floor(characters));
  let waiting = false;
  let changed = visible.title !== target.title || visible.cover !== target.cover || visible.coverSlot !== target.coverSlot;

  const keepMissingBefore = (index: number) => {
    while (previousCursor < index) {
      const missing = visible.blocks[previousCursor++];
      if (!included.has(missing.id)) {
        next.push(missing);
        included.add(missing.id);
      }
    }
  };

  for (const targetBlock of target.blocks) {
    const priorIndex = oldIndex.get(targetBlock.id);
    if (priorIndex !== undefined) keepMissingBefore(priorIndex);
    const previous = oldById.get(targetBlock.id);
    if (!isTextBlock(targetBlock)) {
      next.push(targetBlock);
      included.add(targetBlock.id);
      if (previousCursor <= (priorIndex ?? -1)) previousCursor = (priorIndex ?? -1) + 1;
      if (previous !== targetBlock) changed = true;
      continue;
    }

    const targetText = blockText(targetBlock);
    const previousText = previous && isTextBlock(previous) ? blockText(previous) : '';
    let text = previousText;
    if (targetBlock.type === 'heading') {
      if (!waiting) text = targetText;
    } else if (targetText.startsWith(previousText)) {
      const currentLength = Array.from(previousText).length, targetLength = Array.from(targetText).length;
      if (!waiting && currentLength < targetLength && remaining > 0) {
        const added = Math.min(remaining,targetLength-currentLength);
        text = visiblePrefix(targetText,currentLength+added);
        remaining -= added;
      }
      if (Array.from(text).length < targetLength) waiting = true;
    } else {
      waiting = true;
    }
    const block = withText(targetBlock, text);
    next.push(block);
    included.add(block.id);
    if (previousCursor <= (priorIndex ?? -1)) previousCursor = (priorIndex ?? -1) + 1;
    if (blockText(block) !== previousText || previous?.type !== block.type) changed = true;
  }

  while (previousCursor < visible.blocks.length) {
    const missing = visible.blocks[previousCursor++];
    if (!included.has(missing.id)) {
      next.push(missing);
      included.add(missing.id);
    }
  }
  if (!changed && next.length === visible.blocks.length && next.every((block, index) => block === visible.blocks[index])) return visible;
  return { ...target, blocks: next };
}

/** True while at least one compatible received paragraph still has characters to reveal. */
export function providerPreviewHasMore(visible: ArticleBody, target: ArticleBody): boolean {
  const oldById = new Map(visible.blocks.map((block) => [block.id, block]));
  return target.blocks.some((block) => {
    if (!isTextBlock(block) || block.type === 'heading') return false;
    const targetText = blockText(block);
    const current = oldById.get(block.id);
    const currentText = current && isTextBlock(current) ? blockText(current) : '';
    return targetText.startsWith(currentText) && Array.from(currentText).length < Array.from(targetText).length;
  });
}
