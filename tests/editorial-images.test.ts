import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imagePlanningBody, planArticleImages } from '../src/server/editorial-images.ts';
import type { ArticleBody } from '../src/domain/article.ts';
import { articleCharacters } from '../src/domain/article.ts';
import { segmentRef } from '../src/domain/refs.ts';
import { mapEditorialPassages } from '../src/server/editorial-passages.ts';
import { memoryWritingFixture } from '../src/domain/testing/editorial-memory.ts';
import { paragraphBlock } from '../src/domain/article.ts';
import { memoryArticleContentIssues } from '../src/domain/editorial-memory-article.ts';

const ref = segmentRef('source',1,'segment');
const body: ArticleBody = { type: 'article',title: 'Test',blocks: [
  { id: 'p1',type: 'paragraph',inlines: [{ text: 'Uma biblioteca fictícia oferece leitura.' }],sourceRefs: [ref],ai: 'unreviewed' },
  { id: 'h1',type: 'heading',level: 2,inlines: [{ text: 'Leitura' }] },
  { id: 'p2',type: 'paragraph',inlines: [{ text: 'Oficinas de leitura são discutidas na simulação.' }],sourceRefs: [ref],ai: 'unreviewed' },
] };
const suggestion = { subject: 'Ilustração de livros em uma biblioteca',suggestedCaption: 'Sugestão ilustrativa para a simulação.',suggestedAlt: 'Livros ilustrados',orientation: 'landscape',sourceBlockIds: ['p1'] };
test('grounded image slots preserve text, evidence and review state without pretending to have photos', () => {
  const output = planArticleImages(body,{ cover: suggestion,figures: [{ ...suggestion,afterBlockId: 'p1' }] },[]);
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
  for (const id of ['missing','h1']) assert.throws(() => planArticleImages(body,{ cover: { ...suggestion,sourceBlockIds: [id] },figures: [] },[]),/INVALID_IMAGE_EVIDENCE/);
  assert.throws(() => planArticleImages(body,{ cover: null,figures: [{ ...suggestion,afterBlockId: 'missing' }] },[]),/INVALID_IMAGE_EVIDENCE/);
  assert.throws(() => planArticleImages(body,{ cover: null,figures: Array(2).fill({ ...suggestion,afterBlockId: 'p1' }) },[]),/INVALID_IMAGE_EVIDENCE/);
  assert.throws(() => planArticleImages(body,{ cover: { ...suggestion,url: 'https://example.com/fake.jpg' },figures: [] },[]));
  assert.deepEqual(planArticleImages(body,{ cover: null,figures: [] },[]),{ blocks: body.blocks });
});
test('bank citations and statistics remain textual receipts and cannot authorize a generated portrait or scene', () => {
  let n = 0;
  const ctx = { now: '2026-10-29T05:00:00Z', actorId: 'actor', newId: (prefix: string) => `${prefix}-${++n}` };
  for (const kind of ['citation', 'statistic'] as const) {
    const literal = kind === 'citation' ? 'O retrato da diretora seria apenas uma hipótese sintética.' : 'Foram atendidas cerca de 240 pessoas em 2025.';
    const f = memoryWritingFixture(kind, literal, ctx), source = f.source, ref = segmentRef(source.id, 1, 'memory-item-1', { from: 0, to: literal.length });
    const bank: ArticleBody = { type: 'article', title: 'BANK TITLE SENTINEL', dek: 'BANK DEK SENTINEL', blocks: [paragraphBlock('bank', literal, { sourceRefs: [ref] })] };
    const original = structuredClone(bank), planning = imagePlanningBody(bank, [source.id]);
    assert.equal(planning.blocks.length, 0); assert.equal(planning.title, ''); assert.equal(planning.dek, undefined);
    assert.equal(JSON.stringify(planning).includes(literal), false); assert.deepEqual(bank, original);
    assert.throws(() => planArticleImages(bank, { cover: { ...suggestion, sourceBlockIds: ['bank'] }, figures: [] }, [source.id]), /INVALID_IMAGE_EVIDENCE/);
    assert.throws(() => planArticleImages(bank, { cover: null, figures: [{ ...suggestion, sourceBlockIds: ['bank'], afterBlockId: 'bank' }] }, [source.id]), /INVALID_IMAGE_EVIDENCE/);
  }
});
test('mixed articles retain bank text and proof while visual suggestions use only ordinary evidence', () => {
  const literal = 'Foram atendidas cerca de 240 pessoas em 2025.';
  const f = memoryWritingFixture('statistic', literal, { now: '2026-10-29T05:00:00Z', actorId: 'actor', newId: prefix => prefix });
  const bankRef = segmentRef(f.source.id, 1, 'memory-item-1', { from: 0, to: literal.length });
  const mixed: ArticleBody = { ...body, blocks: [paragraphBlock('bank', literal, { sourceRefs: [bankRef] }), ...body.blocks] }, original = structuredClone(mixed);
  const planning = imagePlanningBody(mixed, [f.source.id]); assert.ok(!planning.blocks.some(block => block.id === 'bank'));
  const output = planArticleImages(mixed, { cover: null, figures: [{ ...suggestion, afterBlockId: 'bank' }] }, [f.source.id]);
  assert.deepEqual(output.blocks[0], mixed.blocks[0]); assert.deepEqual(output.blocks[1].sourceRefs, [ref]);
  assert.deepEqual(memoryArticleContentIssues({ ...mixed, ...output }, [f.source]), []); assert.deepEqual(mixed, original);
  const combined = { ...mixed, blocks: [paragraphBlock('mixed', literal, { sourceRefs: [ref, bankRef] })] };
  assert.equal(imagePlanningBody(combined, [f.source.id]).blocks.length, 0);
  assert.throws(() => planArticleImages(combined, { cover: { ...suggestion, sourceBlockIds: ['mixed'] }, figures: [] }, [f.source.id]), /INVALID_IMAGE_EVIDENCE/);
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
