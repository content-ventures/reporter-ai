import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAROUSEL_FORMATS, categoryLabel, filterTemplates, formatById, formatOf, formatSize, TEMPLATE_STATUS_LABELS, usesArticleCover } from './carousel-library.ts';
import type { TemplateMeta } from './carousel-library.ts';

/** The library vocabulary: formats (Stories later), categories, status and the filter. */

describe('carousel library vocabulary', () => {
  it('Feed and Quadrado are selectable now; Stories is listed for R6, not selectable', () => {
    assert.deepEqual(
      CAROUSEL_FORMATS.map((format) => [format.id, format.label, format.ratio, format.available]),
      [
        ['feed', 'Feed', '4/5', true],
        ['square', 'Quadrado', '1/1', true],
        ['stories', 'Stories', '9/16', false],
      ],
    );
    assert.equal(formatById('stories')?.since, 'R6');
    assert.equal(formatOf({ width: 1080, height: 1080 })?.id, 'square');
    assert.equal(formatOf({ width: 500, height: 500 }), undefined);
    assert.equal(formatSize(CAROUSEL_FORMATS[0]), '1080 × 1350 px');
  });

  it('names categories and status in pt-BR, never "Provisório"', () => {
    assert.equal(categoryLabel('photo'), 'Foto em destaque');
    assert.equal(TEMPLATE_STATUS_LABELS.base, 'Modelo base');
    assert.ok(Object.values(TEMPLATE_STATUS_LABELS).every((label) => !/provis/i.test(label)));
  });

  it('filters by format, category, status and words (accents and case ignored), keeping the order', () => {
    const entry = (name: string, meta: Partial<TemplateMeta>) => ({ name, category: 'editorial' as const, format: 'feed' as const, description: '', tags: [], status: 'base' as const, ...meta });
    const list = [
      entry('Editorial', { tags: ['claro'] }),
      entry('Aspas', { category: 'quote', format: 'square', description: 'Itálico serifado.' }),
      entry('Números', { category: 'data', status: 'aprovado' }),
    ];
    assert.deepEqual(filterTemplates(list, { format: 'square' }).map((item) => item.name), ['Aspas']);
    assert.deepEqual(filterTemplates(list, { query: 'citacao' }).map((item) => item.name), ['Aspas'], 'category label, no accents');
    assert.deepEqual(filterTemplates(list, { query: 'ITALICO serif' }).map((item) => item.name), ['Aspas']);
    assert.deepEqual(filterTemplates(list, { query: 'numeros' }).map((item) => item.name), ['Números']);
    assert.deepEqual(filterTemplates(list, { status: 'aprovado' }).map((item) => item.name), ['Números']);
    assert.deepEqual(filterTemplates(list, { category: 'editorial', query: 'claro' }).map((item) => item.name), ['Editorial']);
    assert.deepEqual(filterTemplates(list, {}).map((item) => item.name), ['Editorial', 'Aspas', 'Números']);
  });

  it('knows when a template draws the article image', () => {
    assert.equal(usesArticleCover({ layouts: [{ id: 'cover', label: 'Capa', slots: [], articleCover: true }] }), true);
    assert.equal(usesArticleCover({ layouts: [{ id: 'cover', label: 'Capa', slots: [] }] }), false);
  });
});
