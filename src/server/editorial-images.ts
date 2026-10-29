import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ArticleBody, ImageSlot } from '../domain/article.ts';
import { dedupeRefs } from '../domain/refs.ts';
import { imagePlanOutput } from './pipeline-output';
import { FlowError } from './errors';

/** Bank receipts authorize textual reuse, not a portrait or scene from the original publication. */
export function imagePlanningBody(body: ArticleBody, bankSourceIds: readonly string[]): ArticleBody {
  const bank = new Set(bankSourceIds);
  return { ...body, ...(bank.size ? { title: '', dek: undefined } : {}),
    blocks: body.blocks.filter(block => !(block.sourceRefs ?? []).some(ref => bank.has(ref.sourceId))) };
}
/** Only eligible prose motivates a suggestion; textual receipts stay untouched on their blocks. */
export function planArticleImages(body: ArticleBody, value: unknown, bankSourceIds: readonly string[]) {
  const plan = imagePlanOutput.parse(value);
  const prose = new Map(body.blocks.filter(block => block.type === 'paragraph').map(block => [block.id, block]));
  const eligible = new Set(imagePlanningBody(body, bankSourceIds).blocks.filter(block => block.type === 'paragraph').map(block => block.id));
  const suggestions = [...(plan.cover ? [plan.cover] : []), ...plan.figures];
  if (suggestions.some(item => item.sourceBlockIds.some(id => !eligible.has(id)))
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
