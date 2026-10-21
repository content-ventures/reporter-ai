import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PIPELINE_MODELS, pipelineModelLabel, pipelineModelProvider, pipelineModelReasons, pipelineTokenLimit } from '../src/domain/pipeline.ts';
import { providerConfigured, providerKey } from '../src/server/config.ts';
import { editorialRetryPolicy, FlowError, safeCode } from '../src/server/errors.ts';
import { geminiSchema } from '../src/server/gemini.ts';
import { generateStructured } from '../src/server/text-generation.ts';

const schema = { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', minLength: 1, maxLength: 120, pattern: '[.!?]$' } } };
const options = { model: 'google/gemini-3.8-flash', temperature: 0.2, maxTokens: 2048, systemPrompt: 'Saved editorial policy.', userPrompt: 'Saved content.' };
const envelope = (text = '{"title":"Fixture."}') => ({ id: 'interaction-fixture', status: 'completed', steps: [
  { type: 'thought', content: [{ type: 'text', text: 'Never render reasoning.' }] },
  { type: 'user_input', content: [{ type: 'text', text: 'Never parse source as output.' }] },
  { type: 'model_output', content: [{ type: 'text', text }] },
], usage: { total_input_tokens: 12, total_cached_tokens: 2, total_output_tokens: 7, total_thought_tokens: 4, total_tokens: 23 } });

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}

test('Gemini catalog routes to Google, keeps Groq separate and exposes bounded reasoning controls', () => {
  for (const model of ['google/gemini-3.8-flash', 'google/gemini-4-argon'] as const) {
    assert.ok(PIPELINE_MODELS.includes(model)); assert.equal(pipelineModelProvider(model), 'gemini');
    assert.equal(pipelineModelReasons(model), true); assert.equal(pipelineTokenLimit(model), 32768);
  }
  assert.equal(pipelineModelLabel(options.model), 'Gemini · gemini-3.8-flash');
  assert.equal(pipelineModelProvider('openai/gpt-oss-120b'), 'groq');
  const canonical = process.env.GEMINI_API_KEY, alias = process.env.GOOGLE_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY; process.env.GOOGLE_API_KEY = 'synthetic-google';
    assert.equal(providerKey('gemini'), 'synthetic-google');
    process.env.GEMINI_API_KEY = 'synthetic-gemini'; assert.equal(providerKey('gemini'), 'synthetic-gemini');
    delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;
    assert.equal(providerConfigured('gemini'), false);
    assert.throws(() => providerKey('gemini'), error => { assert.equal(safeCode(error), 'GEMINI_KEY_MISSING'); return true; });
  } finally { restoreEnv('GEMINI_API_KEY', canonical); restoreEnv('GOOGLE_API_KEY', alias); }
});

test('Gemini sends saved prompts to its direct API without storage and records complete token consumption', async () => {
  const original = globalThis.fetch, key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'synthetic-google';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    const headers = new Headers(init?.headers), body = JSON.parse(String(init?.body));
    assert.equal(headers.get('x-goog-api-key'), 'synthetic-google'); assert.equal(headers.has('authorization'), false);
    assert.equal(body.model, 'gemini-3.8-flash'); assert.equal(body.store, false);
    assert.equal(body.system_instruction, options.systemPrompt); assert.equal(body.input, options.userPrompt);
    assert.deepEqual(body.generation_config, { max_output_tokens: 2048, thinking_level: 'low', thinking_summaries: 'none' });
    assert.equal(body.response_format.mime_type, 'application/json'); assert.equal(body.response_format.type, 'text');
    assert.equal(body.response_format.schema.properties.title.maxLength, undefined);
    assert.match(body.response_format.schema.properties.title.description, /maxLength=120/);
    assert.equal(body.response_format.schema.additionalProperties, false);
    return Response.json(envelope(), { headers: { 'x-request-id': 'request-fixture' } });
  };
  try {
    const result = await generateStructured('', '', schema, new AbortController().signal, options);
    assert.deepEqual(result.value, { title: 'Fixture.' }); assert.equal(result.provider, 'gemini'); assert.equal(result.model, options.model);
    assert.equal(result.provider_request_id, 'request-fixture'); assert.equal(result.input_units, 12); assert.equal(result.output_units, 11);
    assert.equal(result.usage_unit, 'tokens'); assert.ok(!JSON.stringify(result).includes('synthetic-google'));
    assert.equal(schema.properties.title.maxLength, 120);
    globalThis.fetch = async () => Response.json({ ...envelope(), usage: undefined });
    const unmetered = await generateStructured('', '', schema, new AbortController().signal, options);
    assert.equal(unmetered.provider_request_id, 'interaction-fixture'); assert.equal(unmetered.input_units, null); assert.equal(unmetered.output_units, null);
  } finally { globalThis.fetch = original; restoreEnv('GEMINI_API_KEY', key); }
});

test('Gemini schema conversion retains supported array limits, unions and keyword-named properties', () => {
  const source = { type: 'object', properties: {
    maxLength: { type: 'string', maxLength: 10 },
    facts: { type: 'array', minItems: 1, maxItems: 5, items: { anyOf: [{ type: 'string', pattern: 'literal' }, { type: 'null' }] } },
  } };
  const converted = geminiSchema(source) as typeof source;
  assert.ok(converted.properties.maxLength); assert.equal(converted.properties.maxLength.maxLength, undefined);
  assert.equal(converted.properties.facts.minItems, 1); assert.equal(converted.properties.facts.maxItems, 5);
  assert.equal(converted.properties.facts.items.anyOf[1].type, 'null');
  assert.match(JSON.stringify(converted), /pattern=literal/); assert.equal(source.properties.maxLength.maxLength, 10);
});

test('Gemini failures never accept partial output or leak provider diagnostics', async () => {
  const original = globalThis.fetch, key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'synthetic-google';
  const cases = [
    [400, { error: { code: 400, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }], message: 'private diagnostic' } }, 'GEMINI_AUTH_INVALID', false],
    [400, { error: { code: 400, status: 'INVALID_ARGUMENT' } }, 'GEMINI_INPUT_REJECTED', false],
    [401, { error: { code: 401 } }, 'GEMINI_AUTH_INVALID', false],
    [404, { error: { code: 404 } }, 'GEMINI_MODEL_UNAVAILABLE', false],
    [429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }, 'GEMINI_RATE_LIMIT', true],
    [503, { error: { code: 503 } }, 'GEMINI_REQUEST_FAILED', true],
    [200, { ...envelope(), status: 'incomplete' }, 'GENERATION_INCOMPLETE', true],
    [200, { ...envelope(), status: 'requires_action' }, 'GENERATION_INCOMPLETE', true],
    [200, { status: 'failed', errors: [{ code: 'blocked', message: 'private diagnostic' }] }, 'GEMINI_REQUEST_FAILED', false],
    [200, { ...envelope(), status: 'cancelled' }, 'JOB_INTERRUPTED', true],
    [200, { status: 'completed', steps: 'bad-envelope' }, 'GEMINI_INVALID_RESPONSE', true],
    [200, envelope('broken-json'), 'GENERATION_INVALID_JSON', true],
  ] as const;
  try {
    for (const [status, value, code, retryable] of cases) {
      globalThis.fetch = async () => Response.json(value, { status, headers: { 'retry-after': '45' } });
      await assert.rejects(generateStructured('', '', schema, new AbortController().signal, options), error => {
        assert.ok(error instanceof FlowError); assert.equal(error.code, code); assert.equal(error.retryable, retryable);
        assert.ok(!error.message.includes('private')); if (status === 429) assert.equal(error.waitSeconds, 45); return true;
      });
    }
    const retry = editorialRetryPolicy(new FlowError('GEMINI_RATE_LIMIT', 502, true, 30), 2, new Date().toISOString());
    assert.equal(retry.attempts, 1); assert.equal(retry.retry, true);
  } finally { globalThis.fetch = original; restoreEnv('GEMINI_API_KEY', key); }
});

test('Gemini honors cancellation and bounds response size before decoding', async () => {
  const original = globalThis.fetch, key = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'synthetic-google';
  try {
    const controller = new AbortController();
    globalThis.fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('private transport diagnostic')), { once: true });
    });
    const pending = generateStructured('', '', schema, controller.signal, options); controller.abort();
    await assert.rejects(pending, error => error instanceof FlowError && error.code === 'JOB_INTERRUPTED');
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new Uint8Array(4 * 1024 ** 2 + 1)); }, cancel() { cancelled = true; },
    }));
    await assert.rejects(generateStructured('', '', schema, new AbortController().signal, options), error => error instanceof FlowError && error.code === 'PROVIDER_RESPONSE_TOO_LARGE');
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = original; restoreEnv('GEMINI_API_KEY', key); }
});
