import assert from 'node:assert/strict';
import { test } from 'node:test';

import { charactersAbove, formatCharacters, formatLaudas, formatLaudasOf, formatListDateTime, formatSize, SIZE_OPTIONS } from './format.ts';

test('list date and time stay on one line: the dot is held by non-breaking spaces', () => {
  const text = formatListDateTime(new Date(2026, 8, 29, 1, 30));
  assert.equal(text, '29/09 · 01:30');
  assert.doesNotMatch(text, / /);
  assert.equal(formatListDateTime('not a date'), '—');
});

test('laudas round up to one decimal, plural only from 2 (1 lauda = 2.000 characters)', () => {
  assert.equal(formatLaudas(800), '0,4 lauda');
  assert.equal(formatLaudas(2000), '1 lauda');
  assert.equal(formatLaudas(2001), '1,1 lauda');
  assert.equal(formatLaudas(2764), '1,4 lauda');
  assert.equal(formatLaudas(4000), '2 laudas');
  assert.equal(formatLaudas(4600), '2,3 laudas');
  assert.equal(formatLaudas(0), '0 lauda');
  assert.equal(formatLaudasOf(2764, 'standard'), '1,4 de 2 laudas');
  assert.equal(formatLaudasOf(1600, 'short'), '0,8 de 1 lauda');
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
  assert.equal(formatSize('short'), 'Curto · 1 lauda');
  assert.equal(formatSize('standard'), 'Padrão · 2 laudas');
  assert.deepEqual(
    SIZE_OPTIONS.map((option) => [option.label, option.description]),
    [
      ['Curto · 1 lauda', 'Notícia direta: um fato, pouco contexto. Até 2.000 caracteres.'],
      ['Padrão · 2 laudas', 'Notícia com contexto: histórico, citações, fontes e links. Até 4.000 caracteres.'],
    ],
  );
});
