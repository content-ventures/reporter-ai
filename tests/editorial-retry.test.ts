import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editorialRetryPolicy, FlowError } from '../src/server/errors.ts';

test('quota pauses retain the error-attempt budget and respect provider wait time', () => {
  const now = Date.parse('2026-10-10T18:00:00Z'), createdAt = new Date(now - 60000).toISOString();
  const policy = editorialRetryPolicy(new FlowError('GROQ_RATE_LIMIT', 502, true, 90), 2, createdAt, false, now);
  assert.deepEqual(policy, { attempts: 1, retry: true, delayMs: 90000 });
  assert.equal(editorialRetryPolicy(new FlowError('GROQ_RATE_LIMIT', 502, true, 5), 1, createdAt, false, now).delayMs, 30000);
});
test('malformed outputs stop after three attempts and retry waits stop within five minutes', () => {
  const now = Date.parse('2026-10-10T18:00:00Z');
  const failure = new FlowError('INVALID_PROVIDER_OUTPUT',502,true,5);
  assert.equal(editorialRetryPolicy(failure,2,new Date(now-60000).toISOString(),false,now).retry,true);
  assert.equal(editorialRetryPolicy(failure,3,new Date(now-60000).toISOString(),false,now).retry,false);
  assert.equal(editorialRetryPolicy(failure,1,new Date(now-299000).toISOString(),false,now).retry,false);
  assert.equal(editorialRetryPolicy(new FlowError('OPENAI_RATE_LIMIT',502,true,90),1,new Date(now-240000).toISOString(),false,now).retry,false);
});
test('real failures still exhaust the budget and quota waits cannot run forever', () => {
  const now = Date.parse('2026-10-10T18:00:00Z'), createdAt = new Date(now - 60000).toISOString();
  assert.equal(editorialRetryPolicy(new FlowError('INVALID_PROVIDER_OUTPUT', 502, true, 5), 8, createdAt, false, now).retry, false);
  assert.equal(editorialRetryPolicy(new FlowError('GROQ_AUTH_INVALID', 502), 1, createdAt, false, now).retry, false);
  assert.equal(editorialRetryPolicy(new FlowError('GROQ_RATE_LIMIT', 502, true), 1, new Date(now - 31 * 60000).toISOString(), false, now).retry, false);
});
test('OpenAI and Claude quota pauses are bounded even when Retry-After exceeds the whole window', () => {
  const now = Date.parse('2026-10-10T18:00:00Z'), createdAt = new Date(now - 60000).toISOString();
  for (const provider of ['OPENAI', 'ANTHROPIC']) {
    assert.equal(editorialRetryPolicy(new FlowError(provider + '_RATE_LIMIT', 502, true, 45), 1, createdAt, false, now).attempts, 0);
    assert.equal(editorialRetryPolicy(new FlowError(provider + '_RATE_LIMIT', 502, true, 7200), 1, createdAt, false, now).retry, false);
  }
});
