import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readOpenAIStream } from '../src/server/openai-stream.ts';
import { generateStructured } from '../src/server/text-generation.ts';
import { partialJsonStrings, articlePreview } from '../src/server/article-preview.ts';
import { parsePipelineDefinition } from '../src/server/pipeline.ts';
import { defaultPipelineDefinition, pipelineModelProvider } from '../src/domain/pipeline.ts';

const frame = (event: unknown) => 'data: '+JSON.stringify(event)+'\r\n\r\n';
const envelope = (text: string) => ({ status: 'completed',id: 'synthetic-response',output: [{ type: 'message',content: [{ type: 'output_text',text }] }],usage: { input_tokens: 11,output_tokens: 22 } });
function response(events: unknown[], chunk = 3) {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\n'+events.map(frame).join(''));
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) return controller.close();
    controller.enqueue(bytes.slice(offset,offset+=chunk));
  } }),{ headers: { 'content-type': 'text/event-stream','x-request-id': 'synthetic-request' } });
}
test('OpenAI SSE delivers actual deltas before completion across UTF-8/CRLF boundaries, not reasoning', async () => {
  const text = '{"title":"Ação"}', received: string[] = [];
  const result = await readOpenAIStream(response([
    { type: 'response.created',response: { status: 'in_progress' } },
    { type: 'response.reasoning_summary_text.delta',delta: 'Never show this' },
    { type: 'response.output_text.delta',delta: text.slice(0,13) },
    { type: 'response.output_text.delta',delta: text.slice(13) },
    { type: 'response.completed',response: envelope(text) },
  ]),new AbortController().signal,async current => { received.push(current); });
  assert.deepEqual(received,[text.slice(0,13),text]); assert.deepEqual(result,envelope(text));
});
test('SSE truncation, refusal, provider failure and conflicting final output cannot become a valid article', async () => {
  for (const [events,code] of [
    [[{ type: 'response.output_text.delta',delta: '{' }],'GENERATION_INCOMPLETE'],
    [[{ type: 'response.refusal.delta',delta: 'private reason' }],'GENERATION_REFUSED'],
    [[{ type: 'error',message: 'private detail' }],'OPENAI_STREAM_FAILED'],
    [[{ type: 'response.incomplete' }],'GENERATION_INCOMPLETE'],
    [[{ type: 'response.output_text.delta',delta: '{}' },{ type: 'response.completed',response: envelope('{"different":true}') }],'OPENAI_INVALID_STREAM'],
    [[{ type: 'response.output_text.delta',delta: '{}',output_index: 0 },{ type: 'response.output_text.delta',delta: '{}',output_index: 1 }],'OPENAI_INVALID_STREAM'],
  ] as const) await assert.rejects(readOpenAIStream(response([...events]),new AbortController().signal,async () => {}),new RegExp(code));
  const controller = new AbortController();
  const pending = readOpenAIStream(new Response(new ReadableStream(),{ headers: { 'content-type': 'text/event-stream' } }),controller.signal,async () => {});
  controller.abort(); await assert.rejects(pending,/JOB_INTERRUPTED/);
});
test('partial JSON only exposes literal prose paths and buffers unfinished keys/escapes', () => {
  assert.deepEqual([...partialJsonStrings('{"intro":[{"text":"Frase com \\"aspas\\" e ação')],[['intro.0.text','Frase com "aspas" e ação']]);
  assert.equal(partialJsonStrings('{"text":"Uma \\u00').get('text'),'Uma ');
  assert.equal(partialJsonStrings('{"text":"Emoji \\ud83d').get('text'),'Emoji ');
  assert.equal(partialJsonStrings('{"text":"Emoji \\ud83d\\ude00').get('text'),'Emoji 😀');
  assert.equal(partialJsonStrings('{"text').size,0);
  const outline = { title: 'Título revisado',sections: [{ blockId: 'h1',title: 'Seção revisada',quotes: [] }] };
  const stages = new Map([['article','{"title":"Não usar","intro":[{"text":"Começando a escrever","evidenceIds":["not-shown"]}],"sections":[{"title":"Não usar","paragraphs":[{"text":"Outro trecho']]);
  const preview = articlePreview('run',outline,true,stages);
  assert.equal(preview.title,outline.title); assert.equal(preview.blocks.length,3);
  assert.equal(preview.blocks[1].type,'heading'); assert.ok(!JSON.stringify(preview).includes('not-shown'));
  assert.ok(preview.blocks.every(block => !block.sourceRefs),'partial output has no validated evidence claim');
  assert.deepEqual(articlePreview('run',outline,true,stages),preview,'preview ids remain stable');
  assert.equal(articlePreview('run',outline,false,new Map([['intro','{"paragraphs":[{"text":"Abertura"}]}'],['section-0','{"paragraphs":[{"text":"Desenvolvimento"}]}']])).blocks.length,2);
});
test('GPT-6 Astra uses Responses low reasoning without unsupported temperature, preserving exact prompts and storage policy', async () => {
  const original = globalThis.fetch, key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-key';
  const text = '{"title":"Synthetic"}', snapshots: string[] = [];
  globalThis.fetch = async (_url,init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model,'gpt-6-astra'); assert.equal(body.stream,true); assert.equal(body.store,false);
    assert.equal('temperature' in body,false); assert.deepEqual(body.reasoning,{ effort: 'low' });
    assert.equal(body.max_output_tokens,8192); assert.deepEqual(body.input,[{ role:'system',content:'Exact system' },{ role:'user',content:'Exact prompt' }]);
    return response([{ type:'response.output_text.delta',delta:text },{ type:'response.completed',response:envelope(text) }]);
  };
  try {
    const result = await generateStructured('','',{type:'object'},new AbortController().signal,{ model:'openai/gpt-6-astra',temperature:0.3,maxTokens:8192,systemPrompt:'Exact system',userPrompt:'Exact prompt',onText:async text=>{ snapshots.push(text); } });
    assert.deepEqual(result.value,{title:'Synthetic'}); assert.equal(result.provider,'openai'); assert.equal(result.output_units,22); assert.deepEqual(snapshots,[text]);
    assert.equal(pipelineModelProvider(result.model),'openai');
    const definition = defaultPipelineDefinition('openai/gpt-6-astra'); definition.steps.article.maxTokens = 16384;
    assert.ok(parsePipelineDefinition(definition).definition);
    definition.steps.article.model = 'openai/gpt-4.1'; assert.ok(parsePipelineDefinition(definition).error);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});
