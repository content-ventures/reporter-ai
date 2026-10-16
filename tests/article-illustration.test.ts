import assert from 'node:assert/strict';
import { test } from 'node:test';
import { illustrateArticle } from '../src/server/article-illustration.ts';
import { editorialResponseValid,outlineResponseSchema } from '../src/server/editorial-validation.ts';
import { articlePlainText } from '../src/domain/article.ts';
import type { ArticleBody } from '../src/domain/article.ts';
import { imageGenerationPrompt } from '../src/domain/image-generation.ts';
const body: ArticleBody = { type: 'article',title: 'Teste sintético',coverSlot: { subject: 'Pescado em uma peixaria',orientation: 'portrait' },blocks: [
  { id: 'paragraph',type: 'paragraph',inlines: [{ text: 'Texto fictício permanece exatamente o mesmo.' }] },
  { id: 'figure',type: 'figure',slot: { subject: 'Peixes no mercado',suggestedAlt: 'Peixes expostos',suggestedCaption: 'Mercado de peixes' } },
] };
const identity = { portal: 'portal',actor: 'actor' };
const photo = (seed: string) => ({ bytes: Buffer.from('jpeg '+seed),width: 1536,height: 1024 });
test('a generated article arrives illustrated: cover and figures from their suggestions, text unchanged', async () => {
  const prompts: { prompt: string; orientation?: string }[] = [],stored: string[] = [];
  const result = await illustrateArticle(body,'production',new AbortController().signal,{
    generate: async input => { prompts.push(input);return photo(input.prompt); },
    store: async fileKey => { stored.push(fileKey); },
  },identity);
  assert.equal(result.filled,2);assert.equal(stored.length,2);
  assert.deepEqual(prompts.map(item => item.prompt).sort(),['Peixes no mercado','Pescado em uma peixaria']);
  assert.equal(prompts.find(item => item.prompt === 'Pescado em uma peixaria')?.orientation,'landscape','the cover is always 16:9');
  assert.equal(articlePlainText(result.body),articlePlainText(body));
  assert.equal(result.body.coverSlot,undefined);assert.ok(result.body.cover);
  const figure = result.body.blocks[1];
  assert.ok(figure.type === 'figure' && figure.image && !figure.slot);
  assert.deepEqual(figure.type === 'figure' ? { alt: figure.image?.alt,caption: figure.image?.caption } : {},{ alt: 'Peixes expostos',caption: 'Mercado de peixes' });
  for (const entry of result.assets) {
    assert.equal(entry.asset.origin.type,'generated');assert.equal(entry.asset.credit,'Gerada com IA');assert.equal(entry.asset.rights.authorized,true);
    assert.match(entry.fileKey ?? '',/^[a-f0-9]{64}\.image$/);
  }
  assert.equal(body.cover,undefined,'the input body is not mutated');
});
test('a failed generation leaves that suggestion as it was, never an error', async () => {
  const result = await illustrateArticle(body,'production',new AbortController().signal,{
    generate: async input => { if (input.prompt === 'Peixes no mercado') throw new Error('provider down');return photo(input.prompt); },
    store: async () => {},
  },identity);
  assert.equal(result.filled,1);assert.ok(result.body.cover);
  const figure = result.body.blocks[1];
  assert.deepEqual(figure.type === 'figure' ? figure.slot : undefined,body.blocks[1].type === 'figure' ? body.blocks[1].slot : undefined);
  assert.equal(figure.type === 'figure' ? figure.slot?.availability : 'x',undefined);
});
test('the provider gets the description inside the editorial frame, never asked to portray a named person', () => {
  const prompt = imageGenerationPrompt('  Retrato de João   no estande ');
  assert.match(prompt,/Cena: Retrato de João no estande/);
  assert.match(prompt,/Não retrate pessoas reais identificáveis/);
  assert.match(prompt,/Sem texto/);
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
