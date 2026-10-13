import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planArticleImages } from '../src/server/editorial-images.ts';
import type { ArticleBody } from '../src/domain/article.ts';
import { articleCharacters } from '../src/domain/article.ts';
import { segmentRef } from '../src/domain/refs.ts';
import { mapEditorialPassages } from '../src/server/editorial-passages.ts';

const ref = segmentRef('source',1,'segment');
const body: ArticleBody = { type: 'article',title: 'Test',blocks: [
  { id: 'p1',type: 'paragraph',inlines: [{ text: 'Uma biblioteca fictícia oferece leitura.' }],sourceRefs: [ref],ai: 'unreviewed' },
  { id: 'h1',type: 'heading',level: 2,inlines: [{ text: 'Leitura' }] },
  { id: 'p2',type: 'paragraph',inlines: [{ text: 'Oficinas de leitura são discutidas na simulação.' }],sourceRefs: [ref],ai: 'unreviewed' },
] };
const suggestion = { subject: 'Ilustração de livros em uma biblioteca',suggestedCaption: 'Sugestão ilustrativa para a simulação.',suggestedAlt: 'Livros ilustrados',orientation: 'landscape',sourceBlockIds: ['p1'] };
test('grounded image slots preserve text, evidence and review state without pretending to have photos', () => {
  const output = planArticleImages(body,{ cover: suggestion,figures: [{ ...suggestion,afterBlockId: 'p1' }] });
  assert.equal(output.coverSlot?.subject,suggestion.subject);
  assert.equal(output.blocks.length,4);
  assert.equal(output.blocks[1].type,'figure');
  assert.deepEqual(output.blocks[1].sourceRefs,[ref]);
  assert.equal('image' in output.blocks[1],false);
  assert.equal(articleCharacters({ ...body,...output }),articleCharacters(body));
  assert.deepEqual(body.blocks.map(block => block.id),['p1','h1','p2']);
  assert.equal(output.blocks[0].ai,'unreviewed');
});
test('unknown evidence, heading-only evidence, duplicate placement and fabricated URLs are refused', () => {
  for (const id of ['missing','h1']) assert.throws(() => planArticleImages(body,{ cover: { ...suggestion,sourceBlockIds: [id] },figures: [] }),/INVALID_IMAGE_EVIDENCE/);
  assert.throws(() => planArticleImages(body,{ cover: null,figures: [{ ...suggestion,afterBlockId: 'missing' }] }),/INVALID_IMAGE_EVIDENCE/);
  assert.throws(() => planArticleImages(body,{ cover: null,figures: Array(2).fill({ ...suggestion,afterBlockId: 'p1' }) }),/INVALID_IMAGE_EVIDENCE/);
  assert.throws(() => planArticleImages(body,{ cover: { ...suggestion,url: 'https://example.com/fake.jpg' },figures: [] }));
  assert.deepEqual(planArticleImages(body,{ cover: null,figures: [] }),{ blocks: body.blocks });
});
test('independent passages run two at a time and remain in source order', async () => {
  let active = 0,maximum = 0;
  const output = await mapEditorialPassages(['a','b','c','d','e'],async (passage,index) => {
    maximum = Math.max(maximum,++active);
    await new Promise(resolve => setTimeout(resolve,index%2 ? 1 : 8));
    active--; return passage.toUpperCase();
  });
  assert.equal(maximum,2);
  assert.equal(active,0);
  assert.deepEqual(output,['A','B','C','D','E']);
});
test('failed batches drain active requests and never start later passages', async () => {
  const started: number[] = [],ended: number[] = [];
  await assert.rejects(mapEditorialPassages(['a','b','c'],async (_passage,index) => {
    started.push(index);
    if (!index) throw new Error('fixture failure');
    await new Promise(resolve => setTimeout(resolve,5)); ended.push(index); return index;
  }),/fixture failure/);
  assert.deepEqual(started,[0,1]);
  assert.deepEqual(ended,[1]);
});
