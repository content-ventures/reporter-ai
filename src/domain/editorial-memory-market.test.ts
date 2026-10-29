import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMemoryDocument } from './editorial-memory-document.ts';
import { mapMemoryMarketRows, type MemoryMarketMapping } from './editorial-memory-market.ts';

test('market mapping retains each literal CSV cell and reports missing values without inventing data', () => {
  const text = 'Instituição;Indicador;Valor;Unidade;Período\r\nÓrgão;"Índice ""A""";"1.234,56";%;2025\r\nÓrgão;Índice B;;%;2026\r\n';
  const parsed = readMemoryDocument({ name: 'mercado.csv', bytes: new TextEncoder().encode(text), delimiter: ';' });
  assert.ok(parsed.ok);
  const mapping: MemoryMarketMapping = { institution: { record: 'row', column: 0 }, indicator: { record: 'row', column: 1 },
    value: { record: 'row', column: 2 }, unit: { record: 'header', column: 3 }, period: { record: 'row', column: 4 } };
  const first = mapMemoryMarketRows(parsed.value, mapping, 1, 1); assert.ok(first.ok);
  assert.equal(first.value.next, 2); assert.equal(first.value.total, 2);
  const row = first.value.rows[0]; assert.equal(row.fields.indicator?.value, 'Índice "A"');
  assert.equal(row.fields.indicator?.original, '"Índice ""A"""'); assert.equal(row.fields.value?.value, '1.234,56');
  assert.equal(row.fields.unit?.record, 1); assert.equal(text.slice(row.from, row.to), row.excerpt); assert.deepEqual(row.missing, []);
  const second = mapMemoryMarketRows(parsed.value, mapping, 2, 1); assert.ok(second.ok);
  assert.deepEqual(second.value.rows[0].missing, ['value']); assert.equal(second.value.next, null);
  assert.equal(mapMemoryMarketRows(parsed.value, { ...mapping, value: { record: 'row', column: 5 } }).ok, false);
});
