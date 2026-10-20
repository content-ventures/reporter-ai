import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDITORIAL_FORMATS, FORMAT_SPECS, articleContractFor, articleGateFor, eventBoxLines, formatLabel, formatSizeOf, normalizeEvent, outletPunctuation } from './formats.ts';
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
