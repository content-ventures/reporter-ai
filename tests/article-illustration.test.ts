import assert from 'node:assert/strict';
import { test } from 'node:test';
import { illustrateArticle,editorialImageQuery } from '../src/server/article-illustration.ts';
import { editorialResponseValid,outlineResponseSchema } from '../src/server/editorial-validation.ts';
import { articlePlainText } from '../src/domain/article.ts';
import type { ArticleBody } from '../src/domain/article.ts';
import type { StockImage } from '../src/domain/visual-library.ts';
const body: ArticleBody = { type: 'article',title: 'Teste sintético',coverSlot: { subject: 'Pescado em uma peixaria' },blocks: [
  { id: 'paragraph',type: 'paragraph',inlines: [{ text: 'Texto fictício permanece exatamente o mesmo.' }] },
  { id: 'figure',type: 'figure',slot: { subject: 'Peixes no mercado' } },
] };
const photo = (id: number): StockImage => ({ provider: 'pixabay',providerId: String(id),title: 'Foto de teste',creator: 'Teste',
  sourceUrl: 'https://example.com/photo',imageUrl: 'https://example.com/image.jpg',previewUrl: 'https://example.com/preview.jpg',
  license: 'Pixabay Content License',licenseUrl: 'https://pixabay.com/service/license-summary/',attribution: 'Teste / Pixabay',width: 3000,height: 2000 });
test('auto illustration fills cover and body with distinct real-resolution records; text is unchanged', async () => {
  let searches = 0;
  const result = await illustrateArticle(body,'production',new AbortController().signal,{
    search: async () => { searches++;return [photo(1),photo(2)]; },
    importImage: async image => ({ ...image,id: 'library-'+image.providerId,fileKey: 'fixture.photo.jpg',bytes: 500,createdAt: '2026-10-13T12:00:00Z',authorized: true }),
  });
  assert.equal(result.filled,2);assert.equal(searches,1,'the same public query is reused');
  assert.equal(articlePlainText(result.body),articlePlainText(body));assert.ok(result.body.cover);assert.equal(result.body.coverSlot,undefined);
  assert.equal(result.assets[0].asset.credit,'');assert.ok(result.assets[0].asset.provenance?.license);
  assert.notEqual(result.assets[0].asset.id,result.assets[1].asset.id);assert.equal(body.cover,undefined);
});
test('reduced previews never enter the article; missing originals do not fail valid writing', async () => {
  let imports = 0;
  const result = await illustrateArticle(body,'production',new AbortController().signal,{
    search: async () => [{ ...photo(1),downloadLimited: true }],importImage: async () => { imports++;throw new Error('should not import'); },
  });
  assert.equal(imports,0);assert.equal(result.filled,0);assert.deepEqual(result.codes,['PIXABAY_ORIGINAL_REQUIRED']);
  assert.equal(result.body.coverSlot?.availability?.code,'PIXABAY_ORIGINAL_REQUIRED');assert.equal(articlePlainText(result.body),articlePlainText(body));
});
test('query derivation never transmits a whole subject, participant identity or a legacy provider', () => {
  assert.equal(editorialImageQuery('Retrato de João no evento privado'),undefined);
  assert.equal(editorialImageQuery('Camarão na aquicultura'),'aquaculture');
  assert.equal(editorialImageQuery('Fábrica de processamento de pescado'),'fish processing');
});
test('outline validators reject wrong counts, invented ids and repeated evidence BEFORE cache', () => {
  const known = new Set(['1','2']),value = { introIds: [],sections: [{ evidenceIds: ['1'] },{ evidenceIds: ['2'] }] };
  assert.equal(editorialResponseValid('outline',value,known,2),true);
  assert.equal(editorialResponseValid('outline',value,known,3),false);
  assert.equal(editorialResponseValid('outline',{ ...value,introIds: ['1'] },known,2),false);
  assert.equal(editorialResponseValid('outline',{ ...value,introIds: ['fake'] },known,2),false);
  const schema = outlineResponseSchema(3,['1','2']);
  assert.equal((schema.properties.sections as { minItems: number }).minItems,3);
});
