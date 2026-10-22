import type { NewsItem } from '../../../domain/hard-news.ts';

/** Feed images that are site icons, not photos: WordPress emoji, favicons and `.ico` files. */
const NOT_A_PHOTO = /(?:\/emoji\/|favicon|\.ico(?:$|[?#]))/i;

/**
 * The story's own photo. A story without one shows its outlet's mark at mark size, never an icon
 * stretched to fill a photo frame.
 */
export function photoOf(item: Pick<NewsItem, 'imageUrl'>): string | undefined {
  const url = item.imageUrl?.trim();
  return url && !NOT_A_PHOTO.test(url) ? url : undefined;
}
