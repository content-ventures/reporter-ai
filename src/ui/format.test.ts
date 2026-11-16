import assert from 'node:assert/strict';
import { test } from 'node:test';

import { charactersAbove, formatCharacters, formatLaudas, formatLaudasOf, formatListDateTime, formatSize, SIZE_OPTIONS } from './format.ts';

test('list date and time stay on one line: the dot is held by non-breaking spaces', () => {
  const text = formatListDateTime(new Date(2026, 8, 29, 1, 30));
  assert.equal(text, '29/09 · 01:30');
  assert.doesNotMatch(text, / /);
  assert.equal(formatListDateTime('not a date'), '—');
});

test('visible article measurements use characters, including historical formatter signatures', () => {
  assert.equal(formatLaudas(800), '800 caracteres');
  assert.equal(formatLaudas(2000), '2.000 caracteres');
  assert.equal(formatLaudas(2001), '2.001 caracteres');
  assert.equal(formatLaudas(2764), '2.764 caracteres');
  assert.equal(formatLaudas(4000), '4.000 caracteres');
  assert.equal(formatLaudas(4600), '4.600 caracteres');
  assert.equal(formatLaudas(0), '0 caracteres');
  assert.equal(formatLaudasOf(2764, 'standard'), '2.764 caracteres');
  assert.equal(formatLaudasOf(1600, 'short'), '1.600 caracteres');
});

test('characters above the size ceiling ("640 caracteres acima")', () => {
  assert.equal(charactersAbove(4640, 'standard'), 640);
  assert.equal(charactersAbove(4000, 'standard'), 0);
  assert.equal(charactersAbove(2100, 'short'), 100);
  assert.equal(charactersAbove(1200, 'short'), 0);
});

test('characters and size labels', () => {
  assert.equal(formatCharacters(2764), '2.764 caracteres');
  assert.equal(formatCharacters(1), '1 caractere');
  assert.equal(formatSize('short'), 'Curto · até 2.000 caracteres');
  assert.equal(formatSize('standard'), 'Padrão · até 4.000 caracteres');
  assert.deepEqual(
    SIZE_OPTIONS.map((option) => [option.label, option.description]),
    [
      ['Curto · até 2.000 caracteres', 'Notícia direta: um fato, pouco contexto. Até 2.000 caracteres.'],
      ['Padrão · até 4.000 caracteres', 'Notícia com contexto: histórico, citações, fontes e links. Até 4.000 caracteres.'],
    ],
  );
});
