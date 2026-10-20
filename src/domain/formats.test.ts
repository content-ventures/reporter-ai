import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDITORIAL_FORMATS, FORMAT_SPECS, articleContractFor, articleGateFor, eventBoxLines, formatLabel, formatSizeOf, materialMinutes, normalizeEvent, outletPunctuation, suggestedFormatSize, tidyQuoteOpenings } from './formats.ts';
import { R1_ARTICLE_LIMITS } from './article-policy.ts';
import { briefHash, validateBrief } from './production.ts';
import type { Brief } from './production.ts';

const SSLA = { name: 'Seafood Show Latin America 2026', dates: 'De 20 a 22 de outubro de 2026', hours: 'Das 13h às 20h', venue: 'Distrito Anhembi' };

test('every format has coherent size options measured on the outlet', () => {
  for (const format of EDITORIAL_FORMATS) {
    const spec = FORMAT_SPECS[format];
    assert.ok(spec.sizes.some((size) => size.id === spec.defaultSize), format);
    for (const size of spec.sizes) {
      assert.ok(size.minChars < size.targetChars && size.targetChars < size.maxChars, `${format} ${size.id}`);
      assert.ok(size.sections.min <= size.sections.default && size.sections.default <= size.sections.max, `${format} ${size.id}`);
    }
  }
  assert.equal(FORMAT_SPECS.note.headings, false);
  assert.equal(formatSizeOf('stand', 'nope').id, 'full');
});

test('the article keeps R1; a format brings its own contract', () => {
  assert.deepEqual(articleContractFor({}), { ...R1_ARTICLE_LIMITS });
  assert.deepEqual(articleContractFor({ format: 'stand', formatSize: 'compact' }), { minChars: 1200, maxChars: 2300, targetChars: 2070, minQuotes: 2 });
  assert.equal(articleContractFor({ format: 'awards' }).minQuotes, 0);
  assert.equal(formatLabel({ format: 'stand', formatSize: 'compact' }), 'Cobertura de estande · Enxuto');
  assert.equal(formatLabel({ format: 'note' }), 'Nota curta');
  assert.equal(formatLabel({}), undefined);
});

test('a brief without format keeps its hash and shape', () => {
  const article: Brief = { sections: 3, size: 'standard', revision: 1 };
  const validated = validateBrief(article);
  assert.ok(validated.ok);
  assert.deepEqual(validated.value, article);
  assert.equal(briefHash(article), briefHash({ ...article, revision: 9 }));
  assert.notEqual(briefHash(article), briefHash({ ...article, format: 'stand' }));
});

test('a format brief validates its own sections and keeps only a named event', () => {
  const stand = validateBrief({ sections: 2, size: 'standard', revision: 1, format: 'stand', formatSize: 'full', event: { ...SSLA, about: '  ' } });
  assert.ok(stand.ok);
  assert.deepEqual(stand.value.event, SSLA);
  const tooMany = validateBrief({ sections: 5, size: 'standard', revision: 1, format: 'note' });
  assert.ok(!tooMany.ok && tooMany.refusal.message === 'Nota curta aceita de 1 a 2 seções.');
  const unknown = validateBrief({ sections: 1, size: 'standard', revision: 1, format: 'podcast' as never });
  assert.ok(!unknown.ok && unknown.refusal.code === 'unknown_format');
  assert.equal(normalizeEvent({ name: ' ', dates: 'amanhã' }), undefined);
});

test('the closing box is built from the typed event only', () => {
  assert.deepEqual(eventBoxLines(undefined), []);
  assert.deepEqual(eventBoxLines({ ...SSLA, cta: 'Acompanhe nossa cobertura especial no site e nas redes sociais.' }).map((line) => line.text), [
    'Seafood Brasil na Seafood Show Latin America 2026', '—', 'SEAFOOD SHOW LATIN AMERICA 2026',
    'Data: De 20 a 22 de outubro de 2026', 'Horário: Das 13h às 20h', 'Local: Distrito Anhembi',
    'Acompanhe nossa cobertura especial no site e nas redes sociais.',
  ]);
});

test('a format blocks on its ceiling and quotes, never on its minimum; the article keeps R1', () => {
  assert.deepEqual(articleGateFor({ format: 'opening' }), { maxChars: 5000, targetChars: 4500, minQuotes: 2 });
  assert.deepEqual(articleGateFor({}), { ...R1_ARTICLE_LIMITS });
  assert.equal(outletPunctuation('“Vendemos mais.”, explicou. “Somos líderes.”.'), '“Vendemos mais”, explicou. “Somos líderes.”');
  assert.equal(outletPunctuation('“Por quê?”, perguntou.'), '“Por quê?”, perguntou.');
  assert.equal(outletPunctuation('Confira a seguir os vencedores de cada categoria: .'), 'Confira a seguir os vencedores de cada categoria:');
});

test('a service value typed with its own label keeps one label', () => {
  const lines = eventBoxLines({ name: 'SSLA 2026', dates: 'Data: de 20 a 22 de outubro', venue: 'local: Distrito Anhembi' });
  assert.deepEqual(lines.filter((line) => line.kind === 'service').map((line) => line.text), ['Data: de 20 a 22 de outubro', 'Local: Distrito Anhembi']);
});

test('a quotation opens on its first real word, with a capital when it opens the sentence', () => {
  assert.equal(tidyQuoteOpenings('Ele destacou Minas Gerais. “a gente reconhece que é um evento nacional”, afirmou.'),
    'Ele destacou Minas Gerais. “A gente reconhece que é um evento nacional”, afirmou.');
  assert.equal(tidyQuoteOpenings('“Então o mercado tende a ser bastante estável até meados de 2027”, finalizou Blanch.'),
    '“O mercado tende a ser bastante estável até meados de 2027”, finalizou Blanch.');
  assert.equal(tidyQuoteOpenings('Segundo ele: “bom, a vacina é o nosso carro-chefe hoje”.'), 'Segundo ele: “A vacina é o nosso carro-chefe hoje”.');
  // Inside a sentence the quotation keeps its case; a short one keeps its opener.
  assert.equal(tidyQuoteOpenings('Ele explicou que “a gente reconhece o evento nacional”.'), 'Ele explicou que “a gente reconhece o evento nacional”.');
  assert.equal(tidyQuoteOpenings('“Então, sim”, disse.'), '“Então, sim”, disse.');
});

test('a stand interview of 3 minutes or more suggests Completo when a smaller size is chosen', () => {
  assert.equal(materialMinutes({ durationMs: 196_584, words: 563 }).toFixed(1), '3.3');
  assert.equal(materialMinutes({ words: 300 }), 2);
  assert.equal(suggestedFormatSize('stand', 'compact', 3.3)?.label, 'Completo');
  assert.equal(suggestedFormatSize('stand', 'full', 3.3), undefined);
  assert.equal(suggestedFormatSize('stand', 'compact', 2.5), undefined);
  assert.equal(suggestedFormatSize('note', undefined, 5), undefined);
});
