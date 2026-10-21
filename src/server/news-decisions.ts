import 'server-only';
import { z } from 'zod';
import type { NewsItem } from '../domain/hard-news.ts';
import { NEWS_DECISION_LIMITS } from '../domain/news-decisions.ts';
import type { NewsDecisionInput } from '../domain/news-decisions.ts';
import { transaction } from './database.ts';
import { FlowError, safeCode } from './errors.ts';
import { itemView } from './news-intake.ts';
import type { StoredItem } from './news-intake.ts';

const revision = z.number().int().min(0).max(2_147_483_646);
const decisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('select'), revision }).strict(),
  z.object({ action: z.literal('restore'), revision }).strict(),
  z.object({ action: z.literal('postpone'), revision, hours: z.number().int().min(1).max(NEWS_DECISION_LIMITS.postponeHours) }).strict(),
  z.object({ action: z.literal('discard'), revision, reason: z.string().trim().min(1).max(NEWS_DECISION_LIMITS.reasonChars) }).strict(),
]);

export type NewsDecisionServices = { write(id: string, decision: NewsDecisionInput): Promise<StoredItem> };
const services: NewsDecisionServices = {
  write: (id, decision) => transaction('runtime', async (client) => {
    const result = await client.query('SELECT public.reporter_news_decide($1,$2,$3,$4,$5) AS value', [
      id, decision.revision, decision.action,
      decision.action === 'postpone' ? decision.hours : null,
      decision.action === 'discard' ? decision.reason : null,
    ]);
    return result.rows[0].value as StoredItem;
  }),
};

/** One durable decision, checked against the revision the editor actually saw. */
export async function decideNewsItem(newsId: string, input: unknown, deps: NewsDecisionServices = services): Promise<NewsItem> {
  const id = z.string().uuid().safeParse(newsId);
  const decision = decisionSchema.safeParse(input);
  if (!id.success || !decision.success) throw new FlowError('NEWS_DECISION_INVALID', 422);
  try {
    return itemView(await deps.write(id.data, decision.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NEWS_ITEM_NOT_FOUND') throw new FlowError(message, 404);
    if (message === 'NEWS_DECISION_CONFLICT') throw new FlowError(message, 409);
    if (message === 'NEWS_DECISION_INVALID') throw new FlowError(message, 422);
    if (safeCode(error) === '42501') throw new FlowError('FORBIDDEN', 403);
    throw error;
  }
}
