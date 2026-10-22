import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leadLine } from './news-model.ts';

const LEAD = 'Especialistas do Chile, Brasil e Colômbia abordaram como as condições de cultivo, o manejo e a qualidade da água podem reduzir doenças.';

test('the lead line keeps a short lead whole and drops the ellipsis feeds add', () => {
  assert.equal(leadLine(LEAD, 'CASA e OMSA'), LEAD);
  assert.equal(leadLine(`  ${LEAD.replace(/\.$/, '')}…  `, 'CASA e OMSA'), LEAD.replace(/\.$/, ''));
});

test('a long lead is cut at a word, without a dangling comma', () => {
  const line = leadLine(`${LEAD} ${LEAD}`, 'CASA e OMSA', 120);
  assert.ok(line);
  assert.ok(line.length <= 121);
  assert.ok(line.endsWith('…'));
  assert.ok(!/[,\s]…$/.test(line));
  assert.ok(LEAD.startsWith(line.slice(0, -1)));
});

test('a page label or the repeated title is no lead', () => {
  assert.equal(leadLine('Página principal', 'Governo apresenta plano'), undefined);
  assert.equal(leadLine('', 'Título'), undefined);
  const title = 'Tilápia brasileira amplia presença no mercado externo neste ano';
  assert.equal(leadLine(title.toUpperCase(), title), undefined);
});
