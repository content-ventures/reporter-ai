import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PipelineVariables } from '../src/domain/pipeline.ts';
import { writeSequentialArticle } from '../src/server/pipeline-runner.ts';
import { ungroundedTerms } from '../src/domain/grounding.ts';
import { outlineResponseSchema } from '../src/server/editorial-validation.ts';
import { validPipelineOutput } from '../src/server/pipeline-output.ts';
import { parsePipelineDefinition } from '../src/server/pipeline.ts';
import { compactFunnels, defaultPipelineDefinition, withFormatFunnels } from '../src/domain/pipeline.ts';

process.env.REPORTER_LOCAL_MODE = 'true';
process.env.GROQ_API_KEY = 'test-placeholder-not-a-real-key';

const corpus = 'Giaceli Scorsin: A Hecke Alimentos tem 25 anos de trajetória e lança a merluza empanada com ervas finas na APAS Show 2026. O produto vem congelado da Patagônia.';
const grounding = (text: string) => ungroundedTerms(text, corpus);
const variables: PipelineVariables = { source: '[e1] fonte', brief: '{}', sizing: '{}', outline: '{}', section: '', history: '', futureSections: '', layouts: '', approvedArticle: '', event: '{}', people: '[]' };
const outline = { title: 'Hecke na APAS', sections: [{ title: 'Novidade no estande', evidenceIds: ['e1'] }] };
const sizing = { introChars: 400, sections: [{ budgetChars: 400 }] };
const intro = { paragraphs: [{ text: 'A gerente de marketing da Hecke Alimentos, Giaceli Scorsin, apresentou a merluza empanada na APAS Show 2026.', evidenceIds: ['e1'] }] };

test('an event-format part with an invented number or name is revised with the measured terms', async () => {
  const requests: PipelineVariables[] = [];
  const result = await writeSequentialArticle(outline, variables, sizing, async (key, _schema, values) => {
    if (key === 'intro') return intro;
    requests.push(values);
    return requests.length === 1
      ? { title: 'Novidade no estande', paragraphs: [{ text: 'A empresa cresceu 45% com a Frescatto.', evidenceIds: ['e1'] }] }
      : { title: 'Novidade no estande', paragraphs: [{ text: 'O produto vem congelado da Patagônia.', evidenceIds: ['e1'] }] };
  }, undefined, undefined, grounding, ['Giaceli Scorsin']);
  const feedback = JSON.parse(requests[1].sizing).revisionFeedback;
  assert.equal(feedback.violation, 'UNGROUNDED_FACT');
  assert.deepEqual(feedback.ungroundedTerms, ['45', 'Frescatto']);
  assert.equal(result.sections[0].paragraphs[0].text, 'O produto vem congelado da Patagônia.');
});

test('a provider that keeps inventing loses only the invented sentences, never gains a fact', async () => {
  const result = await writeSequentialArticle(outline, variables, sizing, async key => key === 'intro' ? intro
    : { title: 'Novidade no estande', paragraphs: [{ text: 'O produto vem congelado da Patagônia. A empresa faturou R$ 3 milhões.', evidenceIds: ['e1'] }] },
  undefined, undefined, grounding, ['Giaceli Scorsin']);
  assert.equal(result.sections[0].paragraphs[0].text, 'O produto vem congelado da Patagônia.');
});

test('a part that repeats a quotation, a fact or an introduction goes back with what was repeated', async () => {
  const quoted = { paragraphs: [{ text: 'A merluza empanada estreou na APAS Show 2026. “O produto vem congelado da Patagônia”, explicou Scorsin.', evidenceIds: ['e1'] }] };
  const violations: string[] = [];
  const result = await writeSequentialArticle(outline, variables, sizing, async (key, _schema, values) => {
    if (key === 'intro') return { paragraphs: [...intro.paragraphs, ...quoted.paragraphs] };
    const feedback = JSON.parse(values.sizing).revisionFeedback;
    if (feedback) violations.push(feedback.violation);
    if (violations.length === 0) return { title: 'Novidade no estande', paragraphs: [{ text: '“O produto vem congelado da Patagônia”, disse Scorsin.', evidenceIds: ['e1'] }] };
    if (violations.length === 1) return { title: 'Novidade no estande', paragraphs: [{ text: 'A gerente de marketing da Hecke Alimentos, Giaceli Scorsin, apresentou a merluza empanada na APAS Show 2026 ao público.', evidenceIds: ['e1'] }] };
    return { title: 'Novidade no estande', paragraphs: [{ text: 'A linha leva ervas finas, segundo Scorsin.', evidenceIds: ['e1'] }] };
  }, undefined, undefined, grounding, ['Giaceli Scorsin']);
  assert.deepEqual(violations, ['REPEATED_QUOTE', 'REPEATED_FACT']);
  assert.equal(result.sections[0].paragraphs[0].text, 'A linha leva ervas finas, segundo Scorsin.');
});

test('the article flow is unchanged: no grounding, no repetition checks without a format', async () => {
  let calls = 0;
  const result = await writeSequentialArticle(outline, variables, sizing, async key => {
    if (key === 'intro') return intro;
    calls++;
    return { title: 'Novidade no estande', paragraphs: [{ text: 'A empresa cresceu 45% com a Frescatto.', evidenceIds: ['e1'] }] };
  });
  assert.equal(calls, 1);
  assert.equal(result.sections[0].paragraphs[0].text, 'A empresa cresceu 45% com a Frescatto.');
});

test('the outline of an event format carries the linha fina; the article outline does not', () => {
  const withDek = outlineResponseSchema(1, ['e1'], true) as { properties: Record<string, { maxLength?: number }>; required: string[] };
  assert.ok(withDek.required.includes('dek'));
  assert.equal(withDek.properties.dek.maxLength, 180);
  assert.ok(!(outlineResponseSchema(1, ['e1']) as { required: string[] }).required.includes('dek'));
  const value = { title: 'Hecke na APAS', dek: 'Importadora estreia no pescado com merluza empanada', introIds: ['e1'], sections: [{ title: 'Novidade', evidenceIds: ['e1'] }] };
  assert.ok(validPipelineOutput('outline', value, withDek));
});

test('a saved definition with edited funnels passes the server contract', () => {
  const definition = withFormatFunnels(defaultPipelineDefinition());
  definition.funnels.stand.intro.prompt += '\nAbra sempre pela empresa.';
  assert.deepEqual(parsePipelineDefinition(definition).definition?.funnels?.stand?.intro?.prompt, definition.funnels.stand.intro.prompt);
  assert.ok(parsePipelineDefinition(compactFunnels(definition)).definition);
  assert.ok(parsePipelineDefinition(defaultPipelineDefinition()).definition);
});
