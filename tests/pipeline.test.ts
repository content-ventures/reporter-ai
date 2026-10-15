import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPipelineDefinition, pipelineRevision, PIPELINE_SCHEMAS } from '../src/domain/pipeline.ts';
import type { PipelineVariables, PipelineCall } from '../src/domain/pipeline.ts';
import { parsePipelineDefinition } from '../src/server/pipeline.ts';
import { executePipelineStep, writeSequentialArticle, writeCompleteArticle, editorialPassageSize, articlePartSchema, articleWritingBudgets, completeArticleSchema } from '../src/server/pipeline-runner.ts';
import { restoreLiteralQuoteCase, validPipelineOutput, writingContractIssue } from '../src/server/pipeline-output.ts';
import { editorialReceipt } from '../src/server/editorial.ts';
import { cacheRead, cacheWrite } from '../src/server/storage.ts';

process.env.REPORTER_LOCAL_MODE = 'true';
process.env.GROQ_API_KEY = 'test-placeholder-not-a-real-key';
const variables: PipelineVariables = { source: '[e1] Fonte sintética {{brief}}',brief: 'Pauta de teste',sizing: '{}',outline: '{}',section: '',history: '',futureSections: '',layouts: '',approvedArticle: '' };

test('sequential oversize parts receive bounded measured revisions through the saved template',async()=>{
  const outline={title:'Article',sections:[{title:'Section',evidenceIds:['e1']}]};
  const oversized={title:'Section',paragraphs:[{text:'A complete but oversized sentence.',evidenceIds:['e1']}]};
  const revised={title:'Section',paragraphs:[{text:'A fact.',evidenceIds:['e1']}]};
  const requests:PipelineVariables[]=[];
  const result=await writeSequentialArticle(outline,variables,{introChars:9,sections:[{budgetChars:10}]},async(key,_schema,values)=>{
    if(key==='intro')return{paragraphs:[{text:'An intro.',evidenceIds:['e1']}]};
    requests.push(values);return requests.length===1?oversized:revised;
  });
  assert.equal(requests.length,2);const feedback=JSON.parse(requests[1].sizing).revisionFeedback;
  assert.deepEqual(feedback.previousDraft,oversized);assert.equal(feedback.maxTotalChars,10);
  assert.equal(feedback.actualCharacters,oversized.paragraphs[0].text.length);
  assert.equal(requests[1].source,requests[0].source);assert.equal(requests[1].history,requests[0].history);
  assert.deepEqual(result.sections[0],revised);
  let calls=0;
  await assert.rejects(writeSequentialArticle(outline,variables,{introChars:9,sections:[{budgetChars:10}]},async key=>{
    if(key==='intro')return{paragraphs:[{text:'An intro.',evidenceIds:['e1']}]};calls++;return oversized;
  }),/ARTICLE_PART_SIZE_EXCEEDED/);assert.equal(calls,3,'two invalid revisions must fail rather than loop or publish clipped prose');
});

test('part revision replaces every editorial target while retaining the hard ceiling',async()=>{
  const outline={title:'Article',sections:[{title:'Section',evidenceIds:['e1']}]};
  const calls=new Map<string,number>();
  await writeSequentialArticle(outline,variables,{introChars:100,sections:[{budgetChars:100}]},async(key,_schema,values)=>{
    const sizing=JSON.parse(values.sizing),attempt=(calls.get(key)??0)+1;calls.set(key,attempt);
    if(attempt===1)return {...(key==='section'?{title:'Section'}:{}),paragraphs:[{text:'Fato completo. '.repeat(10).trim(),evidenceIds:['e1']}]};
    assert.equal(sizing.maxChars,100);
    assert.equal(key==='intro'?sizing.introChars:sizing.currentSection.budgetChars,sizing.targetChars,
      'the saved prompt must not ask for the old, larger target during a measured revision');
    assert.equal(sizing.outputParagraphs.maxTotalChars,100);
    assert.equal(sizing.revisionFeedback.targetTotalChars,sizing.targetChars);
    assert.ok(sizing.targetChars<100);
    return {...(key==='section'?{title:'Section'}:{}),paragraphs:[{text:'x'.repeat(99)+'.',evidenceIds:['e1']}]};
  });
  assert.deepEqual([...calls.values()],[2,2]);
});

test('intro revision validates against the hard ceiling, not its reduced writing target',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'reporter-intro-revision-'));
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({paragraphs:[{text:'x'.repeat(74)+'.',evidenceIds:['e1']}]})}}]});
  try{
    const response=await executePipelineStep({pipeline:pipelineRevision(defaultPipelineDefinition()),key:'intro',
      schema:articlePartSchema('intro',100),variables:{...variables,sizing:JSON.stringify({introChars:50,targetChars:50,maxChars:100})},
      directory,signal:new AbortController().signal,trace:async()=>{},deferWritingRevision:true});
    assert.equal(response.needsRevision,false);
  }finally{globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});

test('a paraphrased quotation is revised within its part and an unsupported revision stays blocked',async()=>{
  const outline={title:'Article',sections:[{title:'Section',evidenceIds:['e1']}]};
  const evidence=new Map([['e1','The source confirms this exact statement.']]);
  const invalid={title:'Section',paragraphs:[{text:'The speaker said “A fabricated statement.”',evidenceIds:['e1']}]};
  const valid={title:'Section',paragraphs:[{text:'The speaker said “The source confirms this exact statement.”',evidenceIds:['e1']}]};
  const requests:PipelineVariables[]=[];
  const result=await writeSequentialArticle(outline,variables,{introChars:100,sections:[{budgetChars:200}]},async(key,_schema,input)=>{
    if(key==='intro')return{paragraphs:[{text:'A supported introduction.',evidenceIds:['e1']}]};
    requests.push(input);return requests.length===1?invalid:valid;
  },evidence);
  assert.deepEqual(result.sections[0],valid);assert.equal(requests.length,2);
  assert.equal(JSON.parse(requests[1].sizing).revisionFeedback.violation,'UNSUPPORTED_ARTICLE_QUOTE');
  await assert.rejects(writeSequentialArticle(outline,variables,{introChars:100,sections:[{budgetChars:200}]},async key=>key==='intro'
    ?{paragraphs:[{text:'A supported introduction.',evidenceIds:['e1']}]}:invalid,evidence),/UNSUPPORTED_ARTICLE_QUOTE/);
});

test('source capitalization is restored without accepting paraphrases or changing references',()=>{
  const evidence=new Map([['e1','Diversificar exige trabalho. Sem inventar fatos.']]);
  const part={title:'Section',paragraphs:[{text:'A fonte diz: “diversificar exige trabalho.”',evidenceIds:['e1']}]};
  const restored=restoreLiteralQuoteCase('section',part,evidence) as typeof part;
  assert.equal(restored.paragraphs[0].text,'A fonte diz: “Diversificar exige trabalho.”');
  assert.deepEqual(restored.paragraphs[0].evidenceIds,['e1']);assert.notEqual(restored,part);
  assert.equal(writingContractIssue('section',restored,{evidence}),undefined);
  const fabricated={...part,paragraphs:[{text:'“Diversificar nunca exige trabalho.”',evidenceIds:['e1']}]};
  assert.equal(writingContractIssue('section',restoreLiteralQuoteCase('section',fabricated,evidence),{evidence}),'UNSUPPORTED_ARTICLE_QUOTE');
});

test('near-target refinement is bounded to one call and uses measured data in the same editable template', async () => {
  const outline = { title: 'Fixture', sections: [{ title: 'Parte', evidenceIds: ['a'] }] };
  const value = (text: string) => ({ title: 'Fixture', intro: [{ text, evidenceIds: ['a'] }], sections: [{ title: 'Parte', paragraphs: [{ text: 'Um fato.', evidenceIds: ['a'] }] }] });
  const sizing = { targetChars: 3900, targetWords: 700, maxChars: 4000, headings: true, introChars: 975, sections: [{ budgetChars: 2925 }] };
  const requests: PipelineVariables[] = [];
  const first = value('fato '.repeat(550) + '.');
  const revised = value('fato '.repeat(750) + '.');
  const result = await writeCompleteArticle(outline, variables, sizing, async (key, _schema, input, index) => {
    assert.equal(key, 'article'); assert.equal(index, requests.length); requests.push(input);
    return requests.length === 1 ? first : revised;
  });
  assert.equal(requests.length, 2); assert.deepEqual(result, revised);
  const feedback = JSON.parse(requests[1].sizing).revisionFeedback;
  assert.deepEqual(feedback.previousDraft, first);
  assert.equal(feedback.actualCharacters, 2764);
  assert.equal(feedback.actualWords, 553);
  assert.equal(feedback.preferredMinimumChars, 3627);
  assert.equal(requests[1].source, variables.source);
  let calls = 0;
  await writeCompleteArticle(outline, variables, sizing, async () => { calls++; return revised; });
  assert.equal(calls, 1, 'a draft already near the target is not sent again');
});

test('single-call length AND literal-quote policy protects fresh output and poisoned checkpoints', async () => {
  const quoteA = 'A fonte confirma quatro fatos.';
  const quoteB = 'O episódio registra novos dados.';
  const value = { title: 'Título excluído da contagem', intro: [{ text: `A fonte diz: “${quoteA}”`, evidenceIds: ['a'] }],
    sections: [{ title: 'Evidências', paragraphs: [{ text: `No episódio: “${quoteB}”`, evidenceIds: ['b'] }] }] };
  const contract = { limits: { minChars: 50, maxChars: 500, minWords: 10, maxWords: 100 }, minQuotes: 2, evidence: new Map([['a', quoteA], ['b', quoteB]]) };
  assert.equal(writingContractIssue('article', value, contract), undefined);
  assert.equal(writingContractIssue('article', value, { ...contract, limits: { minWords: 500 } }), 'ARTICLE_WORDS_TOO_FEW');
  assert.equal(writingContractIssue('article', value, { ...contract, limits: { minChars: 2500 } }), 'ARTICLE_SIZE_TOO_SHORT');
  const bad = { ...value, intro: [{ text: 'A fonte diz: “Uma fala totalmente inventada.”', evidenceIds: ['a'] }] };
  assert.equal(writingContractIssue('article', bad, contract), 'UNSUPPORTED_ARTICLE_QUOTE');
  const directory = await mkdtemp(join(tmpdir(), 'reporter-quote-policy-'));
  const original = globalThis.fetch, traces: PipelineCall[] = []; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }); };
  const input = { pipeline: pipelineRevision(defaultPipelineDefinition()), key: 'article' as const, variables,
    schema: PIPELINE_SCHEMAS.article, directory, writingContract: contract, signal: new AbortController().signal,
    trace: async (call: PipelineCall) => { traces.push(call); } };
  try {
    await executePipelineStep(input);
    const key = 'pipeline-' + traces[0].hash;
    const cache = await cacheRead<Record<string, unknown>>(directory, key);
    await cacheWrite(directory, key, { ...cache, value: bad });
    await executePipelineStep(input);
    assert.equal(calls, 2, 'bad literal quotations are not served from old caches');
    assert.equal(traces.at(-1)?.cached, false);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(bad) } }] });
    await assert.rejects(executePipelineStep({ ...input, variables: { ...variables, brief: 'Fresh invalid request' } }), /UNSUPPORTED_ARTICLE_QUOTE/);
    assert.equal(await cacheRead(directory, 'pipeline-' + traces.at(-1)!.hash), null);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});

test('pauta character budgets become validated per-part contracts before cache or persistence', () => {
  const outline = { title: 'Fixture', sections: Array.from({ length: 8 }, () => ({ title: 'H'.repeat(120), evidenceIds: ['e1'] })) };
  const size = { maxChars: 4000, headings: true, introChars: 900, sections: outline.sections.map(() => ({ budgetChars: 900 })) };
  const budget = articleWritingBudgets(outline, size);
  assert.ok(budget.intro! + budget.sections.reduce<number>((sum, chars) => sum + chars!, 0) + 960 <= 4000);
  const schema = articlePartSchema('section', 900);
  assert.equal((schema.properties.paragraphs as { items: { properties: { text: { maxLength: number } } } }).items.properties.text.maxLength,5000,'transport grammar must not force a phrase cut at the editorial budget');
  assert.equal(validPipelineOutput('section', { title: 'Fixture', paragraphs: [{ text: 'X'.repeat(900)+'.', evidenceIds: ['e1'] }] }, schema,900), false);
  assert.equal(validPipelineOutput('section', { title: 'Fixture', paragraphs: Array(3).fill({ text: 'Valid', evidenceIds: ['e1'] }) }, schema), false);
  assert.equal(validPipelineOutput('section', { title: 'Fixture', paragraphs: Array(2).fill({ text: 'X'.repeat(449) + '.', evidenceIds: ['e1'] }) }, schema,900), true,'multiple complete paragraphs can develop the actual budget');
  assert.equal(validPipelineOutput('section', { title: 'Fixture', paragraphs: [{ text: 'X'.repeat(600)+'.',evidenceIds: ['e1'] },{ text: 'Y'.repeat(300)+'.',evidenceIds: ['e1'] }] },schema,900),false,'the sum, not a sentence cut, enforces the part budget');
  assert.equal(validPipelineOutput('section', { title: 'Fixture', paragraphs: [{ text: 'X'.repeat(650)+'.',evidenceIds: ['e1'] }] },schema,900),true,'a complete sentence may exceed the old 450-character split');
  const single = completeArticleSchema(outline, size);
  assert.equal((single.properties.sections as { maxItems: number }).maxItems, 8);
  assert.equal((PIPELINE_SCHEMAS.section.properties.paragraphs as { maxItems: number }).maxItems, 10, 'shared schema stays immutable');
});

test('unfinished prose is rejected before caching while complete statements and quoted endings pass', async () => {
  for (const text of ['Um fato que termina em', 'Uma condição ainda pendente,', 'Texto cortad','Uma frase cortada,…”'])
    assert.equal(validPipelineOutput('intro', { paragraphs: [{ text, evidenceIds: ['e1'] }] }, PIPELINE_SCHEMAS.intro), false);
  for (const text of ['Fato completo.', 'Uma pergunta?', '“Fato literal.”'])
    assert.equal(validPipelineOutput('intro', { paragraphs: [{ text, evidenceIds: ['e1'] }] }, PIPELINE_SCHEMAS.intro), true);
  const directory = await mkdtemp(join(tmpdir(), 'reporter-prose-contract-'));
  const original = globalThis.fetch, traces: PipelineCall[] = [];
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ paragraphs: [{ text: 'No orçamento, o último termo foi cortad', evidenceIds: ['e1'] }] }) } }] });
  try {
    await assert.rejects(executePipelineStep({ pipeline: pipelineRevision(defaultPipelineDefinition()), key: 'intro', variables,
      schema: PIPELINE_SCHEMAS.intro, directory, signal: new AbortController().signal, trace: async call => { traces.push(call); } }), /INVALID_PROVIDER_OUTPUT/);
    assert.equal(await cacheRead(directory, 'pipeline-' + traces[0].hash), null);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});

test('single-call article ceilings include headings and reject oversize responses before caching',async () => {
  const value = { title:'Título não conta no corpo',intro:[{text:'Uma abertura.',evidenceIds:['e1']}],sections:[{title:'Seção',paragraphs:[{text:'Um fato completo.',evidenceIds:['e1']}]}] };
  const chars = value.intro[0].text.length+value.sections[0].title.length+value.sections[0].paragraphs[0].text.length;
  assert.equal(validPipelineOutput('article',value,PIPELINE_SCHEMAS.article,chars),true);
  assert.equal(validPipelineOutput('article',value,PIPELINE_SCHEMAS.article,chars-1),false);
  assert.equal(validPipelineOutput('article',value,PIPELINE_SCHEMAS.article,chars-value.sections[0].title.length,false),true);
  const directory = await mkdtemp(join(tmpdir(),'reporter-single-budget-'));
  const original = globalThis.fetch,traces: PipelineCall[] = [];
  globalThis.fetch = async () => Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
  try {
    await assert.rejects(executePipelineStep({pipeline:pipelineRevision(defaultPipelineDefinition()),key:'article',variables:{...variables,sizing:JSON.stringify({maxChars:chars-1,headings:true})},schema:PIPELINE_SCHEMAS.article,directory,signal:new AbortController().signal,trace:async call=>{traces.push(call);}}),/ARTICLE_SIZE_EXCEEDED/);
    assert.equal(await cacheRead(directory,'pipeline-'+traces[0].hash),null,'an oversized checkpoint cannot poison every subsequent retry');
  } finally {globalThis.fetch=original;await rm(directory,{recursive:true,force:true});}
});

test('facts over the real 50-item contract fail before caching and legacy invalid caches are regenerated', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-facts-contract-'));
  const original = globalThis.fetch, traces: PipelineCall[] = []; let calls = 0;
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: {
    content: JSON.stringify({ facts: Array(++calls === 1 ? 59 : 2).fill('[e1] Fato sintético') }),
  } }] });
  const input = { pipeline: pipelineRevision(defaultPipelineDefinition()), key: 'facts' as const, variables,
    schema: PIPELINE_SCHEMAS.facts, directory, signal: new AbortController().signal, trace: async (call: PipelineCall) => { traces.push(call); } };
  try {
    await assert.rejects(executePipelineStep(input), /INVALID_PROVIDER_OUTPUT/);
    const key = 'pipeline-' + traces[0].hash;
    assert.equal(await cacheRead(directory, key), null);
    assert.equal(traces.at(-1)?.status, 'failed');
    await executePipelineStep(input);
    const saved = await cacheRead<{ value: unknown }>(directory, key);
    await cacheWrite(directory, key, { ...saved, value: { facts: Array(55).fill('[e1] Fato sintético') } });
    await executePipelineStep(input);
    assert.equal(calls, 3); assert.equal(traces.at(-1)?.cached, false);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});

test('settings idempotency stores a compact acknowledgment rather than repeated prompt history',() => {
  const result = { ok: true,value: { active: pipelineRevision(defaultPipelineDefinition()),history: Array(20).fill(defaultPipelineDefinition()) } };
  const receipt = editorialReceipt('pipeline.save','hash',result,4);
  assert.deepEqual(receipt,{ hash: 'hash',result: { ok: true,value: { savedRevision: 4 } },projection: 'pipeline' });
  assert.ok(JSON.stringify(receipt).length < 150);
  const refusal = { ok: false,refusal: { code: 'conflict' } };
  assert.deepEqual(editorialReceipt('pipeline.save','hash',refusal,4),{ hash: 'hash',result: refusal });
  assert.deepEqual(editorialReceipt('rename','hash',result,4),{ hash: 'hash',result });
});

test('configuration validation rejects invalid models, parameters, missing stages and hidden fields',() => {
  const definition = defaultPipelineDefinition();
  assert.ok(parsePipelineDefinition(definition).definition);
  for (const patch of [{ model: 'invalid' },{ temperature: 3 },{ maxTokens: 1 },{ prompt: '' },{ prompt: '{{source}} {{missing}}' }]) {
    assert.ok(parsePipelineDefinition({ ...definition,steps: { ...definition.steps,outline: { ...definition.steps.outline,...patch } } }).error);
  }
  const steps = Object.fromEntries(Object.entries(definition.steps).filter(([key]) => key !== 'intro'));
  assert.ok(parsePipelineDefinition({ ...definition,steps }).error);
  assert.ok(parsePipelineDefinition({ ...definition,secret: 'not permitted' }).error);
});
test('saved prompts and parameters are the exact provider request; checkpoints change with the prompt',async () => {
  const directory = await mkdtemp(join(tmpdir(),'reporter-pipeline-test-'));
  const definition = defaultPipelineDefinition();
  definition.systemPrompt = 'Mensagem totalmente substituída, sem prefixo oculto.';
  definition.steps.outline = { prompt: 'Personalizado: {{source}}\nPauta: {{brief}}',model: 'openai/gpt-oss-20b',temperature: 0.7,maxTokens: 1024 };
  const snapshot = pipelineRevision(definition,7),original = globalThis.fetch;
  const requests: { messages: { role: string; content: string }[]; model: string; temperature: number; max_completion_tokens: number }[] = [];
  const traces: PipelineCall[] = [];
  globalThis.fetch = async (_url,init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'fixture-request',choices: [{ finish_reason: 'stop',message: { content: JSON.stringify({ title: 'Teste',introIds: [],sections: [{ title: 'Seção',evidenceIds: ['e1'] }] }) } }],usage: { prompt_tokens: 10,completion_tokens: 5 } });
  };
  try {
    const input = { pipeline: snapshot,key: 'outline' as const,variables,schema: PIPELINE_SCHEMAS.outline,directory,signal: new AbortController().signal,trace: async (call: PipelineCall) => { traces.push(call); } };
    await executePipelineStep(input); await executePipelineStep(input);
    assert.equal(requests.length,1);
    assert.deepEqual(requests[0].messages,[{ role: 'system',content: snapshot.definition.systemPrompt },{ role: 'user',content: 'Personalizado: [e1] Fonte sintética {{brief}}\nPauta: Pauta de teste' }]);
    assert.equal(requests[0].model,'openai/gpt-oss-20b'); assert.equal(requests[0].temperature,0.7); assert.equal(requests[0].max_completion_tokens,1024);
    assert.equal(traces.at(-1)?.cached,true);
    definition.steps.outline.prompt += '\nAlterado depois de enfileirar';
    await executePipelineStep(input);
    assert.equal(requests.length,1,'queued snapshot did not change');
    await executePipelineStep({ ...input,pipeline: pipelineRevision(definition,8) });
    assert.equal(requests.length,2);
    assert.ok(requests[1].messages[1].content.endsWith('Alterado depois de enfileirar'));
    assert.notEqual(traces[1].hash,traces.at(-1)?.hash);
    assert.ok(!JSON.stringify(traces).includes('test-placeholder'));
    assert.ok(!JSON.stringify(traces).includes('Fonte sintética'));
  } finally { globalThis.fetch = original; await rm(directory,{ recursive: true,force: true }); }
});

test('manual retry reuses only validated identical requests from its server-selected parent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-retry-cache-'));
  const previousDirectory = await mkdtemp(join(tmpdir(), 'reporter-retry-parent-'));
  const original = globalThis.fetch; let calls = 0;
  const traces: PipelineCall[] = [];
  globalThis.fetch = async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ facts: ['[e1] Fato sintético'] }) } }] }); };
  const input = { pipeline: pipelineRevision(defaultPipelineDefinition()), key: 'facts' as const, variables,
    schema: PIPELINE_SCHEMAS.facts, directory: previousDirectory, signal: new AbortController().signal, trace: async (call: PipelineCall) => { traces.push(call); } };
  try {
    await executePipelineStep(input);
    await executePipelineStep({ ...input, directory, previousDirectory });
    assert.equal(calls, 1); assert.equal(traces.at(-1)?.cached, true);
    await executePipelineStep({ ...input, directory, previousDirectory, variables: { ...variables, source: '[e2] Material alterado' } });
    assert.equal(calls, 2);
    assert.equal(editorialPassageSize(0), 6000); assert.equal(editorialPassageSize(1), 3000);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); await rm(previousDirectory, { recursive: true, force: true }); }
});
test('sequential writing passes the actual intro, previous sections and future sections, in order',async () => {
  const outline = { title: 'Título revisado',sections: [{ title: 'Primeira',evidenceIds: ['e1'] },{ title: 'Segunda',evidenceIds: ['e2'] }] };
  const calls: { key: string; variables: PipelineVariables; index?: number }[] = [];
  const result = await writeSequentialArticle(outline,variables,{ sections: [{ budgetChars: 700 },{ budgetChars: 800 }] },async (key,_schema,values,index) => {
    calls.push({ key,variables: values,index });
    return key === 'intro' ? { paragraphs: [{ text: 'Introdução real',evidenceIds: ['e1'] }] }
      : { title: outline.sections[index!].title,paragraphs: [{ text: index === 0 ? 'Primeiro texto real' : 'Segundo texto real',evidenceIds: ['e1'] }] };
  });
  assert.deepEqual(calls.map(call => call.key),['intro','section','section']);
  assert.equal(calls[1].variables.history,'Introdução real');
  assert.equal(calls[2].variables.history,'Introdução real\n\nPrimeira\n\nPrimeiro texto real');
  assert.deepEqual(JSON.parse(calls[1].variables.futureSections),[outline.sections[1]]);
  assert.deepEqual(JSON.parse(calls[2].variables.futureSections),[]);
  assert.equal(JSON.parse(calls[2].variables.section).last,true);
  assert.equal(JSON.parse(calls[2].variables.sizing).currentSection.budgetChars,800);
  assert.equal(JSON.parse(calls[2].variables.sizing).outputParagraphs.targetCharsEach,392);
  assert.ok(JSON.parse(calls[2].variables.sizing).outputParagraphs.maxTotalChars>800,'unused introduction space remains available without increasing the section target');
  assert.equal(result.title,outline.title);
  assert.equal(result.sections[1].paragraphs[0].text,'Segundo texto real');
});
test('outline and writing share only exact facts requests; source, brief and saved prompts invalidate them',async () => {
  const root = await mkdtemp(join(tmpdir(),'reporter-shared-facts-'));
  const { mkdir } = await import('node:fs/promises');
  const directories = ['outline','article','changed-source','changed-brief','changed-prompt','facts','unrelated-prompt'].map(name => join(root,name));
  await Promise.all(directories.map(path => mkdir(path)));
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ choices: [{ finish_reason: 'stop',message: { content: JSON.stringify({ facts: ['[e1] Fato sintético'] }) } }] }); };
  const traces: PipelineCall[] = [];
  const input = { pipeline: pipelineRevision(defaultPipelineDefinition()),key: 'facts' as const,variables,schema: PIPELINE_SCHEMAS.facts,
    directory: directories[0],factsDirectory: directories[5],signal: new AbortController().signal,trace: async (call: PipelineCall) => { traces.push(call); } };
  try {
    await executePipelineStep(input);
    const cached = await executePipelineStep({ ...input,directory: directories[1] });
    assert.equal(cached.input_units,0); assert.equal(cached.output_units,0);
    assert.equal(calls,1); assert.equal(traces.at(-1)?.cached,true);
    const unrelated = defaultPipelineDefinition(); unrelated.steps.section.prompt += '\nRegra de escrita alterada.';
    await executePipelineStep({ ...input,directory: directories[6],pipeline: pipelineRevision(unrelated,2) });
    assert.equal(calls,1,'editing only a writing prompt does not invalidate the exact podcast facts request');
    assert.equal(traces.at(-1)?.cached,true);
    await executePipelineStep({ ...input,directory: directories[2],variables: { ...variables,source: '[e2] Fonte alterada' } });
    await executePipelineStep({ ...input,directory: directories[3],variables: { ...variables,brief: 'Pauta alterada' } });
    const definition = defaultPipelineDefinition(); definition.steps.facts.prompt += '\nPrompt alterado';
    await executePipelineStep({ ...input,directory: directories[4],pipeline: pipelineRevision(definition,2) });
    assert.equal(calls,4);
  } finally { globalThis.fetch = original; await rm(root,{ recursive: true,force: true }); }
});
test('malformed partial content and changed human titles cannot complete an article',async () => {
  const outline = { title: 'Revisado',sections: [{ title: 'Seção humana',evidenceIds: ['e1'] }] };
  await assert.rejects(writeSequentialArticle(outline,variables,{ sections: [] },async () => ({ paragraphs: [] })));
  await assert.rejects(writeSequentialArticle(outline,variables,{ sections: [] },async key => key === 'intro'
    ? { paragraphs: [{ text: 'Introdução',evidenceIds: ['e1'] }] }
    : { title: 'Título alterado',paragraphs: [{ text: 'Seção',evidenceIds: ['e1'] }] }),/OUTLINE_NOT_FOLLOWED/);
});

test('a failed provider call is traced as failed without raw provider text or a ready result',async () => {
  const directory = await mkdtemp(join(tmpdir(),'reporter-pipeline-failure-'));
  const original = globalThis.fetch,traces: PipelineCall[] = [];
  globalThis.fetch = async () => Response.json({ error: { code: 'invalid_request_error',message: 'private provider message' } },{ status: 400 });
  try {
    await assert.rejects(executePipelineStep({ pipeline: pipelineRevision(defaultPipelineDefinition()),key: 'outline',variables,
      schema: PIPELINE_SCHEMAS.outline,directory,signal: new AbortController().signal,trace: async call => { traces.push(call); } }),/GROQ_INPUT_REJECTED/);
    assert.deepEqual(traces.map(call => call.status),['running','failed']);
    assert.equal(traces[1].errorCode,'GROQ_INPUT_REJECTED');
    assert.ok(!JSON.stringify(traces).includes('private provider'));
  } finally { globalThis.fetch = original; await rm(directory,{ recursive: true,force: true }); }
});
