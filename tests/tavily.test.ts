import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchEvidence, searchWebEvidence } from '../src/server/tavily.ts';
import { FlowError } from '../src/server/errors.ts';

test('direct Tavily requests are bounded and retain snippets, dates and actual usage without an AI answer', async () => {
  const previous = process.env.TAVILY_API_KEY; process.env.TAVILY_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal((options!.headers as Record<string, string>).Authorization, 'Bearer test-key');
    body = JSON.parse(options!.body as string);
    return new Response(JSON.stringify({ request_id: 'search-request', usage: { credits: 1 }, answer: 'Never use the provider answer.', results: [
      { url: 'https://primary.test/one', title: 'Technical source', content: 'A specific external explanation.', published_date: '2026-05-20' },
      { url: 'https://blocked.test/two', content: 'An excluded domain.' },
      { url: 'https://name:password@primary.test/three', content: 'Credentials are not a public source URL.' },
      { url: 'http://primary.test/four', content: 'Unsupported protocol.' },
    ] }));
  };
  try {
    const result = await searchWebEvidence('x'.repeat(500), new AbortController().signal, { maxResults: 4, excludeDomains: ['blocked.test'] });
    assert.equal((body!.query as string).length, 380);
    assert.deepEqual([body!.search_depth, body!.max_results, body!.auto_parameters, body!.include_answer, body!.include_usage], ['basic', 4, false, false, true]);
    assert.deepEqual(body!.exclude_domains, ['blocked.test']);
    assert.deepEqual(result, { sources: [{ url: 'https://primary.test/one', title: 'Technical source', site: 'primary.test', excerpt: 'A specific external explanation.', publishedOn: '2026-05-20' }], requestId: 'search-request', credits: 1 });
    const legacy = await searchEvidence('Technical topic', new AbortController().signal);
    assert.ok(Array.isArray(legacy));
    assert.ok((body!.exclude_domains as string[]).includes('instagram.com'), 'the existing citation adapter keeps its previous default exclusions');
  } finally { globalThis.fetch = originalFetch; if (previous === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previous; }
});

test('Tavily failures are actionable safe codes and missing usage or dates are not invented', async () => {
  const previous = process.env.TAVILY_API_KEY, originalFetch = globalThis.fetch;
  process.env.TAVILY_API_KEY = 'test-key';
  try {
    for (const [status, code] of [[401, 'TAVILY_AUTH_INVALID'], [429, 'TAVILY_RATE_LIMIT'], [432, 'TAVILY_QUOTA_EXHAUSTED'], [500, 'TAVILY_REQUEST_FAILED']] as const) {
      globalThis.fetch = async () => new Response('Provider failure with private response details', { status });
      await assert.rejects(searchWebEvidence('Topic', new AbortController().signal), (error: unknown) => error instanceof FlowError && error.code === code && !error.message.includes('private'));
    }
    globalThis.fetch = async () => { throw new Error('Do not expose provider request or test-key'); };
    await assert.rejects(searchWebEvidence('Topic', new AbortController().signal), /TAVILY_UNAVAILABLE/);
    globalThis.fetch = async () => new Response(JSON.stringify({ results: [{ url: 'https://primary.test/', content: 'A source without a date.', published_date: 'unknown' }] }));
    const result = await searchWebEvidence('Topic', new AbortController().signal);
    assert.equal(result.requestId, null); assert.equal(result.credits, null); assert.equal(result.sources[0].publishedOn, undefined);
    globalThis.fetch = async () => { assert.fail('no request is allowed without a key or after cancellation'); };
    const cancelled = new AbortController(); cancelled.abort();
    await assert.rejects(searchWebEvidence('Topic', cancelled.signal), /JOB_INTERRUPTED/);
    delete process.env.TAVILY_API_KEY;
    await assert.rejects(searchWebEvidence('Topic', new AbortController().signal), /TAVILY_KEY_MISSING/);
  } finally { globalThis.fetch = originalFetch; if (previous === undefined) delete process.env.TAVILY_API_KEY; else process.env.TAVILY_API_KEY = previous; }
});
