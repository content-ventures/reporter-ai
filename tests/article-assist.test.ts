import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEditorialEngine, emptyEditorialCheckpoint, appendEditorialEvent } from '../src/runtime/editorial-engine.ts';
import { contentHash } from '../src/domain/text/hash.ts';
import { blockText, articleStats } from '../src/domain/article.ts';
import type { ArticleBody } from '../src/domain/article.ts';
import { segmentRef } from '../src/domain/refs.ts';
import { applySuggestion } from '../src/domain/suggestion.ts';
import { articleAssistContext, articleAssistSuggestions, validateArticleAssistInput, runArticleAssist } from '../src/server/article-assist.ts';
import { pipelineRevision, defaultPipelineDefinition, withArticleAssist } from '../src/domain/pipeline.ts';
import { r1ArticleIssue } from '../src/domain/article-policy.ts';
import { RUN_KIND_OF } from '../src/ports/generation.ts';
import type { GenerationKind } from '../src/ports/generation.ts';
import type { EditorialJob } from '../src/ports/connected-workspace.ts';

let sequence = 0;
async function fixture() {
  const engine = createEditorialEngine(emptyEditorialCheckpoint(), { next: prefix => prefix + '-' + (++sequence) });
  const words = 'Na simulação a equipe avalia novos dados sobre o pescado e mantém as condições da fonte. ';
  const first = words.repeat(22) + 'A equipe afirma: “A previsão depende de testes reais.”';
  const second = words.repeat(14) + 'No episódio: “Ainda não temos um calendário definido.”';
  const material = 'Fonte fictícia de teste, sem acontecimento real.\n\n' + first + '\n\n' + second;
  const created = await engine.commands.createFromSource({ title: 'Teste sintético do assistente',
    material: { text: material, origin: 'podcast', authorized: true }, brief: { size: 'standard', sections: 2 }, plan: ['article'] });
  assert.ok(created.ok);
  const pieceId = created.value.pieces[0].pieceId, initial = engine.records.record(created.value.productionId)!;
  const source = initial.sources[0];
  const version = source.versions.at(-1)!;
  const segments = version.content.segments;
  const ref = (text: string) => segmentRef(source.id, version.number, segments.find(segment => segment.text.includes(text))!.id);
  const body: ArticleBody = { type: 'article', title: 'Simulação sobre pescado', blocks: [
    { id: 'p1',type: 'paragraph', inlines: [{ text: first }], sourceRefs: [ref('A previsão depende')], ai: 'reviewed' },
    { id: 'p2',type: 'paragraph', inlines: [{ text: second }], sourceRefs: [ref('Ainda não temos')], ai: 'reviewed' },
  ] };
  assert.ok((await engine.commands.saveDraft(pieceId,body,0)).ok);
  const record = engine.records.record(created.value.productionId)!, piece = record.pieces.find(piece => piece.id === pieceId)!;
  assert.equal(r1ArticleIssue(body,record.sources), undefined);
  const input = { productionId: record.production.id, pieceId, body, baseRevision: piece.draft.revision,
    target: [{ blockId: 'p1', from: 0, to: first.length }] };
  return { engine,record,body,pieceId,input,first,second,source };
}
const change = (text: string,evidenceIds: string[] = ['0']) => ({ targetIndex: 0,kind: 'text',text,items: [],evidenceIds });

test('server-owned revision/body and selection bounds reject forged, stale and overlapping inputs before provider calls', async () => {
  const f = await fixture();
  try {
    assert.ok(validateArticleAssistInput(f.record,f.pieceId,'article.rewrite',f.input).ok);
    for (const input of [{ ...f.input,baseRevision: 0 }, { ...f.input,body: { ...f.body,title: 'Forged' } },
      { ...f.input,target: [{ blockId: 'missing',from: 0,to: 3 }] }, { ...f.input,target: [...f.input.target,...f.input.target] },
      { ...f.input,target: [{ blockId: 'p1',from: 10,to: 8 }] }])
      assert.equal(validateArticleAssistInput(f.record,f.pieceId,'article.rewrite',input).ok,false);
    assert.equal(validateArticleAssistInput(f.record,f.pieceId,'article.ask',{ ...f.input,target: undefined,prompt: 'Qual é a ideia central?' }).ok,true);
    assert.equal(validateArticleAssistInput(f.record,f.pieceId,'article.ask',{ ...f.input,prompt: ' ' }).ok,false);
    assert.equal(validateArticleAssistInput(f.record,f.pieceId,'article.to-list',{ ...f.input,target: [{ blockId: 'p1',from: 0,to: 10 }] }).ok,false);
  } finally { f.engine.store.dispose(); }
});

test('shortening becomes a real ready suggestion, preserves the source and changes the draft only on acceptance', async () => {
  const f = await fixture();
  try {
    const context = articleAssistContext(f.record,{ kind: 'article.shorten',input: f.input });
    const before = contentHash(f.record), proposal = f.first.replace('Na simulação a equipe avalia novos dados','Na simulação a equipe examina dados');
    const suggestions = articleAssistSuggestions({ reply: 'Removi palavras dispensáveis.',changes: [change(proposal)] },context,f.record,'run');
    assert.equal(contentHash(f.record),before);
    const applied = applySuggestion(f.body,suggestions[0]); assert.ok(applied.ok);
    assert.ok(articleStats(applied.value).characters < articleStats(f.body).characters);
    assert.equal(r1ArticleIssue(applied.value,f.record.sources),undefined);
    assert.deepEqual(applied.value.blocks[0].sourceRefs,f.body.blocks[0].sourceRefs);
    assert.equal(applied.value.blocks[0].ai,'unreviewed');
  } finally { f.engine.store.dispose(); }
});

test('invented quotes, removed quotes, unknown evidence, out-of-scope targets and too-short proposals are rejected', async () => {
  const f = await fixture();
  try {
    const context = articleAssistContext(f.record,{ kind: 'article.rewrite',input: { ...f.input,tone: 'direct' } });
    for (const value of [change(f.first.replace('A previsão depende de testes reais.','O projeto já foi aprovado.')),
      change(f.first.replace('“A previsão depende de testes reais.”','')), change(f.first+' Novidade.',['forged']),
      { ...change(f.first+' Novidade.'),targetIndex: 9 },change('Texto pequeno sem evidências.')])
      assert.throws(() => articleAssistSuggestions({ reply: '',changes: [value] },context,f.record,'run'));
    assert.throws(() => articleAssistSuggestions({ reply: '',changes: [] },context,f.record,'run'),/INVALID_PROVIDER_OUTPUT/);
    assert.deepEqual(articleAssistSuggestions({ reply: 'Não há evidência para confirmar isso.',changes: [] },context,f.record,'run'),[]);
  } finally { f.engine.store.dispose(); }
});

test('combined proposals cannot shrink a valid R1 article under its minimum even if individual edits fit', async () => {
  const f = await fixture();
  try {
    const context = articleAssistContext(f.record,{ kind: 'article.shorten',input: { ...f.input,target: undefined } });
    const changes = [change(f.first.replace(/(Na simulação[^.]+\. ){4}/,' ')),
      { ...change(f.second.replace(/(Na simulação[^.]+\. ){4}/,' '),['1']),targetIndex: 1 }];
    assert.throws(() => articleAssistSuggestions({ reply: '',changes },context,f.record,'run'),/ASSIST_SIZE_CONFLICT/);
  } finally { f.engine.store.dispose(); }
});

test('subheadings insert a new heading and retain the entire original paragraph and references', async () => {
  const f = await fixture();
  try {
    const context = articleAssistContext(f.record,{ kind: 'article.subheadings',input: { ...f.input,target: undefined } });
    const suggestions = articleAssistSuggestions({ reply: '',changes: [{ ...change('Condições do teste',[]),kind: 'heading' }] },context,f.record,'run');
    const applied = applySuggestion(f.body,suggestions[0]); assert.ok(applied.ok);
    assert.equal(applied.value.blocks[0].type,'heading');
    assert.deepEqual(applied.value.blocks[1],{ ...f.body.blocks[0],ai: 'unreviewed' });
    assert.equal(r1ArticleIssue(applied.value,f.record.sources),undefined);
  } finally { f.engine.store.dispose(); }
});

test('three alternate titles are independent options; a model cannot replace another document target', async () => {
  const f = await fixture();
  try {
    const context = articleAssistContext(f.record,{ kind: 'article.titles',input: f.input });
    const changes = ['Simulação avalia pescado','Testes fictícios mantêm condições','Pescado: uma simulação editorial'].map(text => ({ ...change(text,[]),kind: 'title' }));
    const proposals = articleAssistSuggestions({ reply: '',changes },context,f.record,'run');
    assert.equal(proposals.length,3);
    assert.ok(proposals.every(proposal => proposal.target.length === 0));
    assert.throws(() => articleAssistSuggestions({ reply: '',changes: [changes[0]] },context,f.record,'run'));
    assert.throws(() => articleAssistSuggestions({ reply: '',changes: [changes[0],changes[0],changes[0]] },context,f.record,'run'));
    assert.throws(() => articleAssistSuggestions({ reply: '',changes: [{ ...changes[0],text: '“O projeto já foi aprovado”, afirma a equipe' },changes[1],changes[2]] },context,f.record,'run'),/UNSUPPORTED_ARTICLE_QUOTE/);
  } finally { f.engine.store.dispose(); }
});

test('list conversion keeps the source and arbitrary editorial notes remain scoped to the selected range', async () => {
  const f = await fixture();
  try {
    const context = articleAssistContext(f.record,{ kind: 'article.to-list',input: f.input });
    const items = [f.first.slice(0,700),f.first.slice(700)];
    const suggestion = articleAssistSuggestions({ reply: '',changes: [{ ...change(''),kind: 'list',items }] },context,f.record,'run')[0];
    const applied = applySuggestion(f.body,suggestion); assert.ok(applied.ok);
    assert.equal(applied.value.blocks[0].type,'list');
    assert.deepEqual(applied.value.blocks[0].sourceRefs,f.body.blocks[0].sourceRefs);
    const noteContext = articleAssistContext(f.record,{ kind: 'article.apply-note',input: { ...f.input,note: 'Use voz ativa.',anchors: f.input.target } });
    assert.equal(noteContext.prompt,'Use voz ativa.');
    const note = articleAssistSuggestions({ reply: '',changes: [change(f.first.replace('avalia novos dados','examina os dados'))] },noteContext,f.record,'run')[0];
    assert.deepEqual(note.target,f.input.target);
    assert.equal(blockText(f.body.blocks[1]),f.second);
  } finally { f.engine.store.dispose(); }
});

test('new evidence added by expansion is retained when accepted, never guessed by the client', async () => {
  const f = await fixture();
  try {
    const context = articleAssistContext(f.record,{ kind: 'article.expand-from-source',input: { ...f.input,target: [{ blockId: 'p2',from: 0,to: f.second.length }] } });
    const proposal = change(f.second+' A simulação não confirma um calendário.',[context.evidence[0].id]);
    const suggestion = articleAssistSuggestions({ reply: '',changes: [proposal] },context,f.record,'run')[0];
    assert.ok(suggestion.proposal.kind === 'replace-text');
    assert.deepEqual(suggestion.proposal.sourceRefs,[context.evidence[0].ref]);
  } finally { f.engine.store.dispose(); }
});

test('an immutable pipeline extension preserves every existing editorial prompt and model', () => {
  const definition = defaultPipelineDefinition('openai/gpt-6-astra');
  const legacy = structuredClone(definition); delete (legacy.steps as Partial<typeof legacy.steps>).assist;
  const before = contentHash(legacy), next = withArticleAssist(legacy);
  assert.equal(contentHash(legacy),before);
  assert.equal(next.steps.assist.model,'openai/gpt-6-astra');
  assert.equal(next.steps.assist.maxTokens,8192);
  for (const key of Object.keys(legacy.steps) as (keyof typeof legacy.steps)[]) assert.deepEqual(next.steps[key],legacy.steps[key]);
});

test('real orchestration consumes the exact saved assistant prompt and provider deltas without mutating a draft', async () => {
  const f = await fixture(), directory = await mkdtemp(join(tmpdir(),'reporter-assist-test-'));
  const originalFetch = globalThis.fetch, originalStorage = process.env.REPORTER_STORAGE_DIR, originalKey = process.env.OPENAI_API_KEY;
  process.env.REPORTER_LOCAL_MODE = 'true'; process.env.REPORTER_STORAGE_DIR = directory; process.env.OPENAI_API_KEY = 'synthetic-test-key';
  const pipeline = pipelineRevision(defaultPipelineDefinition('openai/gpt-4.1'));
  pipeline.definition.steps.assist.prompt += '\nINSTRUÇÃO EDITORIAL EDITÁVEL DE TESTE.';
  const kind: GenerationKind = 'article.rewrite', runId = 'assist-fixture', before = contentHash(f.record.pieces);
  const output = { reply: 'A proposta preserva o sentido e as citações.',changes: [change(f.first.replace('avalia novos dados','examina os dados'))] };
  const text = JSON.stringify(output), requests: Record<string,unknown>[] = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(String(options?.body)));
    const frames = [text.slice(0,90),text.slice(90)].map(delta => 'data: '+JSON.stringify({ type: 'response.output_text.delta',delta,item_id: 'item',output_index: 0,content_index: 0 })+'\n\n');
    frames.push('data: '+JSON.stringify({ type: 'response.completed',response: { status: 'completed',output: [{ type: 'message',content: [{ type: 'output_text',text }] }],usage: { input_tokens: 5,output_tokens: 8 } } })+'\n\n');
    return new Response(frames.join(''),{ headers: { 'content-type': 'text/event-stream' } });
  };
  const job: EditorialJob = { kind,input: { ...f.input,tone: 'direct' },pipeline,events: [],attempts: 1,availableAt: 0,
    meta: { runId,productionId: f.record.production.id,pieceId: f.pieceId,label: 'Mais direto',request: { kind,input: { ...f.input,tone: 'direct' } } } };
  appendEditorialEvent(f.engine,job,{ type: 'run.started',kind: RUN_KIND_OF[kind],productionId: f.record.production.id,pieceId: f.pieceId,
    prompt: { key: 'test',version: '1',hash: pipeline.hash },model: { alias: 'openai/gpt-4.1',label: 'OpenAI',engine: 'provider' },
    inputs: [],steps: [{ id: 'source',label: 'Fonte' },{ id: 'assist',label: 'Proposta' },{ id: 'validate',label: 'Validação' }],createdBy: 'test' });
  let sawPreview = false;
  try {
    await runArticleAssist(job,f.record,new AbortController().signal,async events => {
      for (const event of events) {
        if (event.type === 'assist.preview' && event.reply) sawPreview = true;
        appendEditorialEvent(f.engine,job,event);
      }
    },directory);
    const record = f.engine.records.record(f.record.production.id)!;
    assert.equal(contentHash(record.pieces),before);
    assert.equal(record.suggestions.length,1);
    assert.equal(record.suggestions[0].state,'ready');
    assert.equal(sawPreview,true, 'provider deltas reached the active preview');
    assert.ok(job.events.some(event => event.type === 'assist.preview'));
    assert.ok(job.events.every(event => event.type !== 'assist.preview' || !event.reply && !event.proposals.length), 'terminal runs discard ephemeral preview payloads');
    assert.equal(f.engine.store.state.runFolds[runId].assistPreview,undefined);
    assert.equal(requests[0].stream,true);
    const messages = requests[0].input as { content: string }[];
    assert.equal(messages[0].content,pipeline.definition.systemPrompt);
    assert.match(messages[1].content,/INSTRUÇÃO EDITORIAL EDITÁVEL DE TESTE/);
    assert.ok(messages[1].content.includes('article.rewrite'));
    assert.equal(record.versions.length,0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete process.env.REPORTER_STORAGE_DIR; else process.env.REPORTER_STORAGE_DIR = originalStorage;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    f.engine.store.dispose(); await rm(directory,{ recursive: true,force: true });
  }
});
