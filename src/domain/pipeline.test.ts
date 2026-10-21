import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactFunnels, defaultPipelineDefinition, formatPipelineDefinition, FUNNEL_STEP_KEYS, pipelineRevision, pipelineRunSteps, pipelineJobKeys, renderPipelinePrompt, validatePipelineTemplates, withFormatFunnels, PIPELINE_SCHEMAS } from './pipeline.ts';
import { EDITORIAL_FORMATS, FORMAT_SPECS } from './formats.ts';
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
  // A format may count the answers of an unlabeled stand interview: the request leaves out the interviewer's lines and may come back without a quote.
  for (const format of EDITORIAL_FORMATS) for (const key of ['intro', 'section'] as const) {
    const prompt = definition.funnels[format][key].prompt;
    assert.match(prompt, /copie exatamente um trecho contínuo e curto de uma das falas de revisionFeedback\.availableQuotes que não seja de quem entrevista, pergunta, apresenta ou agradece/, `${format} ${key}`);
    assert.match(prompt, /se nenhuma dessas falas servir, devolva a parte sem citação/, `${format} ${key}`);
  }
  // An R1 article is asked only for lines of linked speakers, each with its speaker. A permission to return a part
  // without a quote made the rehearsal's R1 articles drop the quotes of unidentified voices and fail their minimum.
  for (const key of ['intro', 'section'] as const) {
    assert.match(definition.steps[key].prompt, /copie exatamente um trecho contínuo e curto de uma das falas de revisionFeedback\.availableQuotes, com o id em evidenceIds e atribuído ao speaker dessa fala/, key);
    assert.doesNotMatch(definition.steps[key].prompt, /devolva a parte sem citação/, key);
  }
  // Only a stand interview gives the answers of a recording without speaker labels to its one person.
  for (const format of EDITORIAL_FORMATS) assert.equal(/uma única pessoa em people, as respostas são dela/.test(definition.funnels[format].quotes.prompt), format === 'stand', format);
  assert.doesNotMatch(definition.steps.quotes.prompt, /uma única pessoa em people/);
});

test('a section keeps one quote as the floor and adds a second when it brings new information', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  const second = 'um número, uma razão, uma posição ou uma previsão que o texto ainda não traz';
  // The shared block: the floor stays, and a second quote may never repeat a paraphrase, open the lide or come from the interviewer.
  assert.match(HARD_NEWS, /Cada seção traz uma fala literal sempre que suas evidências tiverem uma frase citável/);
  assert.ok(HARD_NEWS.includes(`Uma segunda fala literal curta entra na mesma seção sempre que trouxer ${second}: nunca para repetir uma paráfrase, nunca na primeira frase do lide, sempre atribuída e nunca de quem entrevista.`));
  for (const format of EDITORIAL_FORMATS) {
    for (const key of ['intro', 'section'] as const)
      assert.ok(definition.funnels[format][key].prompt.includes(`Quando esta parte já traz uma fala, acrescente uma segunda fala curta de literalEvidence, de outro trecho, sempre que ela trouxer ${second}`), `${format} ${key}`);
    // Curation hands each section the lines for it.
    assert.match(definition.funnels[format].quotes.prompt, /até 2 passagens citáveis por seção, cada uma com os ids de todas as suas frases/, format);
  }
  assert.match(definition.steps.quotes.prompt, /até 2 passagens citáveis por seção, cada uma com os ids de todas as suas frases/);
  assert.match(definition.steps.section.prompt, /Traga uma fala literal curta — uma ideia, uma ou duas frases — sempre que/);
  assert.ok(definition.steps.section.prompt.includes(`Traga também uma segunda fala literal curta, de outro trecho, sempre que ela acrescentar ${second}`));
  assert.ok(definition.steps.article.prompt.includes(`e uma segunda na mesma seção sempre que ela acrescentar ${second} (nunca para repetir uma paráfrase, nunca na primeira frase do lide`));
  // The minimums do not move, and awards sections stay lists.
  assert.deepEqual(EDITORIAL_FORMATS.map(format => FORMAT_SPECS[format].minQuotes), [2, 3, 0, 2, 0]);
  assert.match(definition.funnels.awards.section.prompt, /Nesta premiação as seções não levam citação: só a lista/);
});

test('an article section quotes an unnamed voice while the text still lacks its minimum', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  const section = definition.steps.section.prompt;
  // A recording without speaker labels and with two people has no identified line: the quote plan
  // still says how many quotations the text lacks, and the section brings them as unnamed voices.
  assert.ok(section.includes('enquanto sizing.quotePlan.quotesStillNeeded for maior que zero, esta seção traz ao menos uma fala literal curta de suas evidências'));
  assert.ok(section.includes('nunca de quem entrevista, pergunta ou agradece; sem falante identificado, atribua-a de forma neutra, como parte do episódio ("segundo um dos participantes do episódio", "disse um dos entrevistados"), nunca com um nome.'));
  assert.match(section, /Na última seção, traga todas as que ainda faltarem\./);
  // The floor per section and the rule against naming an unidentified voice stay.
  assert.match(section, /Traga uma fala literal curta — uma ideia, uma ou duas frases — sempre que as evidências desta seção tiverem uma frase citável de um falante identificado/);
  assert.match(section, /Identifique a pessoa só quando a evidência associar essa fala ao falante/);
  // Formats keep their own part prompts.
  for (const format of EDITORIAL_FORMATS) assert.doesNotMatch(definition.funnels[format].section.prompt, /quotesStillNeeded/, format);
});

test('an unlabeled voice is attributed neutrally, never as a comment on the transcript', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  const { steps } = definition;
  const neutral = '("segundo um dos participantes do episódio", "disse um dos entrevistados")';
  // The rehearsal's R1 texts wrote "afirma uma voz não identificada na transcrição" and "Segundo a fala sem autoria identificada".
  assert.ok(HARD_NEWS.includes(`Todo número, previsão e opinião tem fonte: a pessoa pelo nome quando o material identifica quem disse; quando não identifica, a atribuição neutra a quem participa da gravação ${neutral}, nunca um nome inventado. Nunca comente a transcrição nem a autoria de uma fala ("voz não identificada", "fala sem autoria").`));
  // The shared rules no longer ask every quote for an identified speaker or every opinion for a named source.
  assert.ok(HARD_NEWS.includes('de um falante identificado quando o material identifica quem fala (senão, com a atribuição neutra acima), nunca de quem entrevista'));
  assert.doesNotMatch(HARD_NEWS, /tem fonte nomeada|frase citável: de um falante identificado, nunca/);
  assert.ok(definition.systemPrompt.includes(`Quando a fonte não identificar quem falou, atribua a fala de forma neutra, como parte do episódio ${neutral}`));
  assert.ok(steps.article.prompt.includes(`Uma fala sem falante identificado entra com atribuição neutra, como parte do episódio ${neutral}, sem comentar a transcrição nem a autoria`));
  assert.match(steps.section.prompt, /caso contrário, use a atribuição neutra ao episódio, sem nome e sem comentar a transcrição nem a autoria/);
  assert.match(steps.intro.prompt, /Se não houver falante identificado, não invente atribuição: atribua a fala de forma neutra, como parte do episódio/);
  // Selection agrees with writing: an answer of a recording without speaker labels is quotable, its question never.
  assert.ok(steps.quotes.prompt.includes('Uma passagem citável é uma frase de quem fala no material — de um falante identificado quando a fonte o identifica; numa gravação sem rótulos de falante, uma resposta, nunca a pergunta —, nunca de quem entrevista, pergunta, apresenta ou agradece'));
  assert.ok(steps.outline.prompt.includes('inclua uma passagem citável — de um falante identificado quando a fonte o identifica; numa gravação sem rótulos de falante, uma resposta, nunca a pergunta —'));
  // "fala do episódio" leaked into the copy as meta wording; no prompt asks for it any more.
  for (const prompt of [definition.systemPrompt, ...Object.values(steps).map(step => step.prompt),
    ...EDITORIAL_FORMATS.flatMap(format => FUNNEL_STEP_KEYS.map(key => definition.funnels[format][key].prompt))])
    assert.doesNotMatch(prompt, /fala do episódio|voz não identificada pode/);
});

test('a panel quotes every speaker with a quotable line and develops each thesis without padding', () => {
  const panel = withFormatFunnels(defaultPipelineDefinition()).funnels.panel;
  for (const key of ['outline', 'quotes'] as const) {
    assert.match(panel[key].prompt, /cada palestrante com uma frase citável na fonte tem ao menos uma passagem citável selecionada/, key);
    assert.match(panel[key].prompt, /os argumentos, dados e exemplos concretos que o palestrante deu sobre ela/, key);
  }
  const section = panel.section.prompt;
  assert.match(section, /Cada palestrante com uma frase citável tem ao menos uma fala no texto: se as evidências desta seção têm uma frase citável de um palestrante ainda não citado no texto escrito até agora, cite-o nesta seção/);
  assert.match(section, /Desenvolva cada seção com os argumentos, dados e exemplos concretos do palestrante que estão nas evidências dela/);
  assert.match(section, /quando as evidências acabarem, pare: nunca preencha com repetição, generalidade ou fato de outra seção/);
  assert.doesNotMatch(section, /Uma segunda fala só se trouxer informação nova/);
  // The style reference quotes both speakers of its panel.
  assert.match(section, /“O Chile paga em dólar e compra o ano inteiro”, afirmou Dias/);
});

test('awards list every winner and every nominee the material names, with a number only from the source', () => {
  const awards = withFormatFunnels(defaultPipelineDefinition()).funnels.awards;
  for (const key of ['outline', 'quotes'] as const)
    assert.match(awards[key].prompt, /As seções trazem só listas, sem falas: os vencedores e os indicados ou finalistas que a fonte nomear/, key);
  const section = awards.section.prompt;
  assert.match(section, /Liste todos os vencedores e todos os indicados ou finalistas que o material nomear, em um único parágrafo por lista, no molde "Os indicados foram: \[Nome\], da \[Instituição\]; \[Nome\], da \[Instituição\]\."/);
  assert.match(section, /Um número de vencedores, indicados ou finalistas só entra quando a fonte o escreve; nunca conte nomes para criar um número/);
  assert.doesNotMatch(section, /houver uma seção para eles/);
  assert.match(awards.intro.prompt, /os vencedores e os indicados vêm nas seções/);
});

test('an awards nominee list the source does not split by category never sits under a category', () => {
  const awards = withFormatFunnels(defaultPipelineDefinition()).funnels.awards;
  // The rehearsal's mixed list of men and women read as the men's category nominees under "Categoria Personalidade Masculina".
  for (const key of ['outline', 'quotes'] as const) {
    const prompt = awards[key].prompt;
    assert.ok(prompt.includes('Uma lista de indicados ou finalistas que a fonte não separa por categoria nunca fica sob o intertítulo de uma categoria: a última seção da pauta se chama "Indicados" ("Finalistas" quando a fonte os chamar assim) e recebe só os ids dessa lista; as categorias ocupam as seções anteriores.'), key);
    // The outline keeps the pauta's number of sections (the server validates it): categories share a section to make room.
    assert.ok(prompt.includes('agrupe categorias vizinhas numa seção "Categorias [Nome] e [Nome]", sem omitir nenhum vencedor'), key);
    assert.ok(prompt.includes('Com uma só seção na pauta, ela se chama "Vencedores e indicados"'), key);
    assert.doesNotMatch(prompt, /quando a fonte não os separar por categoria, na última seção/, key);
  }
  const section = awards.section.prompt;
  assert.ok(section.includes('Uma lista que a fonte não separa por categoria nunca fica sob o intertítulo de uma categoria: ela forma a seção "Indicados" ou "Finalistas"'));
  assert.ok(section.includes('abra o parágrafo com "Os indicados ao prêmio, em todas as categorias, foram: …"'));
  assert.ok(section.includes('Numa seção que reúne mais de uma categoria, cada vencedor leva a sua antes da colocação: ">> [Categoria] – [Colocação]: [Nome], da [Instituição]."'));
  // The style reference shows the list in its own last section, after a grouped one.
  assert.match(section, /\[Intertítulo\] Categorias Academia e Sustentabilidade\n\n>> Academia – Ouro: Pedro Lins/);
  assert.match(section, /\[Intertítulo\] Indicados\n\nOs indicados foram: Ana Souza, da Cooperativa Rio Claro; João Pires/);
  // The lide names the winners, never only the categories.
  assert.ok(awards.intro.prompt.includes('o [Prêmio] e quem o venceu, pelo nome (todos os vencedores, cada um com a sua categoria, quando couberem nas 40 palavras;'));
  assert.ok(awards.intro.prompt.includes('nunca só as categorias premiadas'));
  assert.doesNotMatch(awards.intro.prompt, /, ou as categorias premiadas —/);
});

test('headlines and texts carry the date as the event gives it, never hoje, amanhã or ontem', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  assert.ok(HARD_NEWS.includes('- Datas: no título e no texto, a data ou o dia da semana como o evento ou a fonte os trazem ("nesta terça-feira", "em 20 de outubro"); fora das aspas, nunca "hoje", "amanhã" ou "ontem", mesmo que a pauta ou a fonte os usem.'));
  // The shared block reaches every headline: the structure prompts of the funnels and the 3.0 system message.
  for (const format of EDITORIAL_FORMATS) {
    assert.ok(definition.funnels[format].outline.prompt.includes(HARD_NEWS), format);
    for (const key of ['intro', 'section'] as const)
      assert.match(definition.funnels[format][key].prompt, /Fora das aspas, nunca escreva "hoje", "amanhã" ou "ontem", nem ao lado da data/, `${format} ${key}`);
  }
  assert.ok(definition.systemPrompt.includes(HARD_NEWS));
  const note = definition.funnels.note;
  assert.match(note.outline.prompt, /use o dia da semana ou a data como a fonte ou o evento os trazem \("nesta terça-feira"\), nunca "hoje", "amanhã" ou "ontem", mesmo que a pauta os use/);
  assert.match(note.intro.prompt, /Datas exatamente como a fonte, event e event\.today as trazem; nunca "hoje", "amanhã" ou "ontem", nem ao lado da data/);
  assert.doesNotMatch(note.intro.prompt, /"ontem" sem a data/);
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
