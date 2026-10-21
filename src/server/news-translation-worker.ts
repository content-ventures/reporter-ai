import 'server-only';
import { transaction } from './database.ts';
import { FlowError, logEvent, safeCode } from './errors.ts';
import { translateNews } from './news-translation.ts';
import type { NewsTranslationResult, NewsTranslationText } from './news-translation.ts';

type Claim = NewsTranslationText & { id: string; fence: string; attempts: number };
export type NewsTranslationWorkerServices = {
  claim(owner: string): Promise<Claim | null>;
  finish(claim: Claim, owner: string, result: NewsTranslationResult): Promise<boolean>;
  fail(claim: Claim, owner: string, code: string, retrySeconds: number): Promise<boolean>;
  translate: typeof translateNews;
  now(): number;
};
const sql = <T>(query: string, values: unknown[]) => transaction('worker', async client =>
  (await client.query(query, values)).rows[0]?.value as T);
const services: NewsTranslationWorkerServices = {
  claim: owner => sql('SELECT public.reporter_news_translation_claim($1,$2) AS value', [owner, 120_000]),
  finish: (claim, owner, result) => sql('SELECT public.reporter_news_translation_finish($1,$2,$3,$4) AS value',
    [claim.id, owner, claim.fence, JSON.stringify(result)]),
  fail: (claim, owner, code, retry) => sql('SELECT public.reporter_news_translation_fail($1,$2,$3,$4,$5) AS value',
    [claim.id, owner, claim.fence, code, retry]),
  translate: translateNews,
  now: Date.now,
};

/** Translate received text once, outside the feed transaction. The lease fences late answers. */
export async function runNewsTranslationJob(owner: string, signal: AbortSignal, deadline?: number,
  deps: NewsTranslationWorkerServices = services): Promise<boolean | 'yield'> {
  if (signal.aborted) return false;
  if (deadline !== undefined && deps.now() + 95_000 > deadline) return 'yield';
  const claim = await deps.claim(owner);
  if (!claim) return false;
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  try {
    const translated = await deps.translate({ title: claim.title, excerpt: claim.excerpt, body: claim.body }, bounded);
    bounded.throwIfAborted();
    await deps.finish(claim, owner, translated);
  } catch (error) {
    const code = bounded.aborted ? 'NEWS_TRANSLATION_INTERRUPTED' : safeCode(error);
    const retry = claim.attempts < 3 && (bounded.aborted || error instanceof FlowError && error.retryable)
      ? Math.max(5, Math.min(3600, error instanceof FlowError ? error.waitSeconds : 10)) : 0;
    await deps.fail(claim, owner, code, retry).catch(() => {});
    logEvent('worker', 'news_translation_failed', { error_code: code });
  }
  return true;
}
