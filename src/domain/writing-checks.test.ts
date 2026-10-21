import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArticleBody } from './article.ts';
import { segmentRef } from './refs.ts';
import { currentSourceVersion } from './source.ts';
import { createKit, sampleSource } from './testing/scenario.ts';
import { writingArticleChecks } from './writing-checks.ts';

const body = (text: string): ArticleBody => ({ type: 'article', title: 'Título', blocks: [{ id: 'p1', type: 'paragraph', inlines: [{ text }] }] });

test('all length and quotation failures reach the same review without changing article text', () => {
  const article = body('Um fato curto.');
  const before = structuredClone(article);
  assert.deepEqual(writingArticleChecks(article, [], {}).map(issue => issue.code), ['ARTICLE_SIZE_TOO_SHORT', 'ARTICLE_WORDS_TOO_FEW', 'ARTICLE_QUOTES_REQUIRED']);
  assert.deepEqual(article, before);
  assert.deepEqual(writingArticleChecks(body('palavra '.repeat(900)), [], {}).map(issue => issue.code), ['ARTICLE_SIZE_EXCEEDED', 'ARTICLE_WORDS_EXCEEDED', 'ARTICLE_QUOTES_REQUIRED']);
});

test('event formats preserve their ceiling and quote contract without enforcing an advisory minimum', () => {
  assert.deepEqual(writingArticleChecks(body('Um fato curto.'), [], { format: 'note' }), []);
  assert.deepEqual(writingArticleChecks(body('Um fato curto.'), [], { format: 'stand' }).map(issue => issue.code), ['ARTICLE_QUOTES_REQUIRED']);
  const source = sampleSource(createKit());
  currentSourceVersion(source).content.segments = [{ id: 'literal', text: 'A empresa apresentou novos produtos. O lançamento tem distribuição regional.' }];
  const article = body('A empresa afirma: “A empresa apresentou novos produtos.” A fonte acrescenta: “O lançamento tem distribuição regional.”');
  article.blocks[0].sourceRefs = [segmentRef(source.id, 1, 'literal')];
  assert.deepEqual(writingArticleChecks(article, [source], { format: 'stand' }), []);
});

test('event grounding checks headline, dek and body against original and confirmed data', () => {
  const source = sampleSource(createKit());
  const article = body('A companhia anunciou 99 unidades.'); article.title = 'Empresa chega a Lisboa'; article.dek = 'O projeto será conduzido por Marina';
  const failures = writingArticleChecks(article, [source], { format: 'note' });
  assert.equal(failures.length, 1); assert.equal(failures[0].code, 'UNGROUNDED_FACT');
  assert.ok(failures[0].message.includes('99')); assert.ok(failures[0].message.includes('Lisboa'));
  assert.deepEqual(writingArticleChecks(article, [source], { format: 'note' }, ['Lisboa', 'Marina', '99 unidades']), []);
});

test('source recording dates ground their date components without borrowing upload timestamps', () => {
  const source = sampleSource(createKit('2026-10-21T12:00:00Z'));
  currentSourceVersion(source).content.segments = [{ id: 'original', text: 'A empresa anunciou distribuição regional.' }];
  const article = body('Em entrevista em 20 de maio de 2026, a empresa anunciou distribuição regional.');
  assert.ok(writingArticleChecks(article, [source], { format: 'note' }).some(issue => issue.code === 'UNGROUNDED_FACT'),
    'the source upload date does not confirm an interview date or year');
  source.recordedOn = '2026-05-20';
  assert.deepEqual(writingArticleChecks(article, [source], { format: 'note' }), []);
  assert.deepEqual(writingArticleChecks(body('A entrevista ocorreu em 20/05/2026.'), [source], { format: 'note' }), []);
  const wrongDay = writingArticleChecks(body('A entrevista ocorreu em 21 de maio de 2026.'), [source], { format: 'note' });
  assert.ok(wrongDay.some(issue => issue.code === 'UNGROUNDED_FACT' && issue.message.includes('21')));
});

test('zero quote minimum relaxes quantity alone and a configured minimum has a consistent error', () => {
  const article = body('Um fato curto.');
  assert.deepEqual(writingArticleChecks(article, [], {}, [], { minimumQuotes: 0 }).map(issue => issue.code),
    ['ARTICLE_SIZE_TOO_SHORT', 'ARTICLE_WORDS_TOO_FEW']);
  assert.deepEqual(writingArticleChecks(article, [], { format: 'stand' }, [], { minimumQuotes: 0 }), []);
  const mandatory = writingArticleChecks(article, [], { format: 'note' }, [], { minimumQuotes: 2 });
  assert.equal(mandatory[0].code, 'ARTICLE_QUOTES_REQUIRED');
  assert.match(mandatory[0].message, /pelo menos 2 citações/);
  const source = sampleSource(createKit());
  const fake = body('A empresa afirma: “Uma fala inventada que não aparece na fonte.”');
  fake.blocks[0].sourceRefs = [segmentRef(source.id, 1, currentSourceVersion(source).content.segments[0].id)];
  assert.ok(writingArticleChecks(fake, [source], { format: 'note' }, [], { minimumQuotes: 0 }).some(issue => issue.code === 'UNSUPPORTED_ARTICLE_QUOTE'));
});
