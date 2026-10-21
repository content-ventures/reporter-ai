import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FlowError } from '../src/server/errors.ts';
import { runNewsTranslationJob } from '../src/server/news-translation-worker.ts';
import type { NewsTranslationWorkerServices } from '../src/server/news-translation-worker.ts';

const claim = { id: 'story', fence: 'lease', attempts: 1, title: 'Fish', excerpt: 'A fish.', body: ['A fish.'] };
const translated = { title: 'Peixe', excerpt: 'Um peixe.', body: ['Um peixe.'], sourceLanguage: 'en', translated: true };
const deps = (changes: Partial<NewsTranslationWorkerServices> = {}): NewsTranslationWorkerServices => ({
  claim: async () => claim, translate: async () => translated,
  finish: async () => true, fail: async () => true, now: () => 0, ...changes,
});

test('news translation claims before provider work and commits only with its lease', async () => {
  const calls: string[] = [];
  assert.equal(await runNewsTranslationJob('worker', new AbortController().signal, undefined, deps({
    claim: async owner => { assert.equal(owner, 'worker'); calls.push('claim'); return claim; },
    translate: async source => { assert.deepEqual(source, { title: claim.title, excerpt: claim.excerpt, body: claim.body }); calls.push('translate'); return translated; },
    finish: async (job, owner, result) => { assert.equal(job.fence, claim.fence); assert.equal(owner, 'worker'); assert.deepEqual(result, translated); calls.push('finish'); return true; },
  })), true);
  assert.deepEqual(calls, ['claim', 'translate', 'finish']);
  await runNewsTranslationJob('worker', new AbortController().signal, undefined, deps({ claim: async () => null,
    translate: async () => { throw new Error('Provider must stay idle for an empty queue'); } }));
});

test('transient translation failures retry within the cap; configuration failures terminate', async () => {
  for (const [error, attempts, retry] of [[new FlowError('OPENAI_RATE_LIMIT', 502, true, 30), 1, 30],
    [new FlowError('OPENAI_RATE_LIMIT', 502, true, 30), 3, 0], [new Error('OPENAI_KEY_MISSING'), 1, 0]] as const) {
    let recorded: number | undefined;
    await runNewsTranslationJob('worker', new AbortController().signal, undefined, deps({
      claim: async () => ({ ...claim, attempts }), translate: async () => { throw error; },
      finish: async () => { throw new Error('Failed translation cannot be saved'); },
      fail: async (_claim, _owner, _code, seconds) => { recorded = seconds; return true; },
    }));
    assert.equal(recorded, retry);
  }
});

test('an interrupted or nearly expired invocation never starts a model call', async () => {
  const noClaim = deps({ claim: async () => { throw new Error('Cannot acquire work'); } });
  assert.equal(await runNewsTranslationJob('worker', AbortSignal.abort(), undefined, noClaim), false);
  assert.equal(await runNewsTranslationJob('worker', new AbortController().signal, 50_000, noClaim), 'yield');
  const controller = new AbortController();
  let retry: number | undefined;
  await runNewsTranslationJob('worker', controller.signal, undefined, deps({
    translate: async () => { controller.abort(); return translated; },
    finish: async () => { throw new Error('Late output cannot commit after cancellation'); },
    fail: async (_claim, _owner, _code, seconds) => { retry = seconds; return true; },
  }));
  assert.equal(retry, 10);
});
