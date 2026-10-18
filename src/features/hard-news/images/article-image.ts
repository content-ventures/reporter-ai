import type { ArticleBody } from '../../../domain/article.ts';
import type { ImageRef } from '../../../domain/asset.ts';

/** Where "Usar em artigo" puts a photo: the cover ("Imagem de destaque") or a figure in the text. */
export type Placement = 'cover' | 'body';

export const PLACEMENT_LABELS: Record<Placement, string> = { cover: 'Capa', body: 'No texto' };

/**
 * The article with the photo in place: as its cover (replacing the previous cover and the AI's cover
 * suggestion), or as a figure at the end of the text, where the studio can move it.
 */
export function placeImage(body: ArticleBody, image: ImageRef, placement: Placement, blockId: string): ArticleBody {
  if (placement === 'cover') {
    const next: ArticleBody = { ...body, cover: image };
    delete next.coverSlot;
    return next;
  }
  return { ...body, blocks: [...body.blocks, { id: blockId, type: 'figure', image }] };
}
