import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writingArticleBody } from './writing-article.ts';
import type { WritingArticle } from './writing-orchestration.ts';
import type { SourceRef } from './refs.ts';
import { contentHash } from './text/hash.ts';

const reference: SourceRef = { kind: 'source', sourceId: 'content', sourceVersion: 1, locator: { type: 'segment', segmentId: 's1' } };
const article: WritingArticle = {
  title: 'Título sustentado', dek: 'Linha fina com contexto.', titleEvidenceIds: ['e1'], dekEvidenceIds: ['e1'],
  blocks: [
    { id: 'p1', type: 'paragraph', level: 2, text: 'O primeiro fato da fonte.', items: [], evidenceIds: ['e1'] },
    { id: 'h1', type: 'heading', level: 2, text: 'Detalhes', items: [], evidenceIds: ['e1'] },
    { id: 'q1', type: 'quote', level: 2, text: 'A fala mantém exatamente suas palavras.', items: [], evidenceIds: ['e1'] },
    { id: 'l1', type: 'list', level: 2, text: '', items: ['Primeiro item.', 'Segundo item.'], evidenceIds: ['e1'] },
  ],
};

test('a reviewed whole article keeps semantic blocks, literal text, dek and evidence in the editable draft', () => {
  const body = writingArticleBody(article, 'run-1', ids => ids.map(id => { assert.equal(id, 'e1'); return reference; }));
  assert.equal(body.dek, article.dek);
  assert.deepEqual(body.blocks.map(block => block.type), ['paragraph', 'heading', 'quote', 'list']);
  assert.deepEqual(body.blocks.map(block => block.id), article.blocks.map(block => `writing-${contentHash({ runId: 'run-1', blockId: block.id })}`));
  for (const block of body.blocks) {
    assert.equal(block.ai, 'unreviewed', 'model review never substitutes human approval');
    assert.deepEqual(block.sourceRefs, [reference]);
  }
  assert.deepEqual(body.blocks[2], { id: body.blocks[2].id, type: 'quote', inlines: [{ text: article.blocks[2].text }], sourceRefs: [reference], ai: 'unreviewed' });
  assert.deepEqual(body.blocks[3], { id: body.blocks[3].id, type: 'list', ordered: false, items: [[{ text: 'Primeiro item.' }], [{ text: 'Segundo item.' }]], sourceRefs: [reference], ai: 'unreviewed' });
});

test('generated block identifiers stay bounded and stable for later editing', () => {
  const long = structuredClone(article);
  long.blocks[0].id = 'x'.repeat(128);
  const first = writingArticleBody(long, 'r'.repeat(128), () => [reference]);
  const second = writingArticleBody(long, 'r'.repeat(128), () => [reference]);
  assert.deepEqual(first.blocks.map(block => block.id), second.blocks.map(block => block.id));
  assert.ok(first.blocks.every(block => block.id.length <= 128));
  assert.equal(new Set(first.blocks.map(block => block.id)).size, long.blocks.length);
});

test('an unavailable evidence locator prevents conversion instead of losing its reference', () => {
  assert.throws(() => writingArticleBody(article, 'run-1', () => { throw new Error('UNKNOWN_EVIDENCE'); }), /UNKNOWN_EVIDENCE/);
});
