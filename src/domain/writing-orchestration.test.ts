import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultEditorialPolicy } from './editorial-policy.ts';
import { composeWritingPrompt, defaultWritingOrchestration, defaultWritingReviewCriteria, effectiveWritingMinimumQuotes, effectiveWritingReviewCriteria, writingOutputSchema, WRITING_COMPILER_VERSION, WRITING_EDITORIAL_CHECK_KEYS, WRITING_INVARIANTS, WRITING_SCHEMAS, WRITING_STAGES } from './writing-orchestration.ts';
import { defaultWritingResearch, effectiveWritingResearch } from './writing-research.ts';

test('editorial orchestration starts opt-in and each stage has an independent editable configuration', () => {
  const configuration = defaultWritingOrchestration();
  assert.equal(configuration.enabled, false);
  assert.equal(configuration.maxCorrections, 1);
  assert.equal(configuration.maxSourceCharacters, 100000);
  for (const stage of WRITING_STAGES) {
    assert.equal(configuration.stages[stage].model, 'openai/gpt-4.1');
    assert.ok(configuration.stages[stage].prompt);
    assert.ok(!configuration.stages[stage].prompt.includes('{{'));
  }
  configuration.stages.plan.model = 'anthropic/claude-sonnet-4-6';
  assert.equal(configuration.stages.write.model, 'openai/gpt-4.1');
  assert.equal(defaultWritingOrchestration().stages.plan.model, 'openai/gpt-4.1');
});

test('editable review criteria have visible defaults without rewriting historical instructions', () => {
  const configuration = defaultWritingOrchestration();
  delete configuration.reviewCriteria;
  configuration.stages.review.prompt = 'Keep the newsroom custom review task.';
  const before = structuredClone(configuration);
  assert.deepEqual(effectiveWritingReviewCriteria(configuration), defaultWritingReviewCriteria());
  const original = composeWritingPrompt(configuration, undefined, 'review', { source: [], brief: {} });
  assert.deepEqual(configuration, before);
  configuration.reviewCriteria = { ...defaultWritingReviewCriteria(), editorial: 'A custom readable, actionable editorial criterion.' };
  const edited = composeWritingPrompt(configuration, undefined, 'review', { source: [], brief: {} });
  assert.notEqual(edited.system, original.system);
  assert.ok(edited.system.includes(configuration.reviewCriteria.editorial));
  assert.ok(edited.system.endsWith(before.stages.review.prompt));
  assert.equal(WRITING_COMPILER_VERSION, 'editorial-orchestration-v5');
});

test('research is opt-in and only enabled planning asks for grounded research queries', () => {
  const configuration = defaultWritingOrchestration(), before = structuredClone(configuration);
  assert.equal(effectiveWritingResearch(configuration).enabled, false);
  assert.deepEqual(writingOutputSchema(configuration, 'plan'), WRITING_SCHEMAS.plan);
  assert.deepEqual(configuration, before);
  configuration.research = { ...defaultWritingResearch(), enabled: true, maxQueries: 1, instructions: 'Pesquisar documentação técnica primária.' };
  const schema = writingOutputSchema(configuration, 'plan') as { required: string[]; properties: Record<string, object> };
  assert.ok(schema.required.includes('research'));
  assert.deepEqual(writingOutputSchema(configuration, 'write'), WRITING_SCHEMAS.write);
  const input = { source: [{ id: 'source', text: 'A empresa apresentou um produto.' }], brief: {} };
  const plan = composeWritingPrompt(configuration, undefined, 'plan', input);
  assert.ok(plan.system.includes(configuration.research.instructions));
  assert.ok(plan.system.includes('até 1 consultas'));
  assert.deepEqual(JSON.parse(plan.user.slice(plan.user.indexOf('\n') + 1)).source, input.source);
  const write = composeWritingPrompt(configuration, undefined, 'write', input);
  assert.ok(write.system.includes('Citações diretas continuam restritas ao conteúdo original'));
  assert.ok(!write.system.includes(configuration.research.instructions), 'query planning is not repeated in downstream tasks');
});

test('quotation requirements are explicit and legacy configurations inherit the actual format without mutation', () => {
  const configuration = defaultWritingOrchestration();
  assert.equal(effectiveWritingMinimumQuotes(configuration), 0);
  const noQuota = composeWritingPrompt(configuration, undefined, 'write', { source: [], brief: {} });
  assert.ok(noQuota.system.includes('0: sem quota'));
  delete configuration.minimumQuotes;
  const before = structuredClone(configuration);
  assert.equal(effectiveWritingMinimumQuotes(configuration), undefined);
  assert.equal(effectiveWritingMinimumQuotes(configuration, 0), 0);
  assert.equal(effectiveWritingMinimumQuotes(configuration, 2), 2);
  const legacy = composeWritingPrompt(configuration, undefined, 'write', { source: [], brief: {} });
  assert.ok(legacy.system.includes('Padrão do formato'));
  assert.ok(!legacy.system.includes('2: use ao menos 2 citações'));
  assert.ok(composeWritingPrompt(configuration, undefined, 'write', { source: [], brief: { limits: { minQuotes: 0 } } }).system.includes('0: sem quota'));
  assert.ok(composeWritingPrompt(configuration, undefined, 'write', { source: [], brief: { limits: { minQuotes: 2 } } }).system.includes('2: use ao menos 2 citações'));
  assert.notEqual(legacy.system, noQuota.system);
  assert.deepEqual(configuration, before);
  configuration.minimumQuotes = null;
  assert.equal(effectiveWritingMinimumQuotes(configuration), undefined);
  assert.equal(effectiveWritingMinimumQuotes(configuration, 0), 0);
  assert.ok(composeWritingPrompt(configuration, undefined, 'review', { source: [], brief: {} }).system.includes('Padrão do formato'));
  configuration.minimumQuotes = 1;
  assert.ok(composeWritingPrompt(configuration, undefined, 'review', { source: [], brief: {} }).system.includes('1: use ao menos 1 citação literal'));
});

test('the deterministic compiler preserves original input and treats template-looking content as data', () => {
  const configuration = defaultWritingOrchestration(), policy = defaultEditorialPolicy();
  policy.map.audience = 'Professionals in the seafood industry';
  policy.map.version = 3;
  policy.guide.version = 7;
  policy.guide.voice = 'Preserve {{source}} as a literal label.';
  configuration.stages.write.prompt = 'An editable instruction without mandatory variables.';
  const input = { source: [{ id: 's1', text: 'Original {{brief}} content.\nA later relevant fact.', speaker: 'A reporter' }], brief: { angle: 'Research, not instructions' } };
  const result = composeWritingPrompt(configuration, policy, 'write', input);
  assert.deepEqual(result, composeWritingPrompt(structuredClone(configuration), structuredClone(policy), 'write', structuredClone(input)));
  assert.ok(result.system.startsWith(WRITING_INVARIANTS));
  assert.ok(result.system.includes('"mapVersion":3'));
  assert.ok(result.system.includes('"guideVersion":7'));
  assert.ok(result.system.includes(policy.guide.voice));
  assert.ok(result.system.includes('instruções de etapa não substituem essas políticas'));
  assert.ok(result.system.endsWith(configuration.stages.write.prompt));
  assert.deepEqual(JSON.parse(result.user.slice(result.user.indexOf('\n') + 1)), input);
  assert.ok(!result.system.includes(input.source[0].text));
});

test('all visible provider contracts require their declared fields and reject extra fields', () => {
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const schema = value as Record<string, unknown>;
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, Object.keys(schema.properties as object));
    }
    for (const child of Object.values(schema)) if (child && typeof child === 'object') visit(child);
  }
  for (const stage of WRITING_STAGES) visit(WRITING_SCHEMAS[stage]);
  assert.deepEqual(WRITING_SCHEMAS.write, WRITING_SCHEMAS.correct);
  const review = WRITING_SCHEMAS.review as { properties: { audit: { properties: { editorialChecks: { minItems: number; maxItems: number; items: { properties: { criterion: { enum: string[] } } } } } } } };
  assert.equal(review.properties.audit.properties.editorialChecks.minItems, 5);
  assert.equal(review.properties.audit.properties.editorialChecks.maxItems, 5);
  assert.deepEqual(review.properties.audit.properties.editorialChecks.items.properties.criterion.enum, [...WRITING_EDITORIAL_CHECK_KEYS]);
});
