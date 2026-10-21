import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anthropicSchema, generateStructured } from '../src/server/text-generation.ts';
import { providerConfigured, providerKey } from '../src/server/config.ts';
import { FlowError } from '../src/server/errors.ts';
import { PIPELINE_MODELS, PIPELINE_REASONING_EFFORTS, PIPELINE_SCHEMAS, defaultPipelineDefinition, pipelineDefaultEffort, pipelineModelEffortOptions, pipelineModelProvider, pipelineModelLabel, pipelineModelReasons, pipelineTokenLimit } from '../src/domain/pipeline.ts';
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

test('current Claude models expose verified effort controls without changing saved Sonnet settings', () => {
  const original = defaultPipelineDefinition('anthropic/claude-sonnet-4-6');
  for (const model of ['anthropic/claude-opus-5-5', 'anthropic/claude-fable-5-1'] as const) {
    assert.ok(PIPELINE_MODELS.includes(model));
    assert.equal(pipelineModelProvider(model), 'anthropic');
    assert.equal(pipelineModelReasons(model), true);
    assert.deepEqual(pipelineModelEffortOptions(model), PIPELINE_REASONING_EFFORTS);
    assert.equal(pipelineTokenLimit(model), 32768);
  }
  assert.equal(pipelineDefaultEffort('anthropic/claude-opus-5-5'), 'medium');
  assert.equal(pipelineDefaultEffort('anthropic/claude-fable-5-1'), 'high');
  assert.equal(pipelineModelReasons('anthropic/claude-sonnet-4-6'), false);
  assert.deepEqual(pipelineModelEffortOptions('anthropic/claude-sonnet-4-6'), []);
  assert.equal(pipelineDefaultEffort('anthropic/claude-sonnet-4-6'), undefined);
  assert.equal(pipelineTokenLimit('anthropic/claude-sonnet-4-6'), 8192);
  assert.equal(original.steps.article.model, 'anthropic/claude-sonnet-4-6');
});

test('adaptive Claude sends configured effort, omits sampling controls and ignores thinking blocks in the article', async () => {
  const original = globalThis.fetch, key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'synthetic-claude-key';
  const cases = [
    { model: 'anthropic/claude-opus-5-5', selected: undefined, expected: 'medium' },
    { model: 'anthropic/claude-fable-5-1', selected: undefined, expected: 'high' },
    ...PIPELINE_REASONING_EFFORTS.map(effort => ({ model: 'anthropic/claude-opus-5-5', selected: effort, expected: effort })),
  ];
  try {
    for (const scenario of cases) {
      globalThis.fetch = async (url, init) => {
        assert.equal(url, 'https://api.anthropic.com/v1/messages');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, scenario.model.replace('anthropic/', ''));
        assert.equal(body.system, options.systemPrompt);
        assert.deepEqual(body.messages, [{ role: 'user', content: options.userPrompt }]);
        assert.equal(body.max_tokens, 16384);
        for (const parameter of ['temperature', 'top_p', 'top_k']) assert.equal(parameter in body, false);
        assert.deepEqual(body.thinking, { type: 'adaptive' });
        assert.equal(body.output_config.effort, scenario.expected);
        assert.equal(body.output_config.format.type, 'json_schema');
        assert.match(body.output_config.format.schema.properties.title.description, /maxLength=120/);
        return Response.json({ id: 'msg-adaptive', stop_reason: 'end_turn', content: [
          { type: 'thinking', thinking: 'synthetic-private-reasoning' },
          { type: 'text', text: '{"title":"Fixture"}' },
        ], usage: { input_tokens: 10, output_tokens: 1000, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 } });
      };
      const result = await generateStructured('', '', schema, new AbortController().signal, {
        ...options, model: scenario.model, maxTokens: 16384, effort: scenario.selected,
      });
      assert.deepEqual(result.value, { title: 'Fixture' });
      assert.equal(result.input_units, 15); assert.equal(result.output_units, 1000);
      assert.equal(result.provider_request_id, 'msg-adaptive');
      assert.doesNotMatch(JSON.stringify(result), /synthetic-private-reasoning|synthetic-claude-key/);
    }
  } finally { globalThis.fetch = original; if (key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = key; }
});

test('adaptive Claude refuses truncated output even when its text happens to be valid JSON', async () => {
  const original = globalThis.fetch, key = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'synthetic-claude-key';
  try {
    for (const stopReason of ['max_tokens', 'pause_turn']) {
      globalThis.fetch = async () => Response.json({ stop_reason: stopReason, content: [
        { type: 'thinking' }, { type: 'text', text: '{"title":"Incomplete"}' },
      ], usage: { input_tokens: 10, output_tokens: 16384 } });
      await assert.rejects(generateStructured('', '', schema, new AbortController().signal, {
        ...options, model: 'anthropic/claude-opus-5-5', effort: 'high', maxTokens: 16384,
      }), error => error instanceof FlowError && error.code === 'GENERATION_INCOMPLETE' && error.retryable);
    }
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
