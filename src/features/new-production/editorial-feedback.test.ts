import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultEditorialPlan } from '../../domain/editorial-plan.ts';
import { parseTranscript } from '../../domain/text/transcript-parse.ts';
import { r1ArticleIssue } from '../../domain/article-policy.ts';
import { createTranscriptSource } from '../../domain/source.ts';
import { EMPTY_DRAFT, draftMaterial, toCreateInputs, toCreateInput } from './form.ts';
import { importedArticle } from './import-reviewed.ts';
import type { SourceAnalysis } from '../../ports/source-ingest.ts';
const text = 'O camarão foi o tema da conversa. A equipe discutiu manejo e custos.';
const parsed = parseTranscript(text);
const analysis = { ...parsed, speakers: [], stats: { words: 15, characters: text.length, readingMinutes: 1, segments: parsed.segments.length, hasTimestamps: false }, preview: [], warnings: [], short: true, hash: 'h' } as SourceAnalysis;
test('one episode yields only selected themes and formats, instead of a fixed number of articles', () => {
  const draft = { ...EMPTY_DRAFT, pasted: text, title: 'Episódio', editorial: defaultEditorialPlan() };
  assert.equal(toCreateInputs(draft, analysis, []).length, 1);
  const inputs = toCreateInputs({ ...draft, separateTopics: true, editorial: { ...draft.editorial, formats: ['evergreen', 'hard-news'], mainTopic: 'Manejo', secondaryTopics: ['Custos'] } }, analysis, []);
  assert.equal(inputs.length, 4);
  assert.deepEqual(inputs.map(i => i.brief.editorial!.mainTopic), ['Manejo', 'Custos', 'Manejo', 'Custos']);
  assert.ok(inputs.every(i => i.material.text === text));
});
test('supplementary sources and manually added participants survive the create command', () => {
  const draft = { ...EMPTY_DRAFT, pasted: text, title: 'Episódio', supplements: [{ name: 'https://example.com/noticia', text: 'Contexto da notícia.', size: 20 }], speakers: { convidado: { kind: 'new' as const, name: 'Amanda', title: 'Repórter', organization: 'Seafood Brasil' } } };
  const input = toCreateInput(draft, analysis, []);
  assert.match(draftMaterial(draft).text, /https:\/\/example.com\/noticia/);
  assert.equal(input.speakers?.[0].newPerson?.name, 'Amanda');
});
test('importing a reviewed draft preserves supplied text and evidence, without approving it', () => {
  let next = 0;
  const source = createTranscriptSource({ workspaceId: 'w', title: 'Fonte', origin: 'podcast', parsed, authorized: true }, { actorId: 'editor', now: '2026-11-16T12:00:00Z', newId: () => `id-${++next}` });
  const body = importedArticle('Artigo revisado', analysis, source.id, defaultEditorialPlan());
  assert.equal(body.blocks.length, parsed.segments.length);
  assert.equal(r1ArticleIssue(body, [source], { maxChars: defaultEditorialPlan().maxChars }), undefined);
  assert.ok(body.blocks.every(b => !b.ai));
  assert.equal('approved' in body, false);
});

test('separate fair topics keep the selected legacy format and current character contract', async () => {
  const { articleContractFor } = await import('../../domain/formats.ts');
  const draft = { ...EMPTY_DRAFT, pasted: text, title: 'Dois eventos', separateTopics: true,
    editorial: { ...defaultEditorialPlan(), category: 'fair' as const, formats: ['booth', 'panel'] as ('booth' | 'panel')[], eventName: 'Fenacam 2026', mainTopic: 'Evento A', secondaryTopics: ['Evento B'], maxChars: 12000 } };
  const inputs = toCreateInputs(draft, analysis, []);
  assert.equal(inputs.length, 4);
  assert.deepEqual(inputs.map(input => input.brief.format), ['stand', 'stand', 'panel', 'panel']);
  assert.ok(inputs.every(input => input.brief.event?.name === 'Fenacam 2026'));
  assert.ok(inputs.every(input => articleContractFor(input.brief).maxChars === 12000));
});
