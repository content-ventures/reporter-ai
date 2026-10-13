import type { Slide } from '../../domain/index.ts';
import type { SlideCopy } from '../script-book.ts';

/** Turns hand-written slide copy into carousel slides with stable ids, as the generator would. */
export function slidesFrom(key: string, copy: readonly SlideCopy[], ai: Slide['ai'] = 'unreviewed'): Slide[] {
  return copy.map((slide, index) => {
    const value: Slide = {
      id: `slide-${key}-${index + 1}`,
      layout: slide.layout,
      slots: { ...slide.slots },
      sourceBlockIds: [...slide.sourceBlockIds],
    };
    if (ai) value.ai = ai;
    return value;
  });
}
