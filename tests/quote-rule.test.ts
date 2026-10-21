import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { PipelineDefinition, PipelineVariables } from '../src/domain/pipeline.ts';
import { defaultPipelineDefinition, explainedRevisionCodes, formatPipelineDefinition } from '../src/domain/pipeline.ts';
import { EDITORIAL_FORMATS, quoteRuleFor } from '../src/domain/formats.ts';
import { quotableIds, quotableSpeaker, quoteRequirement } from '../src/domain/quote-plan.ts';
import type { QuotableCandidate, QuoteRule } from '../src/domain/quote-plan.ts';
import { writeSequentialArticle } from '../src/server/pipeline-runner.ts';

process.env.REPORTER_LOCAL_MODE = 'true';
process.env.GROQ_API_KEY = 'test-placeholder-not-a-real-key';

const variables: PipelineVariables = { source: '[e1] fonte', brief: '{}', sizing: '{}', outline: '{}', section: '', history: '', futureSections: '', layouts: '', approvedArticle: '', event: '{}', people: '[]' };
const candidates = new Map<string, QuotableCandidate>([
  ['e1', { key: 'e1', speaker: 'Scorsin', text: 'A merluza empanada chega ao varejo em junho.' }],
  ['e2', { key: 'e2', speaker: 'Scorsin', text: 'Nossa embalagem foi pensada para comunicar os benefícios do produto.' }],
  ['e3', { key: 'e3', speaker: 'Repórter', text: 'E como vocês estão comunicando o produto?' }],
  ['e4', { key: 'e4', speaker: 'Scorsin', text: 'Também passamos a introduzir promotoras nas lojas.' }],
]);
const evidence = new Map([...candidates].map(([key, candidate]) => [key, candidate.text]));
const identified = (candidate: QuotableCandidate) => candidate.speaker === 'Scorsin';
const soft = (rule: QuoteRule) => ({ rule, quotable: (ids: readonly string[]) => quotableIds(ids, candidates, identified).map(id => candidates.get(id)!) });
const paragraph = (text: string, ids = ['e2']) => ({ text, evidenceIds: ids });
const intro = { paragraphs: [paragraph('A Hecke Alimentos apresentou a merluza empanada na APAS Show 2026.', ['e1'])] };
const quoted = '“Nossa embalagem foi pensada para comunicar os benefícios do produto”, disse Scorsin.';

test('a part takes one quotation where its evidence allows, plus what the later parts cannot give', () => {
  const stand: QuoteRule = { minQuotes: 2, openingQuote: true, sectionQuotes: true };
  assert.equal(quoteRequirement({ rule: stand, quoted: 0, available: [1, 2, 1], index: 0 }), 1);
  assert.equal(quoteRequirement({ rule: stand, quoted: 0, available: [0, 2, 0], index: 1 }), 2, 'no later part can help');
  assert.equal(quoteRequirement({ rule: stand, quoted: 0, available: [1, 0, 1], index: 1 }), 0, 'nothing quotable here');
  assert.equal(quoteRequirement({ rule: { minQuotes: 3, openingQuote: false, sectionQuotes: true }, quoted: 0, available: [2, 1, 1, 1], index: 0 }), 0,
    'a panel opening is not asked while the sections reach the minimum');
  assert.equal(quoteRequirement({ rule: { minQuotes: 0, openingQuote: false, sectionQuotes: false }, quoted: 0, available: [1, 3], index: 1 }), 0, 'awards lists carry none');
  assert.deepEqual(quotableIds(['e1', 'e2', 'e3', 'e2'], candidates, identified), ['e1', 'e2'], 'the interviewer and repeats are left out');
  assert.deepEqual(quotableIds(['e3'], candidates, () => true), [], 'a question is never quotable');
  assert.deepEqual(quoteRuleFor({}), { minQuotes: 2, openingQuote: false, sectionQuotes: true });
  assert.deepEqual(quoteRuleFor({ format: 'stand' }), { minQuotes: 2, openingQuote: true, sectionQuotes: true });
  assert.deepEqual(quoteRuleFor({ format: 'awards' }), { minQuotes: 0, openingQuote: false, sectionQuotes: false });
});

test('a line without a speaker label is quoted with a name only in a stand interview, never the interviewer\'s', () => {
  const line = (text: string, speaker?: string): QuotableCandidate => ({ key: 'x', text, ...(speaker ? { speaker } : {}) });
  const stand = quotableSpeaker({ linked: new Set(['Scorsin']), people: [{ name: 'Ricardo Lemos' }], unlabeledAnswers: true });
  assert.equal(stand(line('A porção menor atende a um pedido dos supermercados.')), true, 'one of her answers');
  for (const text of ['Estamos aqui no estande da Pescados Litoral com o Ricardo.', 'Muito obrigado pela entrevista, Ricardo, sucesso na feira.',
    'Agradecemos a presença de todos aqui na feira.', 'Fale um pouco sobre o produto.', 'Conta pra gente como foi o ano.'])
    assert.equal(stand(line(text)), false, text);
  assert.equal(stand(line('O pedido de habilitação sai este ano.', 'Scorsin')), true, 'a linked speaker');
  assert.equal(stand(line('O pedido de habilitação sai este ano.', 'Repórter')), false, 'an unlinked label');
  // A panel, an opening, a note or an R1 recording: the mediator, the host or the MC may have said it.
  const panel = quotableSpeaker({ linked: new Set(), people: [{ name: 'Marta Lima' }], unlabeledAnswers: false });
  assert.equal(panel(line('A ração responde por 70% do custo de produção.')), false);
  const two = quotableSpeaker({ linked: new Set(), people: [{ name: 'Ana Souza' }, { name: 'Rui Matos' }], unlabeledAnswers: true });
  assert.equal(two(line('A ração responde por 70% do custo de produção.')), false);
  const thanks = new Map([['t', { key: 't', speaker: 'Scorsin', text: 'Obrigada pelo convite para falar da nossa marca.' }]]);
  assert.deepEqual(quotableIds(['t'], thanks, () => true), [], 'a thank-you is never a quotation');
});

test('a part whose only line is the interviewer\'s is not asked for a quotation', async () => {
  const unlabeled = new Map<string, QuotableCandidate>([['u1', { key: 'u1', text: 'O produto chega às gôndolas do Sudeste em julho.' }],
    ['u2', { key: 'u2', text: 'Muito obrigado pela entrevista, Ricardo, sucesso na feira.' }]]);
  const identified = quotableSpeaker({ linked: new Set(), people: [{ name: 'Ricardo Lemos' }], unlabeledAnswers: true });
  const plans: unknown[] = [];
  const outline = { title: 'Pescados na feira', introIds: ['u1'], sections: [{ title: 'Despedida', evidenceIds: ['u2'] }] };
  await writeSequentialArticle(outline, variables, { introChars: 300, sections: [{ budgetChars: 400 }] }, async (key, _schema, values) => {
    if (key === 'intro') return { paragraphs: [paragraph('A Pescados Litoral apresentou um produto na feira.', ['u1'])] };
    plans.push(JSON.parse(values.sizing).quotePlan);
    return { title: 'Despedida', paragraphs: [paragraph('A empresa encerrou a conversa no estande.', ['u2'])] };
  }, new Map([...unlabeled].map(([key, candidate]) => [key, candidate.text])), undefined, undefined, [],
  { rule: { minQuotes: 2, openingQuote: true, sectionQuotes: true }, quotable: ids => quotableIds(ids, unlabeled, identified).map(id => unlabeled.get(id)!) });
  assert.deepEqual(plans, [{ required: 0, quotesStillNeeded: 2, availableQuoteIds: [] }], 'one call, nothing to quote');
});

test('the quotation is asked only by prompts that explain it', () => {
  const base = defaultPipelineDefinition('openai/gpt-6-astra');
  assert.deepEqual(explainedRevisionCodes(base), ['SECTION_QUOTE_REQUIRED']);
  for (const format of EDITORIAL_FORMATS) assert.deepEqual(explainedRevisionCodes(formatPipelineDefinition(base, format)), ['SECTION_QUOTE_REQUIRED'], format);
  const revision1 = JSON.parse(readFileSync(new URL('./fixtures/pipeline-revision-1.json', import.meta.url), 'utf8')) as PipelineDefinition;
  assert.deepEqual(explainedRevisionCodes(revision1), [], 'production revision 1 writes as it always did');
});

test('a part whose evidence holds a quotable line is asked once for it, with the lines it may quote', async () => {
  const requests: PipelineVariables[] = [];
  const outline = { title: 'Hecke na APAS', introIds: ['e1'], sections: [{ title: 'Embalagem', evidenceIds: ['e2', 'e3'] }] };
  const result = await writeSequentialArticle(outline, variables, { introChars: 300, sections: [{ budgetChars: 400 }] }, async (key, _schema, values) => {
    if (key === 'intro') return intro;
    requests.push(values);
    return { title: 'Embalagem', paragraphs: [paragraph(requests.length === 1 ? 'A embalagem comunica os benefícios do produto, segundo Scorsin.' : quoted)] };
  }, evidence, undefined, undefined, [], soft({ minQuotes: 1, openingQuote: false, sectionQuotes: true }));
  const first = JSON.parse(requests[0].sizing), revision = JSON.parse(requests[1].sizing);
  assert.deepEqual(first.quotePlan, { required: 1, quotesStillNeeded: 1, availableQuoteIds: ['e2'] });
  assert.equal(revision.revisionFeedback.violation, 'SECTION_QUOTE_REQUIRED');
  assert.deepEqual(revision.revisionFeedback.availableQuotes, [{ id: 'e2', text: candidates.get('e2')!.text, speaker: 'Scorsin' }]);
  assert.equal(requests.length, 2);
  assert.equal(result.sections[0].paragraphs[0].text, quoted);
});

test('a part that never quotes keeps its draft: the request never fails a text', async () => {
  const sections: string[] = [];
  const outline = { title: 'Hecke na APAS', introIds: ['e1'], sections: [{ title: 'Embalagem', evidenceIds: ['e2'] }] };
  const result = await writeSequentialArticle(outline, variables, { introChars: 300, sections: [{ budgetChars: 400 }] }, async (key, _schema, values) => {
    if (key === 'intro') return intro;
    sections.push(JSON.parse(values.sizing).revisionFeedback?.violation ?? 'first');
    return { title: 'Embalagem', paragraphs: [paragraph(`A embalagem comunica os benefícios do produto${sections.length > 1 ? ' e seus nutrientes' : ''}, segundo Scorsin.`)] };
  }, evidence, undefined, undefined, [], soft({ minQuotes: 1, openingQuote: false, sectionQuotes: true }));
  assert.deepEqual(sections, ['first', 'SECTION_QUOTE_REQUIRED'], 'asked once, not twice');
  assert.match(result.sections[0].paragraphs[0].text, /nutrientes/);
});

test('a part asked for a quotation after another revision still gets at most three calls', async () => {
  const violations: string[] = [];
  const grounding = (text: string) => /Frescatto/.test(text) ? ['Frescatto'] : [];
  const outline = { title: 'Hecke na APAS', introIds: ['e1'], sections: [{ title: 'Embalagem', evidenceIds: ['e2'] }] };
  const result = await writeSequentialArticle(outline, variables, { introChars: 300, sections: [{ budgetChars: 400 }] }, async (key, _schema, values) => {
    if (key === 'intro') return intro;
    violations.push(JSON.parse(values.sizing).revisionFeedback?.violation ?? 'first');
    const text = violations.length === 1 ? 'A embalagem segue o padrão da Frescatto.' : violations.length === 2 ? 'A embalagem comunica os benefícios, segundo Scorsin.' : quoted;
    return { title: 'Embalagem', paragraphs: [paragraph(text)] };
  }, evidence, undefined, grounding, ['Giaceli Scorsin'], soft({ minQuotes: 1, openingQuote: false, sectionQuotes: true }));
  assert.deepEqual(violations, ['first', 'UNGROUNDED_FACT', 'SECTION_QUOTE_REQUIRED']);
  assert.equal(result.sections[0].paragraphs[0].text, quoted);
});

test('an opening left without its quotation raises what the next part is asked for', async () => {
  const plans: { required: number; quotesStillNeeded: number }[] = [];
  const outline = { title: 'Hecke na APAS', introIds: ['e1'], sections: [{ title: 'Embalagem e lojas', evidenceIds: ['e2', 'e4'] }] };
  await writeSequentialArticle(outline, variables, { introChars: 300, sections: [{ budgetChars: 500 }] }, async (key, _schema, values) => {
    const plan = JSON.parse(values.sizing).quotePlan;
    if (!JSON.parse(values.sizing).revisionFeedback) plans.push({ required: plan.required, quotesStillNeeded: plan.quotesStillNeeded });
    return key === 'intro' ? intro : { title: 'Embalagem e lojas', paragraphs: [paragraph(quoted)] };
  }, evidence, undefined, undefined, [], soft({ minQuotes: 2, openingQuote: true, sectionQuotes: true }));
  assert.deepEqual(plans, [{ required: 1, quotesStillNeeded: 2 }, { required: 2, quotesStillNeeded: 2 }]);
});

test('the last-resort cut drops sentences without a quotation first and keeps the last one asked for', async () => {
  const outline = { title: 'Hecke na APAS', introIds: ['e1'], sections: [{ title: 'Embalagem', evidenceIds: ['e2'] }] };
  const oversized = { title: 'Embalagem', paragraphs: [paragraph('A embalagem é a principal aposta de comunicação da empresa no varejo.'),
    paragraph(`${quoted} A empresa também estampa receitas no pacote para incentivar o consumo.`)] };
  let calls = 0;
  const result = await writeSequentialArticle(outline, variables, { introChars: intro.paragraphs[0].text.length, sections: [{ budgetChars: 120 }] }, async key => {
    if (key === 'intro') return intro;
    calls++;
    return oversized;
  }, evidence, undefined, undefined, [], soft({ minQuotes: 1, openingQuote: false, sectionQuotes: true }));
  assert.equal(calls, 3);
  assert.deepEqual(result.sections[0].paragraphs, [paragraph(quoted)]);
});
