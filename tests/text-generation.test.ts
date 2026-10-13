import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anthropicSchema, generateStructured } from '../src/server/text-generation.ts';
import { providerConfigured, providerKey } from '../src/server/config.ts';
import { FlowError } from '../src/server/errors.ts';
import { PIPELINE_SCHEMAS, defaultPipelineDefinition, pipelineModelProvider, pipelineModelLabel } from '../src/domain/pipeline.ts';
import { parsePipelineDefinition } from '../src/server/pipeline.ts';

const schema = { type: 'object', properties: { title: { type: 'string', maxLength: 120 } }, required: ['title'], additionalProperties: false };
const options = { model: 'openai/gpt-4.1', temperature: 0.2, maxTokens: 1024, systemPrompt: 'Saved system exactly.', userPrompt: 'Saved user exactly.' };

test('credentials accept existing aliases without confusing GPT OSS on Groq with OpenAI', () => {
  const before = { ...process.env };
  try {
    delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    process.env.OPEN_AI_API_KEY = 'synthetic-openai-key'; process.env.CLAUDE_API_KEY = 'synthetic-claude-key';
    assert.equal(providerKey('openai'), 'synthetic-openai-key'); assert.equal(providerKey('anthropic'), 'synthetic-claude-key');
    process.env.OPENAI_API_KEY = 'canonical-openai'; assert.equal(providerKey('openai'), 'canonical-openai');
    delete process.env.OPENAI_API_KEY; delete process.env.OPEN_AI_API_KEY;
    assert.equal(providerConfigured('openai'), false); assert.throws(() => providerKey('openai'), /OPENAI_KEY_MISSING/);
    assert.equal(pipelineModelProvider('openai/gpt-oss-120b'), 'groq'); assert.equal(pipelineModelProvider(options.model), 'openai');
    assert.equal(pipelineModelLabel('anthropic/claude-sonnet-4-6'), 'Claude · claude-sonnet-4-6');
  } finally {
    for (const name of ['OPENAI_API_KEY', 'OPEN_AI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'])
      if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
  }
});

test('OpenAI Responses uses only the saved messages, disables storage, and parses usage and provenance', async () => {
  const original = globalThis.fetch, key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-openai-key';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'gpt-4.1'); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 1024);
    assert.deepEqual(body.input, [{ role: 'system', content: options.systemPrompt }, { role: 'user', content: options.userPrompt }]);
    assert.deepEqual(body.text.format.schema, schema); assert.equal(body.temperature, 0.2);
    return Response.json({ id: 'resp-fixture', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"title":"Fixture"}' }] }], usage: { input_tokens: 11, output_tokens: 7 } });
  };
  try {
    const result = await generateStructured('', '', schema, new AbortController().signal, options);
    assert.deepEqual(result.value, { title: 'Fixture' }); assert.equal(result.provider, 'openai'); assert.equal(result.provider_request_id, 'resp-fixture');
    assert.equal(result.input_units, 11); assert.equal(result.output_units, 7);
    assert.ok(!JSON.stringify(result).includes('synthetic-openai-key'));
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});

test('Claude uses Messages, exact saved prompts and a compatible schema while retaining original domain limits', async () => {
  const original = globalThis.fetch, key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'synthetic-claude-key';
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'claude-sonnet-4-6'); assert.equal(body.system, options.systemPrompt);
    assert.deepEqual(body.messages, [{ role: 'user', content: options.userPrompt }]);
    assert.equal(body.max_tokens, 1024); assert.equal(body.temperature, 0.2);
    assert.equal(body.output_config.format.schema.properties.title.maxLength, undefined);
    assert.match(body.output_config.format.schema.properties.title.description, /maxLength=120/);
    return Response.json({ id: 'msg-fixture', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"Fixture"}' }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 } });
  };
  try {
    const result = await generateStructured('', '', schema, new AbortController().signal, { ...options, model: 'anthropic/claude-sonnet-4-6' });
    assert.equal(result.provider, 'anthropic'); assert.equal(result.input_units, 12); assert.equal(result.provider_request_id, 'msg-fixture');
    assert.equal(schema.properties.title.maxLength, 120);
    assert.equal((PIPELINE_SCHEMAS.facts.properties.facts as { maxItems: number }).maxItems, 50);
    const named = anthropicSchema({ type: 'object', properties: { maxLength: { type: 'string', maxLength: 10 } } }) as { properties: Record<string, unknown> };
    assert.ok(named.properties.maxLength);
    const prose = anthropicSchema({ type: 'string', pattern: '[.!?]$' }) as Record<string, unknown>;
    assert.equal(prose.pattern, undefined);
    assert.match(String(prose.description), /pattern=/);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; }
});

test('provider authentication, unavailable models, billing quota, rate limits, truncation and refusal are actionable failures', async () => {
  const original = globalThis.fetch, key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'synthetic-openai-key';
  const cases = [
    [401, { error: { message: 'secret provider detail' } }, 'OPENAI_AUTH_INVALID', false],
    [404, { error: { code: 'model_not_found' } }, 'OPENAI_MODEL_UNAVAILABLE', false],
    [429, { error: { code: 'insufficient_quota' } }, 'OPENAI_QUOTA_EXHAUSTED', false],
    [429, { error: { code: 'rate_limit_exceeded' } }, 'OPENAI_RATE_LIMIT', true],
    [200, { status: 'incomplete', output: [] }, 'GENERATION_INCOMPLETE', true],
    [200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }, 'GENERATION_REFUSED', false],
  ] as const;
  try {
    for (const [status, value, code, retryable] of cases) {
      globalThis.fetch = async () => Response.json(value, { status, headers: { 'retry-after': '45' } });
      await assert.rejects(generateStructured('', '', schema, new AbortController().signal, options), error => {
        assert.ok(error instanceof FlowError); assert.equal(error.code, code); assert.equal(error.retryable, retryable);
        assert.ok(!error.message.includes('secret')); return true;
      });
    }
    const definition = defaultPipelineDefinition('anthropic/claude-sonnet-4-6');
    definition.steps.section.temperature = 1.2;
    assert.match(parsePipelineDefinition(definition).error ?? '', /Claude/);
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key; }
});
