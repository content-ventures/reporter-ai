import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interruptWritingTraces, nextWritingExecutionAttempt, writingTraceForExecution, writingTraceUsage, writingRunModel } from '../src/domain/writing-execution.ts';
import { defaultWritingOrchestration, WRITING_EDITORIAL_CHECK_KEYS } from '../src/domain/writing-orchestration.ts';
import type { WritingArticle, WritingPlan, WritingTrace } from '../src/domain/writing-orchestration.ts';
import { tokenCostUsd } from '../src/domain/platform-usage.ts';
import { editorialRetryPolicy, FlowError } from '../src/server/errors.ts';
import { runWritingOrchestration } from '../src/server/writing-orchestration.ts';
import type { WritingRunInput } from '../src/server/writing-orchestration.ts';
import { readWritingTemporalContext, writingTemporalContext } from '../src/domain/writing-context.ts';
import { baseRecord, createKit } from '../src/domain/testing/scenario.ts';
import { editorialContextHash } from '../src/runtime/editorial-engine.ts';

const trace = (fields: Partial<WritingTrace> = {}): WritingTrace => ({ id: 'plan-1', stage: 'plan', attempt: 1, status: 'completed',
  startedAt: '2026-10-21T10:00:00Z', model: 'openai/gpt-4.1', hash: 'fixture', prompt: { system: 'Saved policy.', user: 'Original content.' },
  inputTokens: 10, outputTokens: 2, cached: false, ...fields });

test('execution identities remain monotonic when rate limits reset the retry budget', () => {
  const first = writingTraceForExecution(trace(), 1);
  const retry = editorialRetryPolicy(new FlowError('OPENAI_RATE_LIMIT', 502, true, 30), 1, new Date().toISOString());
  assert.equal(retry.attempts, 0); assert.equal(retry.retry, true);
  assert.equal(nextWritingExecutionAttempt([first]), 2);
  assert.equal(writingTraceForExecution(trace(), nextWritingExecutionAttempt([first])).id, '2-plan-1');
  assert.equal(first.id, '1-plan-1');
  assert.equal(nextWritingExecutionAttempt([trace({ id: '4-review-2', executionAttempt: undefined })]), 5, 'existing prefixed records remain distinct');
});

test('a recovered claim closes abandoned stages without changing completed output or inventing usage', () => {
  const original = [writingTraceForExecution(trace(), 1), writingTraceForExecution(trace({ id: 'write-1', stage: 'write',
    status: 'running', inputTokens: undefined, outputTokens: undefined, cached: undefined }), 1)];
  const before = structuredClone(original);
  const recovered = interruptWritingTraces(original, '2026-10-21T10:02:00Z');
  assert.deepEqual(original, before); assert.deepEqual(recovered[0], original[0]);
  assert.deepEqual([recovered[1].status, recovered[1].error, recovered[1].completedAt], ['failed', 'WORKER_INTERRUPTED', '2026-10-21T10:02:00Z']);
  assert.equal(recovered[1].inputTokens, undefined); assert.equal(recovered[1].outputTokens, undefined);
  assert.equal(nextWritingExecutionAttempt(recovered), 2);
  assert.deepEqual(writingTraceUsage(recovered), { inputTokens: 10, outputTokens: 2 }, 'the total stays unknown after an unmetered interruption');
});

test('usage includes billed invalid output, excludes cache charges and leaves unknown counters absent', () => {
  assert.equal(writingTraceUsage([]), undefined);
  assert.equal(writingTraceUsage([trace({ status: 'running' })]), undefined);
  assert.equal(writingTraceUsage([trace({ status: 'failed', inputTokens: null, outputTokens: undefined })]), undefined);
  assert.deepEqual(writingTraceUsage([trace(), trace({ id: 'write-1', stage: 'write', status: 'failed', inputTokens: 20, outputTokens: 5,
    error: 'WRITING_INVALID_OUTPUT' }), trace({ cached: true, inputTokens: 900, outputTokens: 800 })]),
  { inputTokens: 30, outputTokens: 7, totalTokens: 37 });
  assert.deepEqual(writingTraceUsage([trace({ inputTokens: null, outputTokens: 3 })]), { outputTokens: 3 });
  assert.deepEqual(writingTraceUsage([trace(), trace({ inputTokens: null, outputTokens: 3 })]), { inputTokens: 10, outputTokens: 5 });
  assert.deepEqual(writingTraceUsage([trace(), trace({ stage: 'research', model: 'tavily/search-basic', inputTokens: undefined, outputTokens: undefined })]),
    { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, 'search credits are not missing LLM token usage');
  assert.equal(writingTraceUsage([trace({ stage: 'research' })]), undefined, 'search never supplies LLM tokens');
});

test('a cached retry retains paid prior calls and the original failed review in durable history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-writing-execution-'));
  const configuration = defaultWritingOrchestration(); configuration.enabled = true;
  const source = [{ id: 's1', text: 'A empresa anunciou distribuição regional.' }];
  const plan: WritingPlan = { decision: 'ready', angle: 'Distribuição regional', facts: [
    { id: 'f1', text: source[0].text, kind: 'reported_fact', evidenceIds: ['s1'] },
  ], essentialFactIds: ['f1'], outline: ['Distribuição'], issues: [] };
  const article: WritingArticle = { title: 'Empresa anuncia distribuição regional', dek: '', titleEvidenceIds: ['s1'], dekEvidenceIds: [], blocks: [
    { id: 'p1', type: 'paragraph', level: 2, text: source[0].text, items: [], evidenceIds: ['s1'] },
  ] };
  const durable: WritingTrace[] = []; let executionAttempt = 1, requests = 0;
  const generate: NonNullable<WritingRunInput['generate']> = async () => {
    requests++;
    if (requests === 3) throw new FlowError('OPENAI_RATE_LIMIT', 502, true, 30);
    return { value: requests === 1 ? plan : requests === 2 ? article : { decision: 'ready_for_human', summary: 'Sem pendências.', issues: [],
      audit: { factualSummary: 'Distribuição regional conferida na fonte.', editorialSummary: 'Título e parágrafo apresentam a informação.',
        editorialChecks: WRITING_EDITORIAL_CHECK_KEYS.map(criterion => ({ criterion, status: 'pass', articlePassages: [], issueIds: [], reason: 'Texto adequado neste eixo.' })),
        factChecks: [{ factId: 'f1', status: 'preserved', articlePassages: [{ blockId: 'p1', text: source[0].text }], evidenceIds: ['s1'],
          reason: 'O artigo mantém a distribuição regional anunciada pela empresa.' }], issueChecks: [] } },
      provider: 'openai', model: 'openai/gpt-4.1', provider_request_id: 'fixture-' + requests, usage_unit: 'tokens', input_units: 10, output_units: 2 };
  };
  const input: WritingRunInput = { configuration, source, brief: {}, directory, signal: new AbortController().signal, generate,
    trace: async item => {
      const saved = writingTraceForExecution(item, executionAttempt), index = durable.findIndex(previous => previous.id === saved.id);
      if (index < 0) durable.push(saved); else durable[index] = saved;
    } };
  try {
    await assert.rejects(runWritingOrchestration(input), /OPENAI_RATE_LIMIT/);
    assert.deepEqual(writingTraceUsage(durable), { inputTokens: 20, outputTokens: 4 });
    executionAttempt = nextWritingExecutionAttempt(durable);
    const result = await runWritingOrchestration(input);
    assert.equal(result.inputTokens, 10, 'the resumed process bills only its new review');
    assert.deepEqual(writingTraceUsage(durable), { inputTokens: 30, outputTokens: 6 }, 'the run retains earlier billed stages; the 429 total is unknown');
    assert.equal(requests, 4); assert.equal(durable.length, 6);
    assert.equal(durable.find(item => item.id === '1-plan-1')!.cached, false);
    assert.equal(durable.find(item => item.id === '2-plan-1')!.cached, true);
    assert.equal(durable.find(item => item.id === '1-review-1')!.error, 'OPENAI_RATE_LIMIT');
    assert.equal(durable.find(item => item.id === '2-review-1')!.status, 'completed');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('mixed-model runs have no misleading single-model tariff and unused correction models do not change pricing', () => {
  const configuration = defaultWritingOrchestration();
  assert.equal(writingRunModel(configuration, 7).alias, 'openai/gpt-4.1');
  configuration.stages.correct.model = 'google/gemini-3.8-flash'; configuration.maxCorrections = 0;
  assert.equal(writingRunModel(configuration, 7).alias, 'openai/gpt-4.1');
  configuration.maxCorrections = 1;
  assert.deepEqual(writingRunModel(configuration, 7), { alias: 'writing/multi-model', label: 'Orquestração editorial · vários modelos', engine: 'provider' });
  assert.equal(tokenCostUsd(writingRunModel(configuration, 7).alias, 1000, 1000), null);
  configuration.maxCorrections = 0; configuration.stages.review.model = 'anthropic/claude-sonnet-4-6';
  assert.equal(writingRunModel(configuration, 7).alias, 'writing/multi-model');
  assert.equal(configuration.stages.write.model, 'openai/gpt-4.1', 'provenance keeps the actual model of every stage');
});

test('all writing stages retain source dates and a corrected recording date invalidates cached results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-writing-temporal-'));
  const configuration = defaultWritingOrchestration(); configuration.enabled = true;
  const source = [{ id: 's1', text: 'A empresa anunciou distribuição regional.' }];
  const metadata = [{ id: 'original-source', title: 'Entrevista antiga', recordedOn: '2026-05-20' }];
  const plan: WritingPlan = { decision: 'ready', angle: 'Anúncio relatado na entrevista', facts: [
    { id: 'f1', text: source[0].text, kind: 'reported_fact', evidenceIds: ['s1'] },
  ], essentialFactIds: ['f1'], outline: ['Distribuição'], issues: [] };
  const article: WritingArticle = { title: 'Empresa anuncia distribuição regional', dek: '', titleEvidenceIds: ['s1'], dekEvidenceIds: [], blocks: [
    { id: 'p1', type: 'paragraph', level: 2, text: source[0].text, items: [], evidenceIds: ['s1'] },
  ] };
  const corrected = { ...article, title: 'Empresa anunciou distribuição regional' };
  const issue = { id: 'time-1', severity: 'major', code: 'TEMPORAL_SCOPE', blockId: 'title',
    message: 'A declaração antiga parece um anúncio atual.', evidenceIds: ['s1'], suggestion: 'Situe o anúncio no relato da entrevista.' };
  const review = (final: boolean) => ({ decision: final ? 'ready_for_human' : 'revise', summary: final ? 'Referência temporal preservada.' : 'Situe o anúncio.',
    issues: final ? [] : [issue], audit: { factualSummary: 'Anúncio da fonte preservado.', editorialSummary: 'Título conferido com a data da entrevista.',
      editorialChecks: WRITING_EDITORIAL_CHECK_KEYS.map(criterion => ({ criterion, status: !final && criterion === 'uncertainty' ? 'revise' : 'pass',
        articlePassages: [], issueIds: !final && criterion === 'uncertainty' ? ['time-1'] : [], reason: 'Referência temporal conferida.' })),
      factChecks: [{ factId: 'f1', status: 'preserved', articlePassages: [{ blockId: 'p1', text: source[0].text }], evidenceIds: ['s1'], reason: 'O anúncio está preservado.' }],
      issueChecks: final ? [{ issueId: 'time-1', status: 'resolved', articlePassages: [{ blockId: 'title', text: corrected.title }], reason: 'O anúncio foi situado no passado.' }] : [] } });
  const responses = [plan, article, review(false), corrected, review(true)];
  const observed: unknown[] = [], traces: WritingTrace[] = []; let requests = 0;
  const generate: NonNullable<WritingRunInput['generate']> = async (_system, _user, _schema, _signal, options) => {
    const prompt = options!.userPrompt!;
    observed.push(readWritingTemporalContext(JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).brief));
    return { value: responses[requests++ % responses.length], provider: 'openai', model: 'openai/gpt-4.1',
      provider_request_id: `temporal-${requests}`, usage_unit: 'tokens', input_units: 10, output_units: 2 };
  };
  const input: WritingRunInput = { configuration, source, directory, generate, signal: new AbortController().signal,
    brief: { today: '21 de outubro de 2026', temporalContext: writingTemporalContext(metadata, '2026-10-21'),
      sourceReferences: [{ id: 's1', reference: { sourceId: 'original-source' } }] }, trace: async item => { traces.push(item); } };
  try {
    await runWritingOrchestration(input);
    assert.equal(requests, 5);
    for (const context of observed) assert.deepEqual(context, writingTemporalContext(metadata, '2026-10-21'));
    const originalTraces = structuredClone(traces);
    await runWritingOrchestration(input);
    assert.equal(requests, 5, 'the identical temporal context reuses the five captured responses');
    metadata[0].recordedOn = '2026-05-21';
    input.brief = { ...input.brief as object, temporalContext: writingTemporalContext(metadata, '2026-10-21') };
    await runWritingOrchestration(input);
    assert.equal(requests, 10, 'a corrected source date invalidates every stage, even when source words are unchanged');
    assert.equal((observed[5] as { sources: { recordedOn: string }[] }).sources[0].recordedOn, '2026-05-21');
    for (const item of originalTraces) {
      const context = readWritingTemporalContext(JSON.parse(item.prompt.user.slice(item.prompt.user.indexOf('\n') + 1)).brief)!;
      assert.equal(context.sources[0].recordedOn, '2026-05-20', 'the earlier execution keeps its original source date');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the queued context guard detects recording-date corrections without a transcript revision', () => {
  const record = baseRecord(createKit()), pieceId = record.pieces[0].id;
  const originalSource = structuredClone(record.sources[0]);
  const queuedHash = editorialContextHash(record, pieceId, []);
  record.sources[0].recordedOn = '2026-05-20';
  assert.deepEqual(record.sources[0].versions, originalSource.versions);
  assert.notEqual(editorialContextHash(record, pieceId, []), queuedHash, 'a stale worker cannot settle against the old context hash');
  const datedHash = editorialContextHash(record, pieceId, []);
  record.sources[0].recordedOn = '2026-05-21';
  assert.notEqual(editorialContextHash(record, pieceId, []), datedHash);
});
