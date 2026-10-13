import { COVER_BLOCK_ID, isImageSlot, normalizeImageSlot, setCover } from './article.ts';
import type { ArticleBlock, ArticleBody, ImageFigureBlock, ImageOrientation, ImageSlot } from './article.ts';
import { normalizeImageRef } from './asset.ts';
import type { ImageRef } from './asset.ts';
import type { BlockId } from './ids.ts';
import type { SourceRef } from './refs.ts';
import { ok, refuse } from './result.ts';
import type { Result } from './result.ts';

/**
 * Image slots ("Sugestões de imagem"): the places the generation planned an image for, before a
 * person picks the file. A slot is a `figure` block without an image (or, for the cover, the
 * body's `coverSlot`). A person fills it ("Escolher imagem": the block keeps its id and evidence
 * and becomes a regular figure) or dismisses it ("Dispensar"). Slots never block anything: the
 * check "Imagens sugeridas" warns, exports leave them out and the manifest lists them.
 */

export type ImageSlotUse = {
  role: 'cover' | 'figure';
  /** The figure block, or `COVER_BLOCK_ID`. */
  blockId: BlockId;
  slot: ImageSlot;
  /** The excerpt that motivated the image (figures only). */
  sourceRefs?: SourceRef[];
};

/** Every slot still open, in reading order: the cover suggestion first, then the figures. */
export function articleImageSlots(body: Pick<ArticleBody, 'blocks' | 'cover' | 'coverSlot'>): ImageSlotUse[] {
  const uses: ImageSlotUse[] = [];
  if (body.coverSlot && !body.cover) uses.push({ role: 'cover', blockId: COVER_BLOCK_ID, slot: body.coverSlot });
  for (const block of body.blocks) {
    if (!isImageSlot(block)) continue;
    const use: ImageSlotUse = { role: 'figure', blockId: block.id, slot: block.slot };
    if (block.sourceRefs && block.sourceRefs.length > 0) use.sourceRefs = block.sourceRefs;
    uses.push(use);
  }
  return uses;
}

/** Ids of the figure slots still open (the cover suggestion is not a block). */
export function imageSlotBlockIds(body: Pick<ArticleBody, 'blocks'>): BlockId[] {
  return body.blocks.filter(isImageSlot).map((block) => block.id);
}

export type ImageSlotRefusal = 'unknown_slot';

const UNKNOWN_SLOT = 'Esta sugestão de imagem não existe mais no texto.';

function slotIndex(body: ArticleBody, blockId: BlockId): number {
  return body.blocks.findIndex((block) => block.id === blockId && isImageSlot(block));
}

/**
 * "Escolher imagem" on a slot: the figure keeps its id and evidence (`sourceRefs`) and shows the
 * image; `COVER_BLOCK_ID` sets the cover. Alt and caption are the image's own (start the form from
 * `imageSlotDefaults`).
 */
export function fillImageSlot(body: ArticleBody, blockId: BlockId, image: ImageRef): Result<ArticleBody, ImageSlotRefusal> {
  if (blockId === COVER_BLOCK_ID) {
    if (!body.coverSlot || body.cover) return refuse('unknown_slot', UNKNOWN_SLOT);
    return ok(setCover(body, image));
  }
  const index = slotIndex(body, blockId);
  if (index < 0) return refuse('unknown_slot', UNKNOWN_SLOT);
  const slot = body.blocks[index];
  const filled: ImageFigureBlock = { id: slot.id, type: 'figure', image: normalizeImageRef(image) };
  if (slot.sourceRefs && slot.sourceRefs.length > 0) filled.sourceRefs = slot.sourceRefs;
  const blocks = body.blocks.slice();
  blocks[index] = filled;
  return ok({ ...body, blocks });
}

/** "Dispensar": the slot leaves the text (the cover suggestion leaves the body). */
export function dismissImageSlot(body: ArticleBody, blockId: BlockId): Result<ArticleBody, ImageSlotRefusal> {
  if (blockId === COVER_BLOCK_ID) {
    if (!body.coverSlot) return refuse('unknown_slot', UNKNOWN_SLOT);
    const next: ArticleBody = { ...body };
    delete next.coverSlot;
    return ok(next);
  }
  const index = slotIndex(body, blockId);
  if (index < 0) return refuse('unknown_slot', UNKNOWN_SLOT);
  return ok({ ...body, blocks: body.blocks.filter((_, position) => position !== index) });
}

/** The publishable body: open slots and the cover suggestion left out (exports, final view). */
export function withoutImageSlots(body: ArticleBody): ArticleBody {
  const blocks: ArticleBlock[] = body.blocks.filter((block) => !isImageSlot(block));
  const next: ArticleBody = { ...body, blocks };
  delete next.coverSlot;
  return next;
}

/** Caption and alt text to start the "Escolher imagem" form from (the person confirms them). */
export function imageSlotDefaults(slot: ImageSlot): Pick<ImageRef, 'alt' | 'caption'> {
  const normalized = normalizeImageSlot(slot);
  const defaults: Pick<ImageRef, 'alt' | 'caption'> = {};
  if (normalized.suggestedCaption) defaults.caption = normalized.suggestedCaption;
  if (normalized.suggestedAlt) defaults.alt = normalized.suggestedAlt;
  return defaults;
}

export const IMAGE_ORIENTATION_LABELS: Readonly<Record<ImageOrientation, string>> = {
  landscape: 'Horizontal',
  portrait: 'Vertical',
  square: 'Quadrada',
};

/** Width/height ratio a slot is framed with (the editor's empty frame, the picker's crop hint). */
export const IMAGE_ORIENTATION_RATIO: Readonly<Record<ImageOrientation, number>> = {
  landscape: 16 / 9,
  portrait: 4 / 5,
  square: 1,
};

export const IMAGE_SLOT_LABEL = 'Sugestão de imagem';
export const COVER_SLOT_LABEL = 'Sugestão de imagem de destaque';

/** "[Sugestão de imagem] Retrato de Marina Lopes": how a slot reads in a comparison. */
export function imageSlotText(slot: ImageSlot, label = `[${IMAGE_SLOT_LABEL}]`): string {
  const subject = normalizeImageSlot(slot).subject;
  return subject ? `${label} ${subject}` : label;
}
