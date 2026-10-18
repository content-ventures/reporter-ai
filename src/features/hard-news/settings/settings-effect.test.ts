import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EditorialMap, NewsItem, WritingGuide } from '../../../domain/hard-news.ts';
import { applyGuide, bannedPhrases, guideChanges, limitIn, openingChecks, SAMPLE_DRAFT, termWord, wordDiff } from './guide-effect.ts';
import { changed, exclusionRows, mapChanges, mapCounts, mapRows, ruleEffect, topicRows } from './map-effect.ts';

const MAP: EditorialMap = {
  version: 4, updatedAt: '', updatedBy: 'Pedro', audience: 'Cadeia do pescado', regions: ['Brasil'],
  topics: [
    { id: 'exports', label: 'Exportação e mercado', weight: 'core' },
    { id: 'fishing', label: 'Pesca', weight: 'regular' },
    { id: 'events', label: 'Eventos', weight: 'occasional' },
  ],
  exclusions: ['Receitas'], trusted: ['Observatório'], blocked: [],
};

function news(id: string, score: number, topic: string, patch: Partial<NewsItem> = {}): NewsItem {
  return {
    id, title: `Notícia ${id}`, url: '', source: 'Agência', via: 'rss', publishedAt: '', importedAt: '', excerpt: '', body: [],
    duplicates: [], status: 'new', classification: { score, topic, summary: '', reasons: [], mapVersion: 4 }, ...patch,
  };
}

const NEWS = [
  news('a', 72, 'Pesca'),
  news('b', 66, 'Pesca'),
  news('c', 40, 'Eventos', { title: 'Festival de receitas' }),
  news('d', 91, 'Exportação e mercado'),
  news('x', 80, 'Pesca', { status: 'covered' }),
];

test('a heavier topic moves its waiting stories up, and the counts follow', () => {
  const draft = { ...MAP, topics: MAP.topics.map((topic) => (topic.id === 'fishing' ? { ...topic, weight: 'core' as const } : topic)) };
  const rows = mapRows(NEWS, MAP, draft);
  assert.equal(rows.length, 4);
  const fishing = topicRows(rows, 'Pesca');
  assert.deepEqual(fishing.map((row) => [row.before, row.after]), [[72, 82], [66, 76]]);
  assert.equal(ruleEffect(fishing).line, '2 na fila · 2 mudam de prioridade');
  assert.deepEqual(mapCounts(rows, 'before'), { high: 1, medium: 2, low: 0, out: 1 });
  assert.deepEqual(mapCounts(rows, 'after'), { high: 3, medium: 0, low: 0, out: 1 });
  assert.deepEqual(mapChanges(MAP, draft), ['Pesca: Cobre → Principal']);
});

test('an exclusion takes its stories off the map', () => {
  const rows = mapRows(NEWS, MAP, { ...MAP, exclusions: [] });
  const caught = exclusionRows(rows, MAP, 'Receitas');
  assert.deepEqual(caught.map((row) => row.item.id), ['c']);
  assert.equal(rows.find((row) => row.item.id === 'c')?.outAfter, false);
  assert.ok(changed(rows.find((row) => row.item.id === 'c')!));
  assert.deepEqual(mapChanges(MAP, { ...MAP, exclusions: [] }), ['Volta ao mapa: Receitas']);
});

const GUIDE: Pick<WritingGuide, 'terms' | 'rules'> = {
  terms: [
    { avoid: 'pescados', use: 'pescado (coletivo)' },
    { avoid: 'piscicultura de tilápias', use: 'tilapicultura' },
    { avoid: 'alavancar', use: 'aumentar' },
    { avoid: 'players', use: 'empresas' },
  ],
  rules: [{ id: 'r1', text: 'Números até dez por extenso.' }, { id: 'r5', text: 'Nada de "vale lembrar", "é importante destacar" ou "confira".' }],
};

test('the guide rewrites the sample: terms swapped, banned phrases gone', () => {
  const { after, changes } = applyGuide(SAMPLE_DRAFT, GUIDE);
  assert.equal(after, 'O setor de pescado ganha espaço lá fora. A tilapicultura deve aumentar as vendas em 2027, e empresas do Paraná já se preparam. As exportações cresceram 38% no terceiro trimestre, segundo o Painel de Comércio Exterior.');
  assert.deepEqual(changes.map((change) => change.from), ['pescados', 'piscicultura de tilápias', 'alavancar', 'players', 'vale lembrar', 'é importante destacar', 'confira']);
  assert.equal(changes.find((change) => change.from === 'confira')?.rule, 'Regra 2');
});

test('only banning rules ban, on whole words; exclusions match whole words', () => {
  const guide = { terms: [], rules: [{ id: 'a', text: 'Use "segundo" para atribuir.' }, { id: 'b', text: 'Evite "confira".' }] };
  assert.deepEqual(bannedPhrases(guide).map((entry) => entry.phrase), ['confira']);
  assert.equal(applyGuide('Os dados conferem. Confira os números.', guide).after, 'Os dados conferem.');
  assert.equal(applyGuide('Confiram os números da safra de 2026.', guide).after, 'Confiram os números da safra de 2026.');
  const rows = mapRows([news('f', 60, 'Pesca', { title: 'Ferreira assume cooperativa' })], MAP, { ...MAP, exclusions: ['Feiras'] });
  assert.equal(rows[0].outAfter, false);
  const fair = mapRows([news('g', 60, 'Pesca', { title: 'Feira de pescado em Itajaí' })], MAP, { ...MAP, exclusions: ['Feiras'] });
  assert.equal(fair[0].outAfter, true);
});

test('a corrected story keeps the priority a person gave it', () => {
  const corrected = news('h', 72, 'Pesca', { classification: { score: 72, topic: 'Pesca', summary: '', reasons: [], mapVersion: 4, correction: { priority: 'low', by: 'João', at: '' } } });
  const rows = mapRows([corrected], MAP, { ...MAP, topics: MAP.topics.map((topic) => (topic.id === 'fishing' ? { ...topic, weight: 'core' as const } : topic)) });
  assert.equal(rows[0].priorityAfter, 'low');
  assert.equal(changed(rows[0]), false);
});

test('helpers: term word, banned phrases, limits, diff, checks, history', () => {
  assert.equal(termWord('pescado (coletivo)'), 'pescado');
  assert.deepEqual(bannedPhrases(GUIDE).map((entry) => entry.phrase), ['vale lembrar', 'é importante destacar', 'confira']);
  assert.equal(limitIn('Verbo no presente. Até 90 caracteres.', 'caracteres'), 90);
  assert.deepEqual(wordDiff('a b c', 'a x c'), [{ kind: 'equal', text: 'a ' }, { kind: 'delete', text: 'b' }, { kind: 'insert', text: 'x' }, { kind: 'equal', text: ' c' }]);
  assert.ok(openingChecks({ headline: 'Até 90 caracteres.', lead: 'Até 40 palavras.', attribution: 'Use "segundo" ou "de acordo com".' }).every((check) => check.ok));
  assert.equal(openingChecks({ headline: '', lead: '', attribution: 'Use "conforme".' })[2].ok, false);
  assert.equal(openingChecks({ headline: 'Até 20 caracteres.', lead: '', attribution: '' })[0].ok, false);
  const saved = { version: 3, updatedAt: '', updatedBy: '', voice: 'Direto', headline: '', lead: '', attribution: '', examples: [], ...GUIDE } as WritingGuide;
  assert.deepEqual(guideChanges(saved, { ...saved, voice: 'Direto e curto', terms: [...saved.terms, { avoid: 'impactar', use: 'afetar' }] }), ['Voz revisto', 'Novo termo: impactar → afetar']);
});
