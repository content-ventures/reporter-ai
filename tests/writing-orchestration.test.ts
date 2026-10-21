import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultEditorialPolicy } from '../src/domain/editorial-policy.ts';
import { defaultWritingOrchestration, WRITING_EDITORIAL_CHECK_KEYS } from '../src/domain/writing-orchestration.ts';
import type { WritingArticle, WritingPlan, WritingReview, WritingTrace } from '../src/domain/writing-orchestration.ts';
import { runWritingOrchestration, validateWritingOutput } from '../src/server/writing-orchestration.ts';
import type { WritingRunInput } from '../src/server/writing-orchestration.ts';
import { cacheWrite } from '../src/server/storage.ts';
import { FlowError } from '../src/server/errors.ts';
import { defaultWritingResearch } from '../src/domain/writing-research.ts';

const source = [{ id: 's1', text: 'A empresa apresentou pescado na feira. Não há previsão de lançamento nacional.', speaker: 'Ana' },
  { id: 's2', text: 'A distribuição começa em novembro, apenas no estado de São Paulo.', speaker: 'Bruno' }];
const evidence = new Map(source.map(item => [item.id, item.text]));
const plan: WritingPlan = { decision: 'ready', angle: 'Lançamento regional',
  facts: [{ id: 'f1', text: 'A distribuição começa em novembro, apenas no estado de São Paulo.', kind: 'reported_fact', evidenceIds: ['s2'] }],
  essentialFactIds: ['f1'], outline: ['Lançamento regional e limites de distribuição'], issues: [] };
const article: WritingArticle = { title: 'Empresa apresenta pescado com distribuição regional', dek: 'A operação começa em novembro em São Paulo', titleEvidenceIds: ['s1', 's2'], dekEvidenceIds: ['s2'],
  blocks: [{ id: 'lead', type: 'paragraph', level: 2, text: 'A empresa apresentou pescado na feira. A distribuição começa em novembro, apenas no estado de São Paulo.', items: [], evidenceIds: ['s1', 's2'] },
    { id: 'quote', type: 'quote', level: 2, text: 'Não há previsão de lançamento nacional.', items: [], evidenceIds: ['s1'] }] };
const preservation = { factId: 'f1', status: 'preserved' as const,
  articlePassages: [{ blockId: 'lead', text: 'A distribuição começa em novembro, apenas no estado de São Paulo' }],
  evidenceIds: ['s2'], reason: 'O trecho mantém o início da distribuição e seu limite regional.' };
const passedEditorialChecks = () => WRITING_EDITORIAL_CHECK_KEYS.map(criterion => ({ criterion, status: 'pass' as const,
  articlePassages: [], issueIds: [], reason: 'Nenhuma perda editorial identificada neste eixo.' }));
const ready: WritingReview = { decision: 'ready_for_human', summary: 'Texto consistente com as fontes e pronto para avaliação humana.', issues: [],
  audit: { factualSummary: 'Afirmações e atribuições conferidas nas fontes.', editorialSummary: 'Abertura, progressão e composição adequadas.',
    editorialChecks: passedEditorialChecks(), factChecks: [preservation], issueChecks: [] } };
const revise: WritingReview = { ...ready, decision: 'revise', summary: 'A abertura pode ser mais precisa.', issues: [{ id: 'i1', severity: 'major', code: 'LEAD', blockId: 'lead',
  message: 'O prazo é a informação principal.', evidenceIds: ['s2'], suggestion: 'Começar pelo prazo e pela distribuição regional.' }] };
const fixed = structuredClone(article);
fixed.blocks[0].text = 'A distribuição de pescado começa em novembro, apenas no estado de São Paulo, segundo a empresa.';
const fixedPreservation = { ...preservation, articlePassages: [{ blockId: 'lead', text: 'A distribuição de pescado começa em novembro, apenas no estado de São Paulo' }] };
const rechecked = (base: WritingReview = ready, issueId = 'i1', resolved = true): WritingReview => ({ ...base, audit: { ...base.audit!, factChecks: [fixedPreservation],
  issueChecks: [{ issueId, status: resolved ? 'resolved' : 'unresolved', articlePassages: fixedPreservation.articlePassages,
    reason: resolved ? 'A abertura passa a começar pelo prazo e mantém a restrição regional.' : 'A pendência ainda existe no artigo.' }] } });

function generated(value: unknown) {
  return { value: structuredClone(value), provider: 'openai' as const, model: 'openai/gpt-4.1', provider_request_id: 'test-request', usage_unit: 'tokens' as const, input_units: 10, output_units: 20 };
}
function mock(values: unknown[]) {
  const calls: Parameters<NonNullable<WritingRunInput['generate']>>[] = [];
  const generate: NonNullable<WritingRunInput['generate']> = async (...args) => {
    calls.push(args);
    assert.ok(calls.length <= values.length, 'no hidden model calls');
    return generated(values[calls.length - 1]);
  };
  return { calls, generate };
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-writing-'));
  const configuration = defaultWritingOrchestration(); configuration.enabled = true;
  const policy = defaultEditorialPolicy(); policy.map.audience = 'Profissionais de pescado'; policy.guide.voice = 'Direto e factual';
  const traces: WritingTrace[] = [];
  const input = { configuration, policy, source: structuredClone(source), brief: { request: 'Notícia sobre lançamento regional' }, directory,
    signal: new AbortController().signal, trace: async (trace: WritingTrace) => { traces.push(trace); } };
  return { input, traces, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
function requestData(args: Parameters<NonNullable<WritingRunInput['generate']>>) {
  const user = args[4]!.userPrompt;
  return JSON.parse(user.slice(user.indexOf('\n') + 1));
}

test('the normal path makes three observable calls with full original content and configured models', async () => {
  const f = await fixture(), provider = mock([plan, article, ready]);
  f.input.configuration.stages.plan.model = 'google/gemini-3.8-flash';
  f.input.configuration.stages.review.model = 'anthropic/claude-sonnet-4-6';
  try {
    const result = await runWritingOrchestration({ ...f.input, generate: provider.generate });
    assert.deepEqual(result, { article, review: ready, inputTokens: 30, outputTokens: 60 });
    assert.equal(provider.calls.length, 3);
    assert.deepEqual(provider.calls.map(call => call[4]!.model), ['google/gemini-3.8-flash', 'openai/gpt-4.1', 'anthropic/claude-sonnet-4-6']);
    for (const call of provider.calls) {
      assert.deepEqual(requestData(call).source, source);
      assert.ok(call[4]!.systemPrompt.includes(f.input.policy.guide.voice));
      assert.ok(call[4]!.systemPrompt.includes(f.input.policy.map.audience));
    }
    assert.deepEqual(requestData(provider.calls[1]).plan, plan);
    assert.deepEqual(requestData(provider.calls[2]).article, article);
    assert.deepEqual(f.traces.map(trace => `${trace.stage}:${trace.status}`), ['plan:running', 'plan:completed', 'write:running', 'write:completed', 'review:running', 'review:completed']);
    for (const trace of f.traces.filter(trace => trace.status === 'completed')) {
      assert.equal(trace.cached, false); assert.equal(trace.inputTokens, 10); assert.ok(trace.completedAt); assert.ok(trace.output);
    }
  } finally { await f.cleanup(); }
});

test('one correction is followed by a second independent review against the original content', async () => {
  const f = await fixture(), provider = mock([plan, article, revise, fixed, rechecked()]);
  try {
    const result = await runWritingOrchestration({ ...f.input, generate: provider.generate });
    assert.deepEqual(result.article, fixed); assert.equal(provider.calls.length, 5);
    assert.deepEqual(requestData(provider.calls[3]).review, revise);
    assert.deepEqual(requestData(provider.calls[4]).article, fixed);
    assert.deepEqual(requestData(provider.calls[4]).review, revise);
    assert.deepEqual(requestData(provider.calls[4]).previousArticle, article);
    assert.deepEqual(provider.calls[4][4], { ...provider.calls[2][4], userPrompt: provider.calls[4][4]!.userPrompt });
    for (const call of provider.calls) assert.deepEqual(requestData(call).source, source);
    assert.deepEqual(f.traces.filter(trace => trace.status === 'completed').map(trace => [trace.stage, trace.attempt]), [['plan', 1], ['write', 1], ['review', 1], ['correct', 1], ['review', 2]]);
  } finally { await f.cleanup(); }
});

test('enabled research supplements the article with separate frozen evidence without another model stage', async () => {
  const f = await fixture(); f.input.configuration.research = { ...defaultWritingResearch(), enabled: true };
  const researchedPlan: WritingPlan = { ...plan, research: { queries: [
    { query: 'Regional fish distribution documentation', purpose: 'Explain the distribution context.', evidenceIds: ['s2'] },
  ], reason: 'Useful context beyond the interview.' } };
  const prompts: ReturnType<typeof requestData>[] = []; let searches = 0;
  const generate: NonNullable<WritingRunInput['generate']> = async (...args) => {
    const data = requestData(args); prompts.push(data);
    if (prompts.length === 1) return generated(researchedPlan);
    if (prompts.length === 2) {
      assert.equal(searches, 1, 'research occurs after planning and before writing');
      return generated({ ...article, blocks: [...article.blocks, { id: 'context', type: 'paragraph', level: 2, items: [],
        text: 'Segundo o documento técnico, a distribuição regional exige planejamento logístico.', evidenceIds: [data.research.sources[0].id] }] });
    }
    return generated(ready);
  };
  const search: NonNullable<WritingRunInput['search']> = async () => {
    searches++; assert.equal(prompts.length, 1);
    return { requestId: 'actual-search', credits: 1, sources: [{ title: 'Technical distribution document', url: 'https://primary.test/document',
      site: 'primary.test', excerpt: 'A distribuição regional exige planejamento logístico.', publishedOn: '2026-01-10' }] };
  };
  try {
    const result = await runWritingOrchestration({ ...f.input, generate, search, validateArticle: (_article, external) => {
      assert.equal(external.length, 1); assert.equal(external[0].kind, 'external'); return [];
    } });
    assert.equal(prompts.length, 3); assert.equal(result.inputTokens, 30); assert.equal(result.outputTokens, 60);
    assert.equal(result.externalSources?.length, 1); assert.equal(result.research?.queries[0].credits, 1);
    for (const prompt of prompts) assert.deepEqual(prompt.source, source, 'external evidence is never merged into the original content');
    assert.equal(prompts[0].research, undefined);
    assert.deepEqual(prompts[1].research, prompts[2].research);
    assert.deepEqual(prompts[2].plan.essentialFactIds, plan.essentialFactIds, 'research cannot rewrite the original fact plan');
    assert.deepEqual(f.traces.filter(trace => trace.status === 'completed').map(trace => trace.stage), ['plan', 'research', 'write', 'review']);
    await runWritingOrchestration({ ...f.input, generate, search, validateArticle: () => [] });
    assert.equal(searches, 1); assert.equal(prompts.length, 3, 'the frozen research and model responses are reused on retry');
  } finally { await f.cleanup(); }
});

test('web snippets cannot become interview quotations even when copied literally', async () => {
  const f = await fixture(); f.input.configuration.research = { ...defaultWritingResearch(), enabled: true };
  let calls = 0;
  const generate: NonNullable<WritingRunInput['generate']> = async (...args) => {
    calls++;
    if (calls === 1) return generated({ ...plan, research: { queries: [{ query: 'Distribution context', purpose: 'Explain the context.', evidenceIds: ['s2'] }], reason: 'Relevant context.' } });
    const data = requestData(args);
    return generated({ ...article, blocks: [...article.blocks, { id: 'external-quote', type: 'quote', level: 2, items: [],
      text: data.research.sources[0].excerpt, evidenceIds: [data.research.sources[0].id] }] });
  };
  try {
    await assert.rejects(runWritingOrchestration({ ...f.input, generate, search: async () => ({ requestId: null, credits: null,
      sources: [{ title: 'External article', url: 'https://primary.test/doc', site: 'primary.test', excerpt: 'Uma fala externa que não pertence à entrevista.' }] }) }), /UNSUPPORTED_ARTICLE_QUOTE/);
    assert.equal(calls, 2); assert.equal(f.traces.at(-1)?.stage, 'write');
  } finally { await f.cleanup(); }
});

test('research cannot rescue a needs-reporting plan and legacy settings never search', async () => {
  for (const enabled of [false, true]) {
    const f = await fixture();
    if (enabled) f.input.configuration.research = { ...defaultWritingResearch(), enabled: true };
    const value: WritingPlan = { ...plan, decision: 'needs_reporting', issues: ['The identity of the interviewed person is unknown.'],
      ...(enabled ? { research: { queries: [], reason: 'The missing interview identity requires reporting, not web guessing.' } } : {}) };
    const provider = mock([value]);
    try {
      await assert.rejects(runWritingOrchestration({ ...f.input, generate: provider.generate, search: async () => { assert.fail('no search may run'); } }), /WRITING_NEEDS_REPORTING/);
      assert.equal(provider.calls.length, 1); assert.ok(!f.traces.some(trace => trace.stage === 'research'));
    } finally { await f.cleanup(); }
  }
});

test('research requests must be present when enabled, bounded, unique and grounded in original IDs', () => {
  const researchSettings = { ...defaultWritingResearch(), enabled: true, maxQueries: 1 };
  const query = { query: 'Distribution', purpose: 'Explain context.', evidenceIds: ['s2'] };
  for (const value of [plan,
    { ...plan, research: { queries: [query, { ...query, query: 'Another question' }], reason: 'Two queries exceed this saved budget.' } },
    { ...plan, research: { queries: [{ ...query, evidenceIds: ['not-original'] }], reason: 'Unknown original.' } },
  ]) assert.throws(() => validateWritingOutput('plan', value, evidence, undefined, { researchSettings }), /WRITING_INVALID_OUTPUT|UNKNOWN_EVIDENCE/);
  assert.throws(() => validateWritingOutput('plan', { ...plan, research: { queries: [query, query], reason: 'Repeated query.' } }, evidence), /WRITING_INVALID_OUTPUT/);
  const skipped = { ...plan, research: { queries: [], reason: 'No external context is relevant to this brief.' } };
  assert.deepEqual(validateWritingOutput('plan', skipped, evidence, undefined, { researchSettings }), skipped);
});

test('research failure never silently enriches an original-only fallback', async () => {
  for (const failureMode of ['stop', 'continue_original'] as const) {
    const f = await fixture(); f.input.configuration.research = { ...defaultWritingResearch(), enabled: true, failureMode };
    const researchPlan = { ...plan, research: { queries: [
      { query: 'Successful context', purpose: 'Context.', evidenceIds: ['s2'] }, { query: 'Failed context', purpose: 'Other context.', evidenceIds: ['s1'] },
    ], reason: 'Additional context.' } };
    const provider = mock([researchPlan, article, ready]);
    const search: NonNullable<WritingRunInput['search']> = async query => {
      if (query.startsWith('Failed')) throw new FlowError('TAVILY_UNAVAILABLE', 503);
      return { sources: [{ title: 'Partial context', url: 'https://primary.test/context', site: 'primary.test', excerpt: 'A partial external result.' }], requestId: null, credits: 1 };
    };
    try {
      if (failureMode === 'stop') {
        await assert.rejects(runWritingOrchestration({ ...f.input, generate: provider.generate, search }), /WRITING_RESEARCH_FAILED/);
        assert.equal(provider.calls.length, 1);
      } else {
        const result = await runWritingOrchestration({ ...f.input, generate: provider.generate, search });
        assert.equal(provider.calls.length, 3); assert.deepEqual(result.externalSources, []);
        assert.equal(result.research?.sources.length, 1, 'partial search evidence remains in the execution snapshot');
        assert.deepEqual(requestData(provider.calls[1]).research.sources, [], 'failed batches are not supplied as usable context');
        assert.deepEqual(requestData(provider.calls[1]).source, source);
        assert.match(requestData(provider.calls[1]).research.reason, /apenas com o conteúdo original/);
      }
    } finally { await f.cleanup(); }
  }
});

test('optional suggestions remain visible without triggering a correction call', async () => {
  const suggestion: WritingReview['issues'][number] = { id: 'optional-heading', severity: 'minor', code: 'OPTIONAL_HEADING', blockId: 'lead',
    message: 'Uma divisão diferente também seria válida.', evidenceIds: ['s1', 's2'], suggestion: 'O editor pode optar por outro intertítulo.' };
  const assessment: WritingReview = { ...ready, issues: [suggestion] };
  const f = await fixture(), provider = mock([plan, article, assessment]);
  try {
    const result = await runWritingOrchestration({ ...f.input, generate: provider.generate });
    assert.equal(provider.calls.length, 3);
    assert.deepEqual(result.review.issues, [suggestion]);
    assert.deepEqual((f.traces.at(-1)?.output as WritingReview).issues, [suggestion]);
  } finally { await f.cleanup(); }
});

test('a substantive correction can finish with an audited optional suggestion still unresolved', async () => {
  const suggestion: WritingReview['issues'][number] = { id: 'optional-heading', severity: 'minor', code: 'OPTIONAL_HEADING', blockId: 'quote',
    message: 'A divisão é uma escolha editorial.', evidenceIds: ['s1'], suggestion: 'Considerar outro intertítulo, sem obrigação de alterar.' };
  const before: WritingReview = { ...revise, issues: [...revise.issues, suggestion] };
  const base = rechecked();
  const after: WritingReview = { ...base, decision: 'revise', issues: [suggestion], audit: { ...base.audit!, issueChecks: [...base.audit!.issueChecks,
    { issueId: suggestion.id, status: 'unresolved', articlePassages: [{ blockId: 'quote', text: article.blocks[1].text }],
      reason: 'A alternativa de divisão permanece opcional; a estrutura atual continua válida.' }] } };
  const f = await fixture(), provider = mock([plan, article, before, fixed, after]);
  try {
    const result = await runWritingOrchestration({ ...f.input, generate: provider.generate });
    assert.equal(provider.calls.length, 5);
    assert.equal(result.review.decision, 'ready_for_human');
    assert.deepEqual(result.review.audit?.issueChecks.map(check => [check.issueId, check.status]), [['i1', 'resolved'], ['optional-heading', 'unresolved']]);
    assert.deepEqual(result.review.issues, [suggestion]);
    assert.deepEqual(requestData(provider.calls[4]).review.issues, before.issues);
    assert.deepEqual(result.review.audit?.factChecks, [fixedPreservation]);
    assert.deepEqual(f.traces.at(-1)?.providerOutput, after);
  } finally { await f.cleanup(); }
});

test('a consistent minor-only revise verdict is normalized visibly and remains consistent on cache reuse', async () => {
  const suggestion: WritingReview['issues'][number] = { id: 'optional-heading', severity: 'minor', code: 'OPTIONAL_HEADING', blockId: 'lead',
    message: 'Outra divisão também seria válida.', evidenceIds: ['s1', 's2'], suggestion: 'O editor pode optar por outro intertítulo.' };
  const assessment: WritingReview = { ...ready, decision: 'revise', issues: [suggestion] };
  const f = await fixture(), provider = mock([plan, article, assessment]);
  try {
    const result = await runWritingOrchestration({ ...f.input, generate: provider.generate });
    assert.equal(provider.calls.length, 3);
    assert.equal(result.review.decision, 'ready_for_human');
    assert.deepEqual(result.review.issues, [suggestion]);
    assert.match(result.review.summary, /decisão foi ajustada/);
    assert.deepEqual(f.traces.at(-1)?.providerOutput, assessment);
    f.traces.length = 0;
    const cached = await runWritingOrchestration({ ...f.input, generate: provider.generate });
    assert.equal(provider.calls.length, 3);
    assert.deepEqual(cached.review, result.review);
    assert.equal(f.traces.at(-1)?.cached, true);
    assert.deepEqual(f.traces.at(-1)?.providerOutput, assessment);
  } finally { await f.cleanup(); }
});

test('minor severity never overrides reporting needs or an incomplete fact audit', async () => {
  const issue = { ...revise.issues[0], severity: 'minor' as const };
  const scenarios = [
    { review: { ...ready, decision: 'needs_reporting' as const, issues: [issue] }, code: 'WRITING_NEEDS_REPORTING' },
    { review: { ...ready, decision: 'revise' as const, issues: [issue], audit: { ...ready.audit!, factChecks: [{ ...preservation, status: 'partial' as const }] } }, code: 'WRITING_REVIEW_UNRESOLVED' },
  ];
  for (const scenario of scenarios) {
    const f = await fixture(), provider = mock([plan, article, scenario.review]);
    f.input.configuration.maxCorrections = 0;
    try {
      await assert.rejects(runWritingOrchestration({ ...f.input, generate: provider.generate }), new RegExp(scenario.code));
      assert.equal(provider.calls.length, 3);
      assert.deepEqual(f.traces.at(-1)?.output, scenario.review);
      assert.equal(f.traces.at(-1)?.providerOutput, undefined);
    } finally { await f.cleanup(); }
  }
});

test('original substantive severity cannot be downgraded or hidden to approve a pending correction', () => {
  for (const [original, downgraded] of [['major', 'minor'], ['critical', 'major'], ['critical', 'minor']] as const) {
    const previous: WritingReview = { ...revise, issues: [{ ...revise.issues[0], severity: original }] };
    const pending = rechecked({ ...revise, issues: [{ ...revise.issues[0], severity: downgraded }] }, 'i1', false);
    const context = { plan, review: previous, previousArticle: article };
    assert.throws(() => validateWritingOutput('review', pending, evidence, fixed, context), /WRITING_INVALID_OUTPUT/);
    assert.throws(() => validateWritingOutput('review', { ...pending, decision: 'ready_for_human' }, evidence, fixed, context), /WRITING_INVALID_OUTPUT/);
    const hidden = rechecked(ready, 'i1', false);
    assert.throws(() => validateWritingOutput('review', hidden, evidence, fixed, context), /WRITING_INVALID_OUTPUT/);
    const renamed = { ...pending, decision: 'ready_for_human', issues: [{ ...pending.issues[0], id: 'renamed', severity: 'minor' }] };
    assert.throws(() => validateWritingOutput('review', renamed, evidence, fixed, context), /WRITING_INVALID_OUTPUT/);
  }
});

test('minor-only current findings do not normalize an unresolved original substantive correction', async () => {
  const pending = rechecked({ ...revise, issues: [{ ...revise.issues[0], id: 'renamed', severity: 'minor' }] }, 'i1', false);
  const f = await fixture(), provider = mock([plan, article, revise, fixed, pending]);
  try {
    await assert.rejects(runWritingOrchestration({ ...f.input, generate: provider.generate }), /WRITING_REVIEW_UNRESOLVED/);
    assert.equal(provider.calls.length, 5);
    assert.deepEqual(f.traces.at(-1)?.output, pending);
    assert.equal(f.traces.at(-1)?.providerOutput, undefined);
  } finally { await f.cleanup(); }
});

test('every stage receives dated and undated source context without substituting the execution date', async () => {
  const f = await fixture(), provider = mock([plan, article, revise, fixed, rechecked()]);
  const brief = { ...f.input.brief, today: '20 de outubro de 2026', temporalContext: { executionDate: '2026-10-20', sources: [
    { sourceId: 'interview-a', title: 'Entrevista de Ana', recordedOn: '2026-05-20' },
    { sourceId: 'interview-b', title: 'Entrevista de Bruno', recordedOn: null },
  ] } };
  const original = structuredClone(brief);
  try {
    await runWritingOrchestration({ ...f.input, brief, generate: provider.generate });
    assert.equal(provider.calls.length, 5);
    for (const call of provider.calls) {
      assert.deepEqual(requestData(call).brief, original);
      assert.ok(call[4]!.systemPrompt.includes('não são datas de entrevista, evento ou publicação'));
    }
    assert.deepEqual(brief, original);
    const completed = f.traces.filter(trace => trace.status === 'completed');
    assert.ok(completed.every(trace => JSON.parse(trace.prompt.user.slice(trace.prompt.user.indexOf('\n') + 1)).brief.temporalContext.sources[1].recordedOn === null));
  } finally { await f.cleanup(); }
});

test('missing reporting, a disabled correction and an unresolved recheck stop without returning approval', async () => {
  const cases = [
    { values: [{ ...plan, decision: 'needs_reporting', issues: ['Falta confirmar o lançamento.'] }], code: 'WRITING_NEEDS_REPORTING', corrections: 1 as const },
    { values: [plan, article, { ...revise, decision: 'needs_reporting' }], code: 'WRITING_NEEDS_REPORTING', corrections: 1 as const },
    { values: [plan, article, revise], code: 'WRITING_REVIEW_UNRESOLVED', corrections: 0 as const },
    { values: [plan, article, revise, fixed, rechecked(revise, 'i1', false)], code: 'WRITING_REVIEW_UNRESOLVED', corrections: 1 as const },
  ];
  for (const scenario of cases) {
    const f = await fixture(), provider = mock(scenario.values); f.input.configuration.maxCorrections = scenario.corrections;
    try {
      await assert.rejects(runWritingOrchestration({ ...f.input, generate: provider.generate }), new RegExp(scenario.code));
      assert.equal(provider.calls.length, scenario.values.length);
      assert.deepEqual(f.traces.at(-1)?.output, scenario.values.at(-1), 'retain diagnostic output for the front');
    } finally { await f.cleanup(); }
  }
});

test('deterministic article gates override model approval and use the same correction budget', async () => {
  const sizeIssue: WritingReview['issues'][number] = { ...revise.issues[0], id: 'size', code: 'ARTICLE_SIZE_TOO_SHORT', blockId: '$article',
    message: 'O texto não cumpre o tamanho configurado.', suggestion: 'Desenvolver os fatos disponíveis sem inventar informação.' };
  const f = await fixture(), provider = mock([plan, article, ready, fixed, rechecked(ready, 'size')]);
  try {
    const result = await runWritingOrchestration({ ...f.input, generate: provider.generate,
      validateArticle: value => value.blocks[0].text === fixed.blocks[0].text ? [] : [sizeIssue] });
    assert.deepEqual(result.article, fixed); assert.equal(provider.calls.length, 5);
    assert.deepEqual(requestData(provider.calls[2]).deterministicChecks, [sizeIssue]);
    assert.deepEqual(requestData(provider.calls[4]).deterministicChecks, []);
    const overridden = f.traces.find(trace => trace.stage === 'review' && trace.status === 'completed');
    assert.equal((overridden?.output as WritingReview).decision, 'revise');
    assert.deepEqual(overridden?.providerOutput, ready);
    assert.deepEqual(requestData(provider.calls[3]).review.issues, [sizeIssue]);
  } finally { await f.cleanup(); }
  const unresolved = await fixture();
  try {
    const provider = mock([plan, article, ready, fixed, rechecked(ready, 'size')]);
    await assert.rejects(runWritingOrchestration({ ...unresolved.input, generate: provider.generate, validateArticle: () => [sizeIssue] }), /WRITING_REVIEW_UNRESOLVED/);
    assert.equal(provider.calls.length, 5);
    assert.equal((unresolved.traces.at(-1)?.output as WritingReview).decision, 'revise');
  } finally { await unresolved.cleanup(); }
});

test('unknown evidence and fabricated quotations fail before review and remain visible as failed output', async () => {
  const invalids = [
    { value: { ...article, titleEvidenceIds: ['missing'] }, code: 'UNKNOWN_EVIDENCE' },
    { value: { ...article, title: 'Empresa promete “distribuição nacional imediata”' }, code: 'UNSUPPORTED_ARTICLE_QUOTE' },
    { value: { ...article, blocks: [{ ...article.blocks[1], text: 'O lançamento nacional acontecerá em dezembro.' }] }, code: 'UNSUPPORTED_ARTICLE_QUOTE' },
  ];
  for (const invalid of invalids) {
    const f = await fixture(), provider = mock([plan, invalid.value]);
    try {
      await assert.rejects(runWritingOrchestration({ ...f.input, generate: provider.generate }), new RegExp(invalid.code));
      assert.equal(provider.calls.length, 2);
      assert.equal(f.traces.at(-1)?.status, 'failed'); assert.equal(f.traces.at(-1)?.error, invalid.code);
      assert.deepEqual(f.traces.at(-1)?.output, invalid.value);
      assert.equal((await readdir(f.input.directory)).length, 1, 'only the validated plan is cached');
    } finally { await f.cleanup(); }
  }
});

test('cached stages are revalidated, have zero billed tokens, and change with the editorial request', async () => {
  const f = await fixture(), provider = mock([plan, article, ready]);
  try {
    await runWritingOrchestration({ ...f.input, generate: provider.generate });
    f.traces.length = 0;
    const second = await runWritingOrchestration({ ...f.input, generate: provider.generate });
    assert.equal(provider.calls.length, 3); assert.equal(second.inputTokens, 0); assert.equal(second.outputTokens, 0);
    assert.ok(f.traces.filter(trace => trace.status === 'completed').every(trace => trace.cached));
    const writeHash = f.traces.find(trace => trace.stage === 'write')!.hash;
    await cacheWrite(f.input.directory, 'writing-' + writeHash, generated({ ...article, titleEvidenceIds: ['unknown'] }));
    const refresh = mock([article]);
    await runWritingOrchestration({ ...f.input, generate: refresh.generate });
    assert.equal(refresh.calls.length, 1, 'an invalid cached draft is discarded and regenerated');
    f.input.policy.guide.voice = 'Conciso e com atribuição explícita';
    const changed = mock([plan, article, ready]);
    await runWritingOrchestration({ ...f.input, generate: changed.generate });
    assert.equal(changed.calls.length, 3, 'guide changes invalidate every affected request');
  } finally { await f.cleanup(); }
});

test('a model change invalidates only its request when the earlier outputs remain identical', async () => {
  const f = await fixture();
  try {
    await runWritingOrchestration({ ...f.input, generate: mock([plan, article, ready]).generate });
    f.input.configuration.stages.review.model = 'anthropic/claude-sonnet-4-6';
    const changed = mock([ready]);
    await runWritingOrchestration({ ...f.input, generate: changed.generate });
    assert.equal(changed.calls.length, 1); assert.equal(changed.calls[0][4]!.model, 'anthropic/claude-sonnet-4-6');
  } finally { await f.cleanup(); }
});

test('cancellation before and during a provider call never advances or caches the aborted stage', async () => {
  const f = await fixture(), controller = new AbortController(), provider = mock([]);
  try {
    controller.abort();
    await assert.rejects(runWritingOrchestration({ ...f.input, signal: controller.signal, generate: provider.generate }), /JOB_INTERRUPTED/);
    assert.equal(provider.calls.length, 0); assert.equal(f.traces.length, 0);
    const during = new AbortController(); let calls = 0;
    await assert.rejects(runWritingOrchestration({ ...f.input, signal: during.signal, generate: async () => { calls++; during.abort(); return generated(plan); } }), /JOB_INTERRUPTED/);
    assert.equal(calls, 1); assert.equal(f.traces.at(-1)?.error, 'JOB_INTERRUPTED');
    assert.deepEqual(await readdir(f.input.directory), []);
  } finally { await f.cleanup(); }
});

test('provider failures retain the stage error and do not trigger an editorial correction', async () => {
  const f = await fixture(), provider = mock([plan, article]); let calls = 0;
  try {
    await assert.rejects(runWritingOrchestration({ ...f.input, generate: async (...args) => {
      calls++;
      if (calls === 3) throw new FlowError('ANTHROPIC_RATE_LIMIT', 502, true, 30);
      return provider.generate(...args);
    } }), /ANTHROPIC_RATE_LIMIT/);
    assert.equal(calls, 3); assert.equal(f.traces.at(-1)?.stage, 'review');
    assert.equal(f.traces.at(-1)?.status, 'failed'); assert.equal(f.traces.at(-1)?.error, 'ANTHROPIC_RATE_LIMIT');
    assert.equal((await readdir(f.input.directory)).length, 2);
  } finally { await f.cleanup(); }
});

test('cancellation while the final trace persists still prevents a ready result', async () => {
  const f = await fixture(), controller = new AbortController(), provider = mock([plan, article, ready]);
  try {
    await assert.rejects(runWritingOrchestration({ ...f.input, signal: controller.signal, generate: provider.generate,
      trace: async trace => { await f.input.trace(trace); if (trace.stage === 'review' && trace.status === 'completed') controller.abort(); } }), /JOB_INTERRUPTED/);
    assert.equal(provider.calls.length, 3); assert.equal(f.traces.at(-1)?.status, 'failed');
  } finally { await f.cleanup(); }
});

test('oversize or invalid original content fails explicitly without provider calls or silent truncation', async () => {
  const f = await fixture(), provider = mock([]);
  try {
    f.input.configuration.maxSourceCharacters = 1;
    await assert.rejects(runWritingOrchestration({ ...f.input, generate: provider.generate }), /WRITING_SOURCE_TOO_LARGE/);
    f.input.configuration.maxSourceCharacters = 100000;
    await assert.rejects(runWritingOrchestration({ ...f.input, source: [source[0], source[0]], generate: provider.generate }), /EMPTY_EDITORIAL_SOURCE/);
    assert.equal(provider.calls.length, 0); assert.deepEqual(f.input.source, source);
  } finally { await f.cleanup(); }
});

test('semantic validation rejects contradictory review decisions, missing blocks and malformed article structure', () => {
  for (const value of [{ ...revise, decision: 'ready_for_human' }, { ...ready, decision: 'revise' },
    { ...revise, issues: [{ ...revise.issues[0], blockId: 'missing' }] }])
    assert.throws(() => validateWritingOutput('review', value, evidence, article, { plan }), /WRITING_INVALID_OUTPUT/);
  for (const blocks of [[{ ...article.blocks[0], type: 'list', items: [] }], [{ ...article.blocks[0], type: 'heading' }],
    [article.blocks[0], article.blocks[0]], [{ ...article.blocks[0], level: 3 }]])
    assert.throws(() => validateWritingOutput('write', { ...article, blocks }, evidence), /WRITING_INVALID_OUTPUT/);
  assert.throws(() => validateWritingOutput('plan', { ...plan, essentialFactIds: ['missing'] }, evidence), /WRITING_INVALID_OUTPUT/);
  assert.throws(() => validateWritingOutput('plan', { ...plan, facts: [{ ...plan.facts[0], kind: 'quote', text: 'Uma fala inventada.' }] }, evidence), /UNSUPPORTED_ARTICLE_QUOTE/);
});

test('review coverage must enumerate each essential fact exactly once and cite current literal passages', () => {
  const invalid = [
    { ...ready, audit: undefined },
    { ...ready, audit: { ...ready.audit!, factChecks: [] } },
    { ...ready, audit: { ...ready.audit!, factChecks: [preservation, preservation] } },
    { ...ready, audit: { ...ready.audit!, factChecks: [{ ...preservation, factId: 'unknown' }] } },
    { ...ready, audit: { ...ready.audit!, factChecks: [{ ...preservation, articlePassages: [] }] } },
    { ...ready, audit: { ...ready.audit!, factChecks: [{ ...preservation, articlePassages: [{ blockId: 'missing', text: preservation.articlePassages[0].text }] }] } },
    { ...ready, audit: { ...ready.audit!, factChecks: [{ ...preservation, articlePassages: [{ blockId: 'lead', text: 'A distribuição nacional começa em novembro.' }] }] } },
    { ...ready, audit: { ...ready.audit!, factChecks: [{ ...preservation, articlePassages: [{ blockId: 'lead', text: '\u200b' }] }] } },
    { ...ready, audit: { ...ready.audit!, factChecks: [{ ...preservation, evidenceIds: ['s1'] }] } },
    { ...ready, audit: { ...ready.audit!, issueChecks: [{ issueId: 'unexpected', status: 'resolved', articlePassages: [], reason: 'No previous issue existed.' }] } },
  ];
  for (const value of invalid) assert.throws(() => validateWritingOutput('review', value, evidence, article, { plan }), /WRITING_INVALID_OUTPUT/);
  assert.deepEqual(validateWritingOutput('review', ready, evidence, article, { plan }), ready);
});

test('approval cannot contradict missing, partial or contradicted essential fact coverage', () => {
  for (const status of ['partial', 'missing', 'contradicted'] as const) {
    const value = { ...ready, audit: { ...ready.audit!, factChecks: [{ ...preservation, status,
      articlePassages: status === 'missing' ? [] : preservation.articlePassages }] } };
    assert.throws(() => validateWritingOutput('review', value, evidence, article, { plan }), /WRITING_INVALID_OUTPUT/);
  }
});

test('editorial audit requires every axis exactly once with inspectable passages', () => {
  const checks = passedEditorialChecks();
  const invalid = [undefined, [], checks.slice(1), [checks[0], checks[0], ...checks.slice(2)],
    [{ ...checks[0], criterion: 'invented' }, ...checks.slice(1)],
    [{ ...checks[0], articlePassages: [{ blockId: 'lead', text: 'Trecho que não existe no artigo.' }] }, ...checks.slice(1)],
    [{ ...checks[0], articlePassages: [{ blockId: 'missing', text: article.blocks[0].text }] }, ...checks.slice(1)],
    [{ ...checks[0], articlePassages: [{ blockId: 'lead', text: '\u200b' }] }, ...checks.slice(1)],
  ];
  for (const editorialChecks of invalid) assert.throws(() => validateWritingOutput('review', { ...ready, audit: { ...ready.audit!, editorialChecks } },
    evidence, article, { plan }), /WRITING_INVALID_OUTPUT/);
  const withPassage = { ...ready, audit: { ...ready.audit!, editorialChecks: [{ ...checks[0], articlePassages: preservation.articlePassages }, ...checks.slice(1)] } };
  assert.deepEqual(validateWritingOutput('review', withPassage, evidence, article, { plan }), withPassage);
});

test('editorial revise links current blocking issues and cannot coexist with approval', () => {
  const checks = passedEditorialChecks();
  const pending = { ...checks[0], status: 'revise' as const, issueIds: ['i1'], articlePassages: preservation.articlePassages,
    reason: 'O prazo central aparece depois da apresentação institucional.' };
  const assessment: WritingReview = { ...revise, audit: { ...revise.audit!, editorialChecks: [pending, ...checks.slice(1)] } };
  assert.deepEqual(validateWritingOutput('review', assessment, evidence, article, { plan }), assessment);
  for (const issueIds of [[], ['missing'], ['i1', 'i1']]) assert.throws(() => validateWritingOutput('review', {
    ...assessment, audit: { ...assessment.audit!, editorialChecks: [{ ...pending, issueIds }, ...checks.slice(1)] },
  }, evidence, article, { plan }), /WRITING_INVALID_OUTPUT/);
  assert.throws(() => validateWritingOutput('review', { ...assessment, issues: revise.issues.map(issue => ({ ...issue, severity: 'minor' })) },
    evidence, article, { plan }), /WRITING_INVALID_OUTPUT/);
  assert.throws(() => validateWritingOutput('review', { ...assessment, audit: { ...assessment.audit!, editorialChecks: [
    { ...pending, status: 'pass' }, ...checks.slice(1),
  ] } }, evidence, article, { plan }), /WRITING_INVALID_OUTPUT/);
  assert.throws(() => validateWritingOutput('review', { ...assessment, decision: 'ready_for_human' }, evidence, article, { plan }), /WRITING_INVALID_OUTPUT/);
});

test('certainty loss in a nonessential fact triggers correction without dropping essential information', async () => {
  const f = await fixture();
  const extra = { id: 's3', text: 'Acho que participamos de todas as edições da feira.', speaker: 'Ana' };
  f.input.source.push(extra);
  const bad = structuredClone(article);
  bad.blocks.push({ id: 'history', type: 'paragraph', level: 2, text: 'Segundo Ana, a empresa participou de todas as edições da feira.', items: [], evidenceIds: ['s3'] });
  const corrected = structuredClone(bad);
  corrected.blocks[2].text = 'Ana acredita que a empresa participou de todas as edições da feira.';
  const issue: WritingReview['issues'][number] = { id: 'certainty', severity: 'major', code: 'certainty_loss', blockId: 'history',
    message: 'A atribuição não preserva a incerteza manifestada pela fonte.', evidenceIds: ['s3'], suggestion: 'Preservar a ressalva da fonte ou retirar o detalhe secundário.' };
  const first: WritingReview = { ...ready, decision: 'revise', issues: [issue], audit: { ...ready.audit!, editorialChecks: passedEditorialChecks().map(check =>
    check.criterion === 'uncertainty' ? { ...check, status: 'revise', articlePassages: [{ blockId: 'history', text: bad.blocks[2].text }], issueIds: ['certainty'],
      reason: 'O artigo tornou uma lembrança incerta em declaração categórica, embora esse detalhe não esteja entre os fatos essenciais.' } : check) } };
  const second: WritingReview = { ...ready, audit: { ...ready.audit!, issueChecks: [{ issueId: 'certainty', status: 'resolved',
    articlePassages: [{ blockId: 'history', text: corrected.blocks[2].text }], reason: 'A nova versão preserva o grau de certeza da fonte.' }] } };
  const provider = mock([plan, bad, first, corrected, second]);
  try {
    const result = await runWritingOrchestration({ ...f.input, generate: provider.generate });
    assert.deepEqual(result.article, corrected);
    assert.deepEqual(result.review.audit?.factChecks, [preservation]);
    assert.equal(provider.calls.length, 5);
    assert.deepEqual(requestData(provider.calls[4]).previousArticle, bad);
    assert.deepEqual(requestData(provider.calls[4]).source.at(-1), extra);
  } finally { await f.cleanup(); }
});

test('negative-control audit accepts partial coverage and a preserved cause linked across a transition', () => {
  // Reduced from the real MSD negative control: the old article lost the long-term purpose,
  // while the market explanation and its transition live in blocks with different source IDs.
  const costText = 'Na palestra que apresentou durante o evento, Blanch comparou a distribuição de custos entre ração, sanidade e genética na tilapicultura com outras cadeias — suínos, aves e salmonicultura.';
  const climateText = 'Na explicação de Blanch, fatores climáticos limitam a disponibilidade de formas jovens, enquanto o mercado consumidor opera com liquidez.';
  const transition = 'Com base nesse cenário, Blanch projetou mercado favorável pelo menos até a Quaresma de 2027 e ampliou a perspectiva:';
  const sources = new Map([
    ['cost-purpose', 'A palestra trata dos custos de sanidade e como eles podem ser modificados a longo prazo.'],
    ['comparison', 'A palestra compara custos de ração, sanidade e genética com suínos, aves e salmonicultura.'],
    ['climate', 'A perspectiva favorável vem principalmente de questões climáticas, pouca disponibilidade de formas jovens e liquidez do consumo.'],
    ['forecast', 'A perspectiva é de mercado bom pelo menos até a Quaresma em 2027.'],
  ]);
  const originalPlan: WritingPlan = { decision: 'ready', angle: 'Custos de sanidade e mercado', facts: [
    { id: 'f07', text: sources.get('cost-purpose')!, kind: 'reported_fact', evidenceIds: ['cost-purpose'] },
    { id: 'f14', text: sources.get('climate')!, kind: 'opinion', evidenceIds: ['climate'] },
  ], essentialFactIds: ['f07', 'f14'], outline: ['Palestra e perspectiva'], issues: [] };
  const previous: WritingArticle = { title: 'Custos e perspectivas de mercado', dek: '', titleEvidenceIds: ['comparison', 'climate'], dekEvidenceIds: [], blocks: [
    { id: 'block-2', type: 'paragraph', level: 2, text: costText, items: [], evidenceIds: ['comparison'] },
    { id: 'block-6', type: 'paragraph', level: 2, text: climateText, items: [], evidenceIds: ['climate'] },
    { id: 'block-7', type: 'paragraph', level: 2, text: transition, items: [], evidenceIds: ['forecast'] },
  ] };
  const assessment: WritingReview = { decision: 'revise', summary: 'A condensação perdeu a finalidade de longo prazo.', issues: [
    { id: 'r01', severity: 'major', code: 'essential_fact_partial', blockId: 'block-2', message: 'Falta a finalidade de modificar custos no longo prazo.',
      evidenceIds: ['cost-purpose'], suggestion: 'Restituir a finalidade sustentada pela fonte.' },
  ], audit: { factualSummary: 'A finalidade está incompleta; a explicação do mercado foi preservada.', editorialSummary: 'Repor informação sem preenchimento.', editorialChecks: passedEditorialChecks(), factChecks: [
    { factId: 'f07', status: 'partial', articlePassages: [{ blockId: 'block-2', text: costText }], evidenceIds: ['cost-purpose'],
      reason: 'Registra a palestra e os custos, mas não como podem ser modificados no longo prazo.' },
    { factId: 'f14', status: 'preserved', articlePassages: [{ blockId: 'block-6', text: climateText }, { blockId: 'block-7', text: transition }],
      evidenceIds: ['climate'], reason: 'A explicação está no primeiro trecho; a transição a vincula à perspectiva favorável.' },
  ], issueChecks: [] } };
  assert.deepEqual(validateWritingOutput('review', assessment, sources, previous, { plan: originalPlan }), assessment);
  const unsupported = structuredClone(assessment);
  unsupported.audit!.factChecks[1].articlePassages = [{ blockId: 'block-7', text: transition }];
  assert.throws(() => validateWritingOutput('review', unsupported, sources, previous, { plan: originalPlan }), /WRITING_INVALID_OUTPUT/,
    'preserved still requires a literal passage linked to the original fact, not only a transition');
});

test('failure diagnoses may cite literal passages without a fact evidence link but cannot approve', () => {
  const unlinked = structuredClone(article);
  unlinked.blocks[0].evidenceIds = ['s1'];
  assert.throws(() => validateWritingOutput('review', ready, evidence, unlinked, { plan }), /WRITING_INVALID_OUTPUT/);
  for (const status of ['partial', 'missing', 'contradicted'] as const) {
    const diagnostic: WritingReview = { ...revise, audit: { ...revise.audit!, factChecks: [{ ...preservation, status }] } };
    assert.deepEqual(validateWritingOutput('review', diagnostic, evidence, unlinked, { plan }), diagnostic);
    assert.throws(() => validateWritingOutput('review', { ...diagnostic, decision: 'ready_for_human' }, evidence, unlinked, { plan }), /WRITING_INVALID_OUTPUT/);
    assert.throws(() => validateWritingOutput('review', { ...diagnostic, audit: { ...diagnostic.audit!, factChecks: [{ ...preservation, status, evidenceIds: ['s1'] }] } },
      evidence, unlinked, { plan }), /WRITING_INVALID_OUTPUT/, 'the audit must still reference the original fact evidence');
  }
});

test('correction rechecks every previous issue and cannot claim unchanged or still-pending work was resolved', () => {
  const context = { plan, review: revise, previousArticle: article };
  assert.throws(() => validateWritingOutput('review', { ...ready, audit: { ...ready.audit!, factChecks: [fixedPreservation] } }, evidence, fixed, context), /WRITING_INVALID_OUTPUT/);
  assert.throws(() => validateWritingOutput('review', rechecked(ready, 'i1', false), evidence, fixed, context), /WRITING_INVALID_OUTPUT/);
  assert.throws(() => validateWritingOutput('review', rechecked(revise), evidence, fixed, context), /WRITING_INVALID_OUTPUT/);
  const unchanged = { ...rechecked(), audit: { ...rechecked().audit!, factChecks: [preservation],
    issueChecks: [{ issueId: 'i1', status: 'resolved' as const, articlePassages: preservation.articlePassages, reason: 'Claiming a correction without changing the article.' }] } };
  assert.throws(() => validateWritingOutput('review', unchanged, evidence, article, context), /WRITING_INVALID_OUTPUT/);
  assert.deepEqual(validateWritingOutput('review', rechecked(), evidence, fixed, context), rechecked());
});

test('changing only evidence and block identifiers cannot resolve an unchanged editorial problem', async () => {
  const metadataOnly = structuredClone(article);
  metadataOnly.titleEvidenceIds.reverse();
  metadataOnly.dekEvidenceIds.push('s1');
  metadataOnly.blocks[0].evidenceIds.reverse();
  metadataOnly.blocks[0].id = 'renamed-lead';
  const passages = [{ blockId: 'renamed-lead', text: preservation.articlePassages[0].text }];
  const dishonest: WritingReview = { ...ready, audit: { ...ready.audit!, factChecks: [{ ...preservation, articlePassages: passages }],
    issueChecks: [{ issueId: 'i1', status: 'resolved', articlePassages: passages,
      reason: 'A abertura foi corrigida, apesar de seu texto permanecer igual.' }] } };
  assert.deepEqual(validateWritingOutput('correct', metadataOnly, evidence), metadataOnly, 'the revised references and identifiers are valid');
  const f = await fixture(), provider = mock([plan, article, revise, metadataOnly, dishonest]);
  try {
    await assert.rejects(runWritingOrchestration({ ...f.input, generate: provider.generate }), (error: unknown) =>
      error instanceof FlowError && error.code === 'WRITING_INVALID_OUTPUT' && Boolean(error.reason?.includes('conteúdo publicável não foi alterado')));
    assert.equal(provider.calls.length, 5, 'an unchanged editorial problem is not retried or approved');
    assert.equal(f.traces.at(-1)?.status, 'failed');
    assert.deepEqual(f.traces.at(-1)?.output, dishonest, 'the rejected resolution remains inspectable');
  } finally { await f.cleanup(); }
});

test('a correction that drops the long-term purpose stays blocked despite resolving the wording issue', async () => {
  const f = await fixture();
  const text = 'A palestra comparou custos de ração, sanidade e genética e discutiu como os custos sanitários podem mudar no longo prazo.';
  const costPlan: WritingPlan = { decision: 'ready', angle: 'Custos de sanidade', facts: [
    { id: 'comparison', text: 'A palestra comparou custos de ração, sanidade e genética.', kind: 'reported_fact', evidenceIds: ['costs'] },
    { id: 'long-term', text: 'A palestra discutiu como os custos sanitários podem mudar no longo prazo.', kind: 'reported_fact', evidenceIds: ['costs'] },
  ], essentialFactIds: ['comparison', 'long-term'], outline: ['Comparação e finalidade de longo prazo'], issues: [] };
  const initial: WritingArticle = { title: 'Palestra discute custos sanitários', dek: '', titleEvidenceIds: ['costs'], dekEvidenceIds: [],
    blocks: [{ id: 'costs-block', type: 'paragraph', level: 2, text, items: [], evidenceIds: ['costs'] }] };
  const shortened = structuredClone(initial); shortened.blocks[0].text = 'A palestra comparou custos de ração, sanidade e genética.';
  const before: WritingReview = { decision: 'revise', summary: 'Editar a frase preservando as duas informações.', issues: [
    { id: 'wording', severity: 'major', code: 'WORDING', blockId: 'costs-block', message: 'A frase precisa de edição.', evidenceIds: ['costs'], suggestion: 'Melhorar a leitura mantendo a comparação e a finalidade de longo prazo.' },
  ], audit: { factualSummary: 'Dois fatos sustentados.', editorialSummary: 'Ajustar a leitura.', editorialChecks: passedEditorialChecks(), factChecks: costPlan.facts.map(fact => ({ factId: fact.id,
    status: 'preserved', articlePassages: [{ blockId: 'costs-block', text }], evidenceIds: ['costs'], reason: 'A frase contém a informação completa.' })), issueChecks: [] } };
  const after: WritingReview = { decision: 'revise', summary: 'O corte perdeu a finalidade de longo prazo.', issues: [
    { id: 'missing-purpose', severity: 'major', code: 'ESSENTIAL_FACT_MISSING', blockId: 'costs-block', message: 'A finalidade da palestra foi removida.', evidenceIds: ['costs'], suggestion: 'Restaurar a discussão sobre mudanças nos custos sanitários no longo prazo.' },
  ], audit: { factualSummary: 'A comparação continua correta, mas está incompleta para o recorte.', editorialSummary: 'A frase ficou menor ao custo de informação.', editorialChecks: passedEditorialChecks(), factChecks: [
    { factId: 'comparison', status: 'preserved', articlePassages: [{ blockId: 'costs-block', text: shortened.blocks[0].text }], evidenceIds: ['costs'], reason: 'A comparação permanece.' },
    { factId: 'long-term', status: 'missing', articlePassages: [], evidenceIds: ['costs'], reason: 'Não há trecho sobre mudanças no longo prazo.' },
  ], issueChecks: [{ issueId: 'wording', status: 'resolved', articlePassages: [{ blockId: 'costs-block', text: shortened.blocks[0].text }], reason: 'A frase foi editada, mas introduziu uma omissão diferente.' }] } };
  const provider = mock([costPlan, initial, before, shortened, after]);
  try {
    await assert.rejects(runWritingOrchestration({ ...f.input, source: [{ id: 'costs', text }], generate: provider.generate }), /WRITING_REVIEW_UNRESOLVED/);
    assert.equal(provider.calls.length, 5);
    assert.deepEqual(requestData(provider.calls[4]).previousArticle, initial);
    assert.deepEqual(requestData(provider.calls[4]).plan.essentialFactIds, ['comparison', 'long-term']);
    assert.equal((f.traces.at(-1)?.output as WritingReview).audit?.factChecks[1].status, 'missing');
  } finally { await f.cleanup(); }
});

test('an invalid quote format retains reporting issues and original provider output for diagnosis', async () => {
  const f = await fixture();
  const blocked = { ...plan, decision: 'needs_reporting', facts: [{ ...plan.facts[0], kind: 'quote', text: 'Citação literal: “A distribuição começa em novembro, apenas no estado de São Paulo.”' }],
    issues: ['Confirmar a identidade do entrevistado antes de atribuir a fala.'] };
  try {
    await assert.rejects(runWritingOrchestration({ ...f.input, generate: mock([blocked]).generate }), /UNSUPPORTED_ARTICLE_QUOTE/);
    assert.equal(f.traces.at(-1)?.status, 'failed');
    assert.deepEqual(f.traces.at(-1)?.output, blocked);
    assert.equal((f.traces.at(-1)?.output as WritingPlan).decision, 'needs_reporting');
  } finally { await f.cleanup(); }
});

test('effective reasoning effort is recorded and invalidates only the affected request', async () => {
  const f = await fixture();
  f.input.configuration.stages.write.model = 'anthropic/claude-opus-5-5';
  f.input.configuration.stages.write.effort = 'medium';
  try {
    await runWritingOrchestration({ ...f.input, generate: mock([plan, article, ready]).generate });
    const original = f.traces.find(trace => trace.stage === 'write')!;
    assert.deepEqual(original.parameters, { maxTokens: 8192, effort: 'medium' });
    f.input.configuration.stages.write.effort = 'high';
    f.traces.length = 0;
    const changed = mock([article]);
    await runWritingOrchestration({ ...f.input, generate: changed.generate });
    assert.equal(changed.calls.length, 1);
    assert.equal(changed.calls[0][4]?.effort, 'high');
    const latest = f.traces.find(trace => trace.stage === 'write')!;
    assert.notEqual(latest.hash, original.hash);
    assert.deepEqual(latest.parameters, { maxTokens: 8192, effort: 'high' });
  } finally { await f.cleanup(); }
});
