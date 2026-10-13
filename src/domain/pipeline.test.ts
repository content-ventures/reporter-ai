import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultPipelineDefinition, pipelineRevision, pipelineRunSteps, renderPipelinePrompt, validatePipelineTemplates, PIPELINE_SCHEMAS } from './pipeline.ts';
import type { PipelineVariables } from './pipeline.ts';

const variables: PipelineVariables = { source: 'Dados com {{brief}} e {{env.SECRET}}',brief: 'Pauta real',sizing: '',outline: '',section: '',history: '',futureSections: '',layouts: '',approvedArticle: '' };

test('the Make adaptation contains all runtime inputs without speculative external research',() => {
  const definition = defaultPipelineDefinition();
  assert.equal(validatePipelineTemplates(definition),undefined);
  assert.equal(definition.articleMode,'sequential');
  assert.equal(definition.curateQuotes,true);
  assert.ok(definition.systemPrompt.includes('Não presuma pesquisas'));
});
test('preset 2.0 grounds each editorial part without recap, invented negatives or mandatory padding',() => {
  const definition = defaultPipelineDefinition();
  assert.match(definition.systemPrompt,/prompts editoriais 2\.0/);
  assert.match(definition.systemPrompt,/Uma lacuna não comprova uma negativa/);
  for (const [key, step] of Object.entries(definition.steps)) {
    assert.match(step.prompt,/PROMPTS 2\.0/);
    assert.equal(step.model,'openai/gpt-oss-120b');
    assert.equal(step.maxTokens,key === 'material' ? 2048 : 4096);
  }
  assert.match(definition.steps.intro.prompt,/Use introIds como foco/);
  assert.match(definition.steps.intro.prompt,/primeira frase deve identificá-la como simulação/);
  assert.match(definition.steps.section.prompt,/section\.evidenceIds/);
  assert.match(definition.steps.section.prompt,/Nunca retorne uma lista vazia/);
  assert.match(definition.steps.section.prompt,/não como nova fonte factual/);
  assert.match(definition.steps.article.prompt,/targetChars e minChars não autorizam/);
  assert.match(definition.steps.carousel.prompt,/Use exclusivamente a versão do artigo aprovado/);
  assert.match(definition.steps.carousel.prompt,/inclusive na abertura/);
  assert.match(definition.steps.carousel.prompt,/70% de maxChars/);
  assert.ok(definition.steps.facts.temperature < definition.steps.section.temperature);
  assert.match(definition.steps.facts.prompt,/até 25 registros concisos/);
  assert.match(definition.steps.facts.prompt,/não apenas reescreva/);
  assert.ok(definition.steps.facts.prompt.includes('{{brief}}'));
  assert.equal(defaultPipelineDefinition('openai/gpt-oss-20b').steps.section.model,'openai/gpt-oss-20b');
});
test('provider contracts require the same nonempty editorial parts as the worker validator',() => {
  const facts = PIPELINE_SCHEMAS.facts.properties.facts as { maxItems: number; minItems: number };
  assert.equal(facts.maxItems,50);
  assert.equal(facts.minItems,1);
  const intro = PIPELINE_SCHEMAS.intro.properties.paragraphs as { minItems: number; maxItems: number };
  const section = PIPELINE_SCHEMAS.section.properties.paragraphs as { minItems: number; maxItems: number };
  const article = PIPELINE_SCHEMAS.article.properties as {
    intro: typeof intro; sections: { minItems: number; maxItems: number; items: { properties: { paragraphs: typeof section } } };
  };
  assert.deepEqual([intro.minItems,intro.maxItems],[1,3]);
  assert.deepEqual([section.minItems,section.maxItems],[1,10]);
  assert.deepEqual(article.intro,intro);
  assert.deepEqual([article.sections.minItems,article.sections.maxItems],[1,8]);
  assert.deepEqual(article.sections.items.properties.paragraphs,section);
});
test('prompt substitution is single pass: source text cannot become variables or code',() => {
  assert.equal(renderPipelinePrompt('Fonte {{ source }} / pauta {{brief}}',variables),'Fonte Dados com {{brief}} e {{env.SECRET}} / pauta Pauta real');
  assert.throws(() => renderPipelinePrompt('{{env.SECRET}}',variables),/UNKNOWN_PROMPT_VARIABLE/);
});
test('unknown and missing context variables refuse a configuration, not an execution later',() => {
  const definition = defaultPipelineDefinition();
  definition.steps.outline.prompt += '{{unknown}}';
  assert.match(validatePipelineTemplates(definition)!,/desconhecida/);
  definition.steps.outline.prompt = 'Texto sem fonte {{brief}}';
  assert.match(validatePipelineTemplates(definition)!,/mantenha {{source}}/);
  definition.steps.outline = defaultPipelineDefinition().steps.outline;
  definition.systemPrompt += '{{source}}';
  assert.match(validatePipelineTemplates(definition)!,/não recebe variáveis/);
});
test('snapshots remain immutable when a later prompt or orchestration is edited',() => {
  const definition = defaultPipelineDefinition(),snapshot = pipelineRevision(definition,3);
  definition.steps.intro.prompt += '\nNovo estilo';
  definition.articleMode = 'single';
  assert.notEqual(pipelineRevision(definition).hash,snapshot.hash);
  assert.equal(snapshot.definition.articleMode,'sequential');
  assert.ok(!snapshot.definition.steps.intro.prompt.includes('Novo estilo'));
  assert.equal(pipelineRevision(snapshot.definition,4,'today').hash,snapshot.hash);
});
test('run steps represent the selected orchestration and real section count',() => {
  const definition = defaultPipelineDefinition();
  const ids = (kind: string,count = 4) => pipelineRunSteps(definition,kind,count).map(step => step.id);
  assert.deepEqual(ids('article.outline'),['source','outline','quotes']);
  assert.deepEqual(ids('article.draft'),['source','intro','section-0','section-1','section-2','section-3','images']);
  definition.curateQuotes = false; definition.articleMode = 'single';
  assert.deepEqual(ids('article.outline'),['source','outline']);
  assert.deepEqual(ids('article.draft'),['source','article','images']);
  assert.deepEqual(ids('carousel.copy'),['source','carousel']);
  for (const kind of ['article.rewrite','article.shorten','article.ask','article.titles'])
    assert.deepEqual(ids(kind),['source','assist','validate']);
});
