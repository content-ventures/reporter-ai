import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleLengthIssue, articleQuotationIssue, literalQuoteText, R1_ARTICLE_LIMITS, r1ArticleIssue } from './article-policy.ts';
import { articleStats, headingBlock, listBlock, paragraphBlock } from './article.ts';
import { createKit, sampleSource } from './testing/scenario.ts';

test('R1 boundaries are inclusive and character and word limits apply simultaneously', () => {
  const issue = (characters: number, words: number) => articleLengthIssue({ characters, words }, R1_ARTICLE_LIMITS);
  assert.equal(issue(2499, 500), 'ARTICLE_SIZE_TOO_SHORT');
  assert.equal(issue(2500, 500), undefined);
  assert.equal(issue(4000, 800), undefined);
  assert.equal(issue(4001, 700), 'ARTICLE_SIZE_EXCEEDED');
  assert.equal(issue(3500, 499), 'ARTICLE_WORDS_TOO_FEW');
  assert.equal(issue(3500, 801), 'ARTICLE_WORDS_EXCEEDED');
});

test('mandatory quotations are distinct, substantive, literal and tied to the SAME paragraph evidence', () => {
  const a = 'A fonte confirma o fato.';
  const b = 'O episódio apresenta mais dados.';
  const evidence = new Map([['a', a], ['b', b]]);
  const quote = (text: string, evidenceIds = ['a']) => ({ text: `A fonte diz: “${text}”`, evidenceIds });
  assert.equal(articleQuotationIssue([quote(a), quote(b, ['b'])], evidence, 2), undefined);
  assert.equal(articleQuotationIssue([quote(a), quote(a)], evidence, 2), 'ARTICLE_QUOTES_REQUIRED');
  assert.equal(articleQuotationIssue([quote(a.replace('confirma', 'nega'))], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([quote(a, ['b'])], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([quote(a, ['missing'])], evidence), 'UNKNOWN_EVIDENCE');
  assert.equal(articleQuotationIssue([{ text: '“Uma fala sem fechar.', evidenceIds: ['a'] }], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(articleQuotationIssue([quote('A fonte'), quote('O episódio', ['b'])], evidence, 2), 'ARTICLE_QUOTES_REQUIRED');
  assert.equal(articleQuotationIssue([quote('A fonte (...) o fato.')], evidence), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(literalQuoteText('Ola\u0301\n mundo'), 'Olá mundo');
  assert.equal(articleQuotationIssue([quote('A fonte CONFIRMA o fato.')], evidence), 'UNSUPPORTED_ARTICLE_QUOTE', 'case and words are not silently rewritten');
});

test('edited drafts cannot bypass R1 by inflating the title or removing quote provenance', () => {
  const source = sampleSource(createKit());
  const sentences = source.versions[0].content.segments.slice(0, 2);
  const body = { type: 'article' as const, title: 'Título '.repeat(100), blocks: [paragraphBlock('p', 'Breve.')] };
  assert.equal(articleStats(body).characters, 6);
  assert.equal(r1ArticleIssue(body, [source]), 'ARTICLE_SIZE_TOO_SHORT');
  const filler = Array(510).fill('fato').join(' ') + '.';
  const supported = { type: 'article' as const, title: 'Não conta', blocks: [paragraphBlock('p', filler), ...sentences.map((segment, i) =>
    paragraphBlock('q' + i, `No episódio: “${segment.text}”`, { sourceRefs: [{ kind: 'source' as const, sourceId: source.id,
      sourceVersion: 1, locator: { type: 'segment' as const, segmentId: segment.id } }] }))] };
  assert.equal(r1ArticleIssue(supported, [source]), undefined);
  for (const extra of [headingBlock('bad-heading', '“Uma fala que não está na fonte.”', 2), listBlock('bad-list', ['“Uma fala que não está na fonte.”'])]) {
    assert.equal(r1ArticleIssue({ ...supported, blocks: [...supported.blocks, extra] }, [source]), 'UNSUPPORTED_ARTICLE_QUOTE', 'headings and lists cannot hide invented quotations');
  }
  assert.equal(r1ArticleIssue({ ...supported, blocks: supported.blocks.map(block => ({ ...block, sourceRefs: [] })) }, [source]), 'UNSUPPORTED_ARTICLE_QUOTE');
});
