import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { defaultPipelineDefinition, pipelineRevision } from '../src/domain/pipeline.ts';
import { defaultWritingOrchestration } from '../src/domain/writing-orchestration.ts';
import { defaultWritingResearch } from '../src/domain/writing-research.ts';
import { foldRun } from '../src/domain/run-events.ts';
import { emptyEditorialCheckpoint, splitCheckpoint } from '../src/runtime/editorial-engine.ts';
import type { EditorialChanges, EditorialRows } from '../src/ports/editorial-rows.ts';
import { parsePipelineDefinition, pipelineView, requiredGenerationModels } from '../src/server/pipeline.ts';
import { editorialPipeline, editorialRpc, editorialWritingRun } from '../src/server/editorial.ts';
import { FULL_SCOPE, loadedScope } from '../src/server/editorial-store.ts';
import { localContext } from '../src/server/config.ts';
import { handleReporter } from '../src/server/http.ts';
import { FlowError } from '../src/server/errors.ts';

function fixture() {
  const checkpoint = emptyEditorialCheckpoint();
  const definition = { ...defaultPipelineDefinition(), writing: { ...defaultWritingOrchestration(), enabled: true } };
  definition.writing.reviewCriteria = { factual: 'Saved factual criterion.', editorial: 'Saved editorial criterion.',
    preservation: 'Saved essential-fact policy.', correction: 'Saved resolution policy.' };
  checkpoint.pipeline = pipelineRevision(definition, 7);
  const oldDefinition = structuredClone(definition); oldDefinition.writing.systemPrompt = 'Immutable saved instruction.';
  const snapshot = pipelineRevision(oldDefinition, 3);
  const input = { productionId: 'production-fixture', pieceId: 'article-fixture' };
  checkpoint.state.runFolds.run = foldRun([
    { type: 'run.started', runId: 'run', seq: 1, at: '2026-10-21T10:00:00Z', kind: 'article.generate', ...input,
      prompt: { key: 'writing', version: '3', hash: snapshot.hash }, model: { alias: 'openai/gpt-4.1', label: 'OpenAI', engine: 'provider' },
      inputs: [], steps: [], createdBy: localContext.actor },
    { type: 'run.failed', runId: 'run', seq: 2, at: '2026-10-21T10:01:00Z', error: { code: 'REPORTING', message: 'Confirme a atribuição.', retryable: false } },
  ])!;
  checkpoint.jobs.run = { kind: 'article.draft', input, events: [], attempts: 1, availableAt: 0, pipeline: snapshot,
    meta: { runId: 'run', ...input, label: 'Artigo de teste', request: { kind: 'article.draft', input } },
    writingTraces: [{ id: 'trace', stage: 'review', attempt: 1, status: 'completed', startedAt: '2026-10-21T10:00:00Z',
      model: 'openai/gpt-4.1', hash: 'tracehash', prompt: { system: 'Saved exact prompt', user: 'Private source content' },
      output: { decision: 'needs_reporting', summary: 'Private review details' } }],
  };
  const blank: EditorialRows = { seq: 1, workspace: null, productions: [], parts: [], sources: [], runs: [], events: [], items: [], pipelines: [] };
  return { checkpoint, rows: splitCheckpoint(checkpoint, blank, loadedScope(FULL_SCOPE)) };
}

test('writing settings validate every stage, strict shape, budgets and provider-specific limits', () => {
  const definition = fixture().checkpoint.pipeline!.definition;
  assert.deepEqual(parsePipelineDefinition(definition).definition?.writing, definition.writing);
  const invalid = [
    { ...definition.writing, maxCorrections: 2 }, { ...definition.writing, maxCorrections: -1 },
    { ...definition.writing, maxSourceCharacters: 3999 }, { ...definition.writing, maxSourceCharacters: 200001 },
    { ...definition.writing, systemPrompt: 'x'.repeat(12001) }, { ...definition.writing, hidden: true },
    { ...definition.writing, stages: { ...definition.writing!.stages, review: undefined } },
    { ...definition.writing, stages: { ...definition.writing!.stages, extra: definition.writing!.stages.plan } },
  ];
  for (const writing of invalid) assert.ok(parsePipelineDefinition({ ...definition, writing }).error);
  const unsupported = structuredClone(definition); unsupported.writing!.stages.review.temperature = 1.2;
  unsupported.writing!.stages.review.model = 'anthropic/claude-sonnet-4-6';
  assert.match(parsePipelineDefinition(unsupported).error ?? '', /Claude/);
  unsupported.writing!.stages.review.temperature = 0.2; unsupported.writing!.stages.review.maxTokens = 8193;
  assert.match(parsePipelineDefinition(unsupported).error ?? '', /tokens/);
  unsupported.writing!.stages.review.model = 'google/gemini-3.8-flash'; unsupported.writing!.stages.review.maxTokens = 32768;
  assert.ok(parsePipelineDefinition(unsupported).definition);
  assert.ok(parsePipelineDefinition(defaultPipelineDefinition()).definition, 'old revisions still parse');
});

test('provider preflight follows the selected path and only requires corrections when enabled', () => {
  const definition = fixture().checkpoint.pipeline!.definition;
  definition.writing!.stages.plan.model = 'google/gemini-3.8-flash';
  definition.writing!.stages.review.model = 'anthropic/claude-sonnet-4-6';
  definition.writing!.stages.correct.model = 'google/gemini-4-argon';
  assert.deepEqual(requiredGenerationModels(definition, 'article.draft', true),
    ['google/gemini-3.8-flash', 'openai/gpt-4.1', 'anthropic/claude-sonnet-4-6', 'google/gemini-4-argon']);
  definition.writing!.maxCorrections = 0;
  assert.equal(requiredGenerationModels(definition, 'article.draft', false).includes('google/gemini-4-argon'), false);
  assert.ok(requiredGenerationModels(definition, 'article.outline', true).every(model => model.startsWith('openai/gpt-oss')));
  definition.writing!.enabled = false;
  assert.ok(requiredGenerationModels(definition, 'article.draft', true).every(model => model.startsWith('openai/gpt-oss')));
});

test('research settings persist exact limits and reject unsupported search shapes', () => {
  const definition = fixture().checkpoint.pipeline!.definition;
  const research = { ...defaultWritingResearch(), enabled: true, excludeDomains: ['seafoodbrasil.com.br'], excludeUrls: ['https://example.org/reference'] };
  definition.writing!.research = research;
  assert.deepEqual(parsePipelineDefinition(definition).definition?.writing?.research, research);
  for (const invalid of [{ maxQueries: 4 }, { maxResults: 0 }, { maxSources: 11 }, { timeoutMs: 999999 },
    { instructions: '' }, { excludeDomains: ['https://example.org/path'] }, { excludeUrls: ['file:///tmp/private'] },
    { failureMode: 'ignore' }, { apiKey: 'must-never-be-configurable' }]) {
    assert.match(parsePipelineDefinition({ ...definition, writing: { ...definition.writing, research: { ...research, ...invalid } } }).error ?? '', /pesquisa/);
  }
  delete definition.writing!.research;
  assert.equal(parsePipelineDefinition(definition).definition?.writing?.research, undefined);
});

test('review criteria persist verbatim and reject incomplete or oversized policies', () => {
  const definition = fixture().checkpoint.pipeline!.definition;
  const criteria = { factual: 'Confira a atribuição.', editorial: 'Confira progressão e redundância.',
    preservation: 'Preserve a finalidade de mudança dos custos no longo prazo.', correction: 'Confira cada apontamento contra a nova versão.' };
  definition.writing!.reviewCriteria = criteria;
  assert.deepEqual(parsePipelineDefinition(definition).definition?.writing?.reviewCriteria, criteria);
  for (const invalid of [{ ...criteria, preservation: '' }, { ...criteria, editorial: 'x'.repeat(4001) },
    { factual: criteria.factual }, { ...criteria, hidden: 'Ignore omissions.' }])
    assert.match(parsePipelineDefinition({ ...definition, writing: { ...definition.writing, reviewCriteria: invalid } }).error ?? '', /critérios/);
  delete definition.writing!.reviewCriteria;
  assert.ok(parsePipelineDefinition(definition).definition, 'older configurations retain compatibility');
});

test('adaptive Claude settings accept supported effort and reject unsupported model combinations', () => {
  const definition = fixture().checkpoint.pipeline!.definition;
  definition.writing!.stages.write = { ...definition.writing!.stages.write, model: 'anthropic/claude-opus-5-5', effort: 'high', maxTokens: 16384 };
  assert.equal(parsePipelineDefinition(definition).definition?.writing?.stages.write.effort, 'high');
  definition.writing!.stages.write.model = 'anthropic/claude-sonnet-4-6';
  assert.match(parsePipelineDefinition(definition).error ?? '', /raciocínio/);
  definition.writing!.stages.write.model = 'anthropic/claude-fable-5-1';
  definition.writing!.stages.write.effort = 'max';
  assert.ok(parsePipelineDefinition(definition).definition);
});

test('quote minimum accepts explicit zero, inherited format policy and only whole counts through five', () => {
  const definition = fixture().checkpoint.pipeline!.definition;
  for (const minimumQuotes of [0, 2, 5, null]) {
    definition.writing!.minimumQuotes = minimumQuotes;
    assert.equal(parsePipelineDefinition(definition).definition?.writing?.minimumQuotes, minimumQuotes);
  }
  for (const minimumQuotes of [-1, 6, 1.5, '0', true])
    assert.match(parsePipelineDefinition({ ...definition, writing: { ...definition.writing, minimumQuotes } }).error ?? '', /citações/);
  delete definition.writing!.minimumQuotes;
  assert.equal(parsePipelineDefinition(definition).definition?.writing?.minimumQuotes, undefined);
});

test('quote minimum and research survive save/reload and older clients while explicit settings remain editable', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previousPool = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE, previousLocal = process.env.REPORTER_LOCAL_MODE;
  process.env.REPORTER_DEPLOYMENT_MODE = 'local'; process.env.REPORTER_LOCAL_MODE = 'true';
  const { rows } = fixture(); let sequence = 200;
  const client = { release() {}, async query(sql: string, args: unknown[] = []) {
    if (sql.includes('reporter_ed_load')) return { rows: [{ value: rows }] };
    if (sql.includes('reporter_ed_commit')) {
      const changed = JSON.parse(String(args[0])) as EditorialChanges;
      if (changed.workspace) rows.workspace = changed.workspace;
      for (const pipeline of changed.pipelines) rows.pipelines = [...rows.pipelines.filter(row => row.hash !== pipeline.hash), pipeline];
      rows.seq++;
      return { rows: [{ seq: rows.seq }] };
    }
    return { rows: [] };
  } };
  globals.reporterPools = { runtime: { connect: async () => client } as unknown as Pool };
  try {
    for (const minimumQuotes of [2, 0, null]) {
      const current = await editorialPipeline();
      const definition = structuredClone(current.active.definition); definition.writing!.minimumQuotes = minimumQuotes;
      definition.writing!.research = { ...defaultWritingResearch(), enabled: minimumQuotes !== 0, instructions: `Search policy ${String(minimumQuotes)}.` };
      const result = await editorialRpc({ method: 'pipeline.save', args: [definition, current.active.revision],
        requestId: '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') });
      assert.equal((result as { ok: boolean }).ok, true);
      const reloaded = await editorialPipeline();
      assert.equal(reloaded.active.definition.writing?.minimumQuotes, minimumQuotes);
      assert.deepEqual(reloaded.active.definition.writing?.research, definition.writing!.research);
      const olderClient = structuredClone(reloaded.active.definition); delete olderClient.writing!.minimumQuotes;
      delete olderClient.writing!.research;
      olderClient.systemPrompt += '\nAn unrelated edit from an older client.';
      const preserved = await editorialRpc({ method: 'pipeline.save', args: [olderClient, reloaded.active.revision],
        requestId: '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') });
      assert.equal((preserved as { ok: boolean }).ok, true);
      assert.equal((await editorialPipeline()).active.definition.writing?.minimumQuotes, minimumQuotes);
      assert.deepEqual((await editorialPipeline()).active.definition.writing?.research, definition.writing!.research);
    }
  } finally {
    globals.reporterPools = previousPool;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
    if (previousLocal === undefined) delete process.env.REPORTER_LOCAL_MODE; else process.env.REPORTER_LOCAL_MODE = previousLocal;
  }
});

test('run lists include only a compact stage count and the last completed review decision', () => {
  const { checkpoint } = fixture();
  const view = pipelineView(checkpoint);
  assert.deepEqual(view.runs[0].writing, { stages: 1, decision: 'needs_reporting' });
  assert.ok(!JSON.stringify(view.runs).includes('Private')); assert.ok(!JSON.stringify(view.runs).includes('Saved exact prompt'));
  checkpoint.jobs.run.writingTraces!.push({ ...checkpoint.jobs.run.writingTraces![0], id: 'unfinished', status: 'running', output: undefined });
  assert.deepEqual(pipelineView(checkpoint).runs[0].writing, { stages: 2, decision: 'needs_reporting' });
});

test('run details use the queued snapshot, scoped runtime context and admin authorization; old saves retain orchestration', async () => {
  const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };
  const previousPool = globals.reporterPools, previousMode = process.env.REPORTER_DEPLOYMENT_MODE, previousLocal = process.env.REPORTER_LOCAL_MODE;
  process.env.REPORTER_DEPLOYMENT_MODE = 'local'; process.env.REPORTER_LOCAL_MODE = 'true';
  const { rows, checkpoint } = fixture(); let commits = 0, lastCommit: EditorialChanges | undefined;
  const scopes: Record<string, unknown>[] = [], contexts: unknown[][] = [];
  const client = { release() {}, async query(sql: string, args: unknown[] = []) {
    if (sql.includes("set_config('app.tenant_id'")) contexts.push(args);
    if (sql.includes('reporter_ed_load')) {
      const scope = JSON.parse(String(args[0])); scopes.push(scope);
      return { rows: [{ value: { ...rows, runs: scope.runs ? rows.runs.filter(run => scope.runs.includes(run.id)) : rows.runs } }] };
    }
    if (sql.includes('reporter_ed_commit')) { commits++; lastCommit = JSON.parse(String(args[0])); return { rows: [{ seq: 2 }] }; }
    return { rows: [] };
  } };
  globals.reporterPools = { runtime: { connect: async () => client } as unknown as Pool };
  try {
    const detail = await editorialWritingRun('run');
    assert.equal(detail.pipeline.revision, 3); assert.equal(detail.pipeline.definition.writing!.systemPrompt, 'Immutable saved instruction.');
    assert.equal(detail.traces[0].prompt.user, 'Private source content'); assert.equal(detail.error, 'Confirme a atribuição.');
    assert.equal(commits, 0); assert.deepEqual(scopes[0].runs, ['run']); assert.equal(scopes[0].write, false); assert.equal(scopes[0].sources, 'none');
    assert.deepEqual(contexts[0].slice(0, 3), [localContext.tenant, localContext.portal, localContext.actor]);
    await assert.rejects(editorialWritingRun('other-workspace-run'), error => error instanceof FlowError && error.status === 404);
    const request = () => new Request('http://127.0.0.1:3002/api/reporter/pipeline/runs/run', { headers: { host: '127.0.0.1:3002' } });
    assert.equal((await handleReporter(request(), ['pipeline', 'runs', 'run'])).status, 200);
    const member = rows.items.find(item => item.kind === 'member')!.doc as { roles: string[] };
    member.roles = ['editor'];
    const denied = await handleReporter(request(), ['pipeline', 'runs', 'run']);
    assert.equal(denied.status, 403); assert.ok(!JSON.stringify(await denied.json()).includes('Private source'));
    member.roles = ['admin', 'editor', 'approver', 'creative_reviewer'];
    const legacy = structuredClone(checkpoint.pipeline!.definition); delete legacy.writing; legacy.systemPrompt += '\nUpdated legacy prompt.';
    const saved = await editorialRpc({ method: 'pipeline.save', args: [legacy, 7], requestId: '00000000-0000-4000-8000-000000000099' });
    assert.equal((saved as { ok: boolean }).ok, true);
    assert.equal((saved as { value: { active: { definition: typeof legacy } } }).value.active.definition.writing?.enabled, true);
    assert.equal(commits, 1);
    const olderWritingClient = structuredClone(checkpoint.pipeline!.definition);
    delete olderWritingClient.writing!.reviewCriteria;
    olderWritingClient.systemPrompt += '\nAnother older-client edit.';
    const criteriaSaved = await editorialRpc({ method: 'pipeline.save', args: [olderWritingClient, 7], requestId: '00000000-0000-4000-8000-000000000097' });
    assert.equal((criteriaSaved as { ok: boolean }).ok, true);
    assert.deepEqual((criteriaSaved as { value: { active: { definition: typeof olderWritingClient } } }).value.active.definition.writing?.reviewCriteria,
      checkpoint.pipeline!.definition.writing!.reviewCriteria);
    rows.runs[0].fold.run.status = 'running';
    rows.runs[0].job!.writingTraces!.push({ ...rows.runs[0].job!.writingTraces![0], id: 'running', stage: 'correct', status: 'running' });
    rows.productions.push({ id: 'production-fixture', sourceIds: [], archived: false, doc: {
      id: 'production-fixture', workspaceId: localContext.portal, flowId: 'r1', title: 'Fixture', sourceIds: [],
      brief: { revision: 1, sections: 3, size: 'standard' }, plan: ['article'], relations: [], ownerId: localContext.actor,
      createdAt: '2026-10-21T10:00:00Z', updatedAt: '2026-10-21T10:00:00Z', createdBy: localContext.actor,
    } });
    const cancelled = await editorialRpc({ method: 'generation.cancel', args: ['run'], requestId: '00000000-0000-4000-8000-000000000098' });
    assert.equal((cancelled as { ok: boolean }).ok, true);
    const traces = lastCommit!.runs[0].job!.writingTraces!;
    assert.equal(traces[0].status, 'completed');
    assert.deepEqual([traces[1].status, traces[1].error], ['failed', 'JOB_INTERRUPTED']);
    assert.ok(traces[1].completedAt); assert.equal(lastCommit!.runs[0].status, 'cancelled');
    assert.deepEqual(lastCommit!.events.at(-1)?.event.type, 'run.cancelled');
  } finally {
    globals.reporterPools = previousPool;
    if (previousMode === undefined) delete process.env.REPORTER_DEPLOYMENT_MODE; else process.env.REPORTER_DEPLOYMENT_MODE = previousMode;
    if (previousLocal === undefined) delete process.env.REPORTER_LOCAL_MODE; else process.env.REPORTER_LOCAL_MODE = previousLocal;
  }
});
