import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultEditorialPolicy } from '../src/domain/editorial-policy.ts';
import { defaultWritingResearch } from '../src/domain/writing-research.ts';
import type { WritingTrace } from '../src/domain/writing-orchestration.ts';
import { runWritingResearch } from '../src/server/writing-research.ts';
import type { WritingResearchInput } from '../src/server/writing-research.ts';
import { FlowError } from '../src/server/errors.ts';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-web-research-'));
  const traces: WritingTrace[] = [];
  const input: WritingResearchInput = { settings: { ...defaultWritingResearch(), enabled: true }, directory, signal: new AbortController().signal,
    plan: { queries: [{ query: 'Product documentation', purpose: 'Context for the product reported in the interview.', evidenceIds: ['original'] }], reason: 'Technical context would help the reader.' },
    trace: async trace => { traces.push(trace); }, now: () => '2026-10-21T12:00:00Z' };
  return { input, traces, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
const web = (url: string, excerpt = 'Technical context.') => ({ url, title: 'Technical document', site: new URL(url).hostname, excerpt });

test('research filters benchmarks and blocked sources, deduplicates URLs and freezes the actual excerpts', async () => {
  const f = await fixture();
  f.input.policy = defaultEditorialPolicy();
  f.input.policy.guide.examples = [{ id: 'reference', title: 'Published benchmark', url: 'https://news.test/benchmark/', note: 'Style only.' }];
  f.input.policy.map.blocked = ['https://blocked.test', 'An unstructured newsroom note'];
  f.input.settings.maxResults = 5; f.input.settings.maxSources = 1;
  f.input.plan.queries.push({ query: 'Supplementary documentation', purpose: 'A second context query.', evidenceIds: ['original'] });
  let searches = 0;
  f.input.search = async (_query, _signal, options) => {
    searches++; assert.ok(options!.excludeDomains!.includes('blocked.test'));
    return { requestId: 'actual-search-' + searches, credits: 1, sources: [web('https://www.news.test/benchmark?tracking=1'), web('https://sub.blocked.test/page'),
      web('https://primary.test/info'), web('https://primary.test/info?tracking=2'), web('https://another.test/page')] };
  };
  try {
    const result = await runWritingResearch(f.input);
    assert.equal(searches, 2); assert.equal(result.status, 'completed'); assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].kind, 'external'); assert.equal(result.sources[0].url, 'https://primary.test/info');
    assert.equal(result.sources[0].publishedOn, null); assert.equal(result.sources[0].retrievedAt, '2026-10-21T12:00:00Z');
    assert.deepEqual(result.excludedUrls, ['https://news.test/benchmark/']);
    assert.equal(result.queries[0].credits, 1); assert.equal(result.queries[1].sourceIds[0], result.sources[0].id);
    assert.ok(result.queries.every(query => query.sourceIds.length === 1), 'duplicate URLs remain a single source reference in each query');
    f.traces.length = 0;
    assert.deepEqual(await runWritingResearch(f.input), result);
    assert.equal(searches, 2, 'retry uses the frozen search batch, without another paid request');
    assert.equal(f.traces.at(-1)?.cached, true);
    assert.equal(f.traces.at(-1)?.inputTokens, undefined, 'search usage is never represented as LLM tokens');
  } finally { await f.cleanup(); }
});

test('an empty research plan is explained without requesting the provider', async () => {
  const f = await fixture(); f.input.plan = { queries: [], reason: 'The supplied material is sufficient; external context would not help.' };
  f.input.search = async () => { assert.fail('no research query was requested'); };
  try {
    const result = await runWritingResearch(f.input);
    assert.equal(result.status, 'skipped'); assert.equal(result.reason, f.input.plan.reason);
    assert.deepEqual(result.sources, []); assert.equal(f.traces.at(-1)?.status, 'completed');
  } finally { await f.cleanup(); }
});

test('failed searches stop or retain an explicit original-only fallback according to the saved policy', async () => {
  for (const failureMode of ['stop', 'continue_original'] as const) {
    const f = await fixture(); f.input.settings.failureMode = failureMode;
    f.input.plan.queries.push({ query: 'Missing documentation', purpose: 'Check another context.', evidenceIds: ['original'] });
    f.input.search = async query => {
      if (query === 'Missing documentation') throw new FlowError('TAVILY_QUOTA_EXHAUSTED', 502);
      return { sources: [web('https://primary.test/info')], requestId: 'successful-request', credits: 1 };
    };
    try {
      if (failureMode === 'stop') await assert.rejects(runWritingResearch(f.input), /WRITING_RESEARCH_FAILED/);
      else assert.equal((await runWritingResearch(f.input)).status, 'partial');
      const trace = f.traces.at(-1)!;
      assert.equal(trace.status, 'failed'); assert.equal(trace.error, 'WRITING_RESEARCH_FAILED');
      assert.equal(trace.research?.sources.length, 1, 'partial results remain inspectable even when the article must not use them');
      assert.equal(trace.research?.queries[1].error, 'TAVILY_QUOTA_EXHAUSTED');
      assert.match(trace.reason!, failureMode === 'stop' ? /interromper/ : /apenas com o conteúdo original/);
    } finally { await f.cleanup(); }
  }
});

test('cancellation never becomes an original-only fallback and oversized search budgets never dispatch', async () => {
  const f = await fixture(), controller = new AbortController(); f.input.signal = controller.signal;
  f.input.settings.failureMode = 'continue_original';
  f.input.search = async () => { controller.abort(); return { sources: [web('https://primary.test/info')], requestId: null, credits: 1 }; };
  try {
    await assert.rejects(runWritingResearch(f.input), /JOB_INTERRUPTED/);
    assert.equal(f.traces.at(-1)?.error, 'JOB_INTERRUPTED');
    f.input.settings.maxQueries = 4; f.input.search = async () => { assert.fail('invalid search budget must not dispatch'); };
    await assert.rejects(runWritingResearch(f.input), /WRITING_RESEARCH_INVALID/);
  } finally { await f.cleanup(); }
});
