import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactFunnels, defaultPipelineDefinition, formatPipelineDefinition, FUNNEL_STEP_KEYS, pipelineRevision, pipelineRunSteps, pipelineJobKeys, renderPipelinePrompt, validatePipelineTemplates, withFormatFunnels, PIPELINE_SCHEMAS } from './pipeline.ts';
import { EDITORIAL_FORMATS } from './formats.ts';
import { HARD_NEWS } from './format-prompts.ts';
import type { PipelineVariables } from './pipeline.ts';

const variables: PipelineVariables = { source: 'Dados com {{brief}} e {{env.SECRET}}',brief: 'Pauta real',sizing: '',outline: '',section: '',history: '',futureSections: '',layouts: '',approvedArticle: '', event: '', people: '' };

test('the Make adaptation contains all runtime inputs without speculative external research',() => {
  const definition = defaultPipelineDefinition();
  assert.equal(validatePipelineTemplates(definition),undefined);
  assert.equal(definition.articleMode,'sequential');
  assert.equal(definition.curateQuotes,true);
  assert.ok(definition.systemPrompt.includes('Não presuma pesquisas'));
});
test('preset 3.0 grounds each editorial part without recap, invented negatives or mandatory padding',() => {
  const definition = defaultPipelineDefinition();
  assert.match(definition.systemPrompt,/prompts editoriais 3\.0/);
  assert.match(definition.systemPrompt,/Uma lacuna não comprova uma negativa/);
  for (const [key, step] of Object.entries(definition.steps)) {
    assert.match(step.prompt,/PROMPTS 3\.0/);
    assert.equal(step.model,'openai/gpt-oss-120b');
    assert.equal(step.maxTokens,key === 'material' ? 2048 : 4096);
  }
  assert.match(definition.steps.intro.prompt,/Use introIds como foco/);
  assert.match(definition.steps.intro.prompt,/primeira frase deve identificá-la como simulação/);
  assert.match(definition.steps.section.prompt,/section\.evidenceIds/);
  assert.match(definition.steps.section.prompt,/Nunca retorne uma lista vazia/);
  assert.match(definition.steps.section.prompt,/não como nova fonte factual/);
  for (const key of ['intro','section'] as const) {
    // A short part is developed, never shortened again: each revision names its direction.
    assert.match(definition.steps[key].prompt,/siga somente minChars, minWords, maxChars, targetChars e targetWords/);
    assert.match(definition.steps[key].prompt,/Para ARTICLE_PART_SIZE_EXCEEDED, encurte/);
    assert.match(definition.steps[key].prompt,/Para ARTICLE_PART_TOO_SHORT, substitua-o por uma versão mais desenvolvida, com ao menos minTotalWords palavras/);
    assert.doesNotMatch(definition.steps[key].prompt,/previousDraft não cumpriu o contrato: substitua-o por uma versão mais curta/);
  }
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
test('preset 3.0 carries hard news into the article prompts', () => {
  const definition = defaultPipelineDefinition();
  const { steps } = definition;
  assert.ok(definition.systemPrompt.includes(HARD_NEWS));
  assert.doesNotMatch(steps.quotes.prompt, /ao menos duas/);
  for (const variable of ['{{sizing}}', '{{people}}']) assert.ok(steps.quotes.prompt.includes(variable), variable);
  for (const key of ['outline', 'intro', 'section', 'article'] as const) assert.ok(steps[key].prompt.includes('{{people}}'), key);
  // The assistant receives no people or event data (article-assist.ts), so its prompt cannot name them.
  assert.doesNotMatch(steps.assist.prompt, /\{\{(people|event)\}\}|as duas citações obrigatórias/);
  assert.match(steps.intro.prompt, /em até 40 palavras/);
  assert.match(steps.facts.prompt, /no máximo 5 registros/);
  for (const key of ['outline', 'quotes'] as const) assert.match(steps[key].prompt, /de 1 a 4 ids/, key);
  assert.ok(definition.systemPrompt.length <= 12000, `system: ${definition.systemPrompt.length}`);
  for (const [key, step] of Object.entries(steps)) assert.ok(step.prompt.length <= 20000, `${key}: ${step.prompt.length}`);
  assert.equal(validatePipelineTemplates(definition), undefined);
});
test('the carousel prompt writes for the Instagram feed: a hook on the cover, one idea per slide, a call without a link',() => {
  const prompt = defaultPipelineDefinition().steps.carousel.prompt;
  assert.match(prompt,/feed do Instagram/);
  assert.match(prompt,/gancho que faz a pessoa arrastar/);
  assert.match(prompt,/fato concreto mais forte do artigo/);
  assert.match(prompt,/um slide, uma ideia/i);
  assert.match(prompt,/sem link clicável/);
  assert.match(prompt,/Nunca escreva URL, "clique aqui"/);
  // The Instagram guidance never loosens the editorial guards around it.
  assert.match(prompt,/Use exclusivamente a versão do artigo aprovado/);
  assert.match(prompt,/Evite caça-cliques, sensacionalismo/);
  assert.match(prompt,/exatamente como ele aparece/);
  assert.equal(validatePipelineTemplates(defaultPipelineDefinition()),undefined);
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
test('the opening selects up to four passages in planning and in curation', () => {
  assert.equal((PIPELINE_SCHEMAS.outline.properties.introIds as { maxItems: number }).maxItems, 4);
  assert.equal((PIPELINE_SCHEMAS.quotes.properties.introIds as { maxItems: number }).maxItems, 4);
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
  assert.deepEqual(ids('article.draft'),['source','outline','quotes','intro','section-0','section-1','section-2','section-3','images']);
  assert.deepEqual(pipelineJobKeys(definition,'article.draft'),['facts','outline','quotes','intro','section']);
  assert.deepEqual(pipelineJobKeys(definition,'article.draft',false),['facts','intro','section']);
  assert.deepEqual(pipelineRunSteps(definition,'article.draft',2,false).map(step => step.id),['source','intro','section-0','section-1','images']);
  definition.curateQuotes = false; definition.articleMode = 'single';
  assert.deepEqual(ids('article.outline'),['source','outline']);
  assert.deepEqual(ids('article.draft'),['source','outline','article','images']);
  assert.deepEqual(pipelineJobKeys(definition,'article.draft'),['facts','outline','article']);
  assert.deepEqual(ids('carousel.copy'),['source','carousel']);
  for (const kind of ['article.rewrite','article.shorten','article.ask','article.titles'])
    assert.deepEqual(ids(kind),['source','assist','validate']);
});

test('event funnels: defaults validate, keep the anti-invention rules and the house style', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  assert.equal(validatePipelineTemplates(definition), undefined);
  for (const format of EDITORIAL_FORMATS) {
    const funnel = definition.funnels[format];
    for (const key of FUNNEL_STEP_KEYS) {
      assert.match(funnel[key].prompt, /JORNALISMO, NUNCA INVENÇÃO/, `${format} ${key}`);
      assert.match(funnel[key].prompt, /\{\{event\}\}/, `${format} ${key}`);
      assert.match(funnel[key].prompt, /\{\{people\}\}/, `${format} ${key}`);
    }
    assert.match(funnel.intro.prompt, /Em resumo/);
    assert.match(funnel.section.prompt, /UNGROUNDED_FACT/);
    assert.match(funnel.outline.prompt, /dek/);
  }
});

test('every funnel writes hard news', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  assert.equal(validatePipelineTemplates(definition), undefined);
  for (const format of EDITORIAL_FORMATS) {
    const funnel = definition.funnels[format];
    for (const key of ['outline', 'intro', 'section'] as const) assert.ok(funnel[key].prompt.includes(HARD_NEWS), `${format} ${key}`);
    for (const key of ['intro', 'section'] as const) assert.doesNotMatch(funnel[key].prompt, /explica, ressalta|Verbos de atribuição variados|citações longas/, `${format} ${key}`);
    assert.match(funnel.outline.prompt, /de 1 a 4 ids para a abertura/, format);
    // The style references are invented examples, never a published text of a real company or event.
    assert.match(funnel.intro.prompt, /exemplo fictício/, format);
    assert.doesNotMatch(funnel.intro.prompt, /BomPORTO|Friocenter|Frescatto|Trident|Gregolin|Édipo|Aquishow|APAS Show|IFC Brasil|SENA/, format);
    for (const key of FUNNEL_STEP_KEYS) assert.ok(funnel[key].prompt.length <= 20000, `${format} ${key}: ${funnel[key].prompt.length}`);
  }
  assert.doesNotMatch(definition.funnels.stand.outline.prompt, /Verbos da casa/);
  assert.doesNotMatch(definition.funnels.awards.intro.prompt, /Confira a seguir/);
  assert.match(definition.funnels.stand.section.prompt, /Gravação de estande sem rótulos de falante/);
});

test('the quote request lets a part decline and never reaches the interviewer', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  const writing = [definition.steps.intro.prompt, definition.steps.section.prompt,
    ...EDITORIAL_FORMATS.flatMap(format => [definition.funnels[format].intro.prompt, definition.funnels[format].section.prompt])];
  for (const prompt of writing) {
    assert.match(prompt, /copie exatamente um trecho contínuo e curto de uma das falas de revisionFeedback\.availableQuotes/);
    assert.match(prompt, /nunca de quem entrevista, pergunta, apresenta ou agradece; se nenhuma servir, devolva a parte sem citação/);
  }
  // Only a stand interview gives the answers of a recording without speaker labels to its one person.
  for (const format of EDITORIAL_FORMATS) assert.equal(/uma única pessoa em people, as respostas são dela/.test(definition.funnels[format].quotes.prompt), format === 'stand', format);
  assert.doesNotMatch(definition.steps.quotes.prompt, /uma única pessoa em people/);
});

test('the newsroom\'s note on a curated quote is never a source', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  for (const prompt of [definition.steps.outline.prompt, ...EDITORIAL_FORMATS.map(format => definition.funnels[format].outline.prompt)])
    assert.match(prompt, /a nota da redação que acompanha cada uma não é fonte: nenhum fato dela entra no título/);
  for (const format of EDITORIAL_FORMATS) for (const key of ['intro', 'section'] as const)
    assert.doesNotMatch(definition.funnels[format][key].prompt, /relevance/, `${format} ${key}`);
});

test('the style references follow the rules they illustrate', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  // The awards winner is the person of the list, the institution her affiliation, and no number the list lacks.
  const awards = definition.funnels.awards.intro.prompt;
  assert.match(awards, /Título: Ana Souza, da Cooperativa Rio Claro, vence categoria Produção/);
  assert.match(awards, />> Ouro: Ana Souza, da Cooperativa Rio Claro \| Projeto:/);
  assert.doesNotMatch(awards, /Cooperativa Rio Claro venceu|30%/);
  // A price, a rate, a projection or a schedule names its source.
  for (const [format, pattern] of [['stand', /R\$ 24,90, segundo a empresa/], ['opening', /6% ao ano, segundo o secretário/],
    ['panel', /Segundo ela, a projeção/], ['note', /Segundo a empresa, o primeiro embarque/]] as const)
    assert.match(definition.funnels[format].section.prompt, pattern, format);
});

test('a saved revision without funnels gets the defaults; saved funnels are never changed', () => {
  const saved = defaultPipelineDefinition();
  assert.equal(saved.funnels, undefined);
  const filled = withFormatFunnels(saved);
  assert.deepEqual(Object.keys(filled.funnels!).sort(), [...EDITORIAL_FORMATS].sort());
  assert.equal(filled.funnels!.stand!.intro.model, saved.steps.intro.model);
  const edited = withFormatFunnels({ ...saved, funnels: { stand: { ...filled.funnels!.stand!, intro: { ...filled.funnels!.stand!.intro, prompt: 'Minha abertura {{source}} {{outline}} {{sizing}}' } } } });
  assert.equal(edited.funnels!.stand!.intro.prompt, 'Minha abertura {{source}} {{outline}} {{sizing}}');
  assert.deepEqual(saved.funnels, undefined);
});

test('a format job writes part by part with the funnel prompts; the article steps stay the workspace\'s', () => {
  const base = { ...defaultPipelineDefinition(), articleMode: 'single' as const };
  const job = formatPipelineDefinition(base, 'panel');
  const funnels = withFormatFunnels(base).funnels;
  assert.equal(job.articleMode, 'sequential');
  assert.equal(job.steps.outline.prompt, funnels.panel.outline.prompt);
  assert.equal(job.steps.section.prompt, funnels.panel.section.prompt);
  assert.equal(job.steps.carousel.prompt, base.steps.carousel.prompt);
  assert.equal(job.systemPrompt, base.systemPrompt);
});

test('a format job curates evidence with its own funnel prompt', () => {
  const base = defaultPipelineDefinition();
  const job = formatPipelineDefinition(base, 'awards');
  const prompt = job.steps.quotes.prompt;
  assert.equal(prompt, withFormatFunnels(base).funnels.awards.quotes.prompt);
  for (const pattern of [/sizing\.minQuotes/, /\{\{sizing\}\}/, /\{\{people\}\}/, /de 1 a 4 ids/, /sem falas/]) assert.match(prompt, pattern);
  // The workspace's shared curation stays the article's.
  assert.deepEqual(base.steps.quotes, defaultPipelineDefinition().steps.quotes);
  assert.notEqual(prompt, base.steps.quotes.prompt);
  assert.equal(job.curateQuotes, true);
  assert.equal(formatPipelineDefinition({ ...base, curateQuotes: false }, 'awards').curateQuotes, false);
});

test('a funnel prompt without its required data is refused on save', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  definition.funnels.note.section = { ...definition.funnels.note.section, prompt: 'Escreva {{section}} {{history}} {{futureSections}} {{sizing}}' };
  assert.equal(validatePipelineTemplates(definition), 'Nota curta · Seções: mantenha {{source}} para fornecer o contexto necessário.');
});

test('saved revisions keep only the funnel steps someone edited', () => {
  const filled = withFormatFunnels(defaultPipelineDefinition());
  assert.equal(compactFunnels(filled).funnels, undefined);
  filled.funnels.stand.intro = { ...filled.funnels.stand.intro, prompt: filled.funnels.stand.intro.prompt + '\nAbra pela empresa.' };
  const compact = compactFunnels(filled);
  assert.deepEqual(Object.keys(compact.funnels!), ['stand']);
  assert.deepEqual(Object.keys(compact.funnels!.stand!), ['intro']);
  assert.equal(withFormatFunnels(compact).funnels.stand.intro.prompt, filled.funnels.stand.intro.prompt);
  assert.equal(withFormatFunnels(compact).funnels.stand.outline.prompt, withFormatFunnels(defaultPipelineDefinition()).funnels.stand.outline.prompt);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(filled).length / 3);
});
