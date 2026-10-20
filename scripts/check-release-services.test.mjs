import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkProviders, releaseEnvironment } from './check-release-services.mjs';

test('release preflight reports every missing name without leaking configured values', () => {
  assert.throws(() => releaseEnvironment({ GROQ_API_KEY: 'private-value' }), error => {
    assert.match(error.message, /NEON_BRANCH_ID/); assert.match(error.message, /REPORTER_WORKER_PASSWORD/);
    assert.doesNotMatch(error.message, /private-value/); return true;
  });
});

test('release preflight accepts the existing OpenAI and Claude credential aliases', () => {
  const environment = Object.fromEntries(['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_BRANCH_ID',
    'REPORTER_WORKER_PASSWORD', 'GROQ_API_KEY', 'PIXABAY_API_KEY', 'TAVILY_API_KEY', 'OPEN_AI_API_KEY', 'CLAUDE_API_KEY'].map(name => [name, 'present']));
  const values = releaseEnvironment(environment);
  assert.equal(values.OPENAI_API_KEY, 'present'); assert.equal(values.ANTHROPIC_API_KEY, 'present');
});

test('release rejects expired API keys and sanitizes network errors before any deployment', async () => {
  await assert.rejects(checkProviders({}, async () => new Response('private upstream message', { status: 401 })),
    error => /credential check failed \(HTTP 401\)/.test(error.message) && !/private upstream/.test(error.message));
  await assert.rejects(checkProviders({}, async () => { throw new Error('URL contains secret'); }),
    error => /could not reach/.test(error.message) && !/URL contains secret/.test(error.message));
});

test('provider preflight checks all five APIs with server credentials', async () => {
  const names = [];
  await checkProviders({ GROQ_API_KEY: 'groq', OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'claude', PIXABAY_API_KEY: 'photos', TAVILY_API_KEY: 'search' }, async (url, options) => {
    names.push(new URL(url).hostname);
    assert.ok(options.signal); return new Response('{}');
  });
  assert.deepEqual(names.sort(), ['api.anthropic.com', 'api.groq.com', 'api.openai.com', 'api.tavily.com', 'pixabay.com']);
});
