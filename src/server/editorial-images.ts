import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ArticleBody, ImageSlot } from '../domain/article.ts';
import { dedupeRefs } from '../domain/refs.ts';
import { imagePlanOutput } from './pipeline-output';
import { FlowError } from './errors';

/** Only real prose blocks can motivate a suggestion; no image URL or license is fabricated. */
export function planArticleImages(body: ArticleBody, value: unknown) {
  const plan = imagePlanOutput.parse(value);
  const prose = new Map(body.blocks.filter(block => block.type === 'paragraph').map(block => [block.id, block]));
  const suggestions = [...(plan.cover ? [plan.cover] : []), ...plan.figures];
  if (suggestions.some(item => item.sourceBlockIds.some(id => !prose.has(id)))
    || plan.figures.some(item => !prose.has(item.afterBlockId))
    || new Set(plan.figures.map(item => item.afterBlockId)).size !== plan.figures.length)
    throw new FlowError('INVALID_IMAGE_EVIDENCE', 502);
  const slot = (item: typeof suggestions[number]): ImageSlot => ({ subject: item.subject,
    suggestedCaption: item.suggestedCaption, suggestedAlt: item.suggestedAlt, orientation: item.orientation });
  const figures = new Map(plan.figures.map(item => [item.afterBlockId, item]));
  const blocks = body.blocks.flatMap(block => {
    const item = figures.get(block.id);
    return item ? [block, { id: randomUUID(), type: 'figure' as const, slot: slot(item),
      sourceRefs: dedupeRefs(item.sourceBlockIds.flatMap(id => prose.get(id)?.sourceRefs ?? [])) }] : [block];
  });
  return { blocks, ...(plan.cover ? { coverSlot: slot(plan.cover) } : {}) };
}
