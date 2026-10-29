import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMemoryDocument } from './editorial-memory-document.ts';
import { mapMemoryMarketRows, type MemoryMarketMapping } from './editorial-memory-market.ts';
import { prepareMemoryMarketRows } from './editorial-memory-market-import.ts';
import { createMemoryMaterial } from './editorial-memory-import.ts';

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

test('market evidence keeps literal rows and refuses absent or nonliteral context', () => {
  const text = 'instituição;indicador;valor;unidade;período\nÓrgão;Vendas;1.234,56;pessoas;2025\nÓrgão;Vendas;;pessoas;2026\n';
  const doc = readMemoryDocument({ name: 'mercado.csv', bytes: new TextEncoder().encode(text), delimiter: ';' }); assert.ok(doc.ok);
  const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
  const ctx = { actorId: 'editor', now: '2026-10-29T12:00:00Z', newId: (prefix: string) => prefix };
  const made = createMemoryMaterial({ title: 'Mercado', kind: 'market_data', text, metadata, authorized: true, primaryOrigin: null, originalFileId: 'original' }, 'workspace', ctx);
  const mapping: MemoryMarketMapping = { institution: { record: 'row', column: 0 }, indicator: { record: 'row', column: 1 }, value: { record: 'row', column: 2 },
    unit: { record: 'row', column: 3 }, period: { record: 'row', column: 4 } };
  const plan = { materialId: made.material.id, revision: 1, source: made.material.source, originalFileId: 'original', checksum: 'a'.repeat(64), mapping, updatedBy: 'editor', updatedAt: ctx.now };
  const result = prepareMemoryMarketRows(made.material, made.source, doc.value, plan, 1, ctx); assert.ok(result.ok);
  const first = result.value.rows[0]; assert.equal(first.status, 'ready'); if (first.status === 'ready') {
    assert.equal(first.evidence.value.raw, '1.234,56'); assert.equal(first.evidence.market?.fields.value?.column, 3);
    assert.equal(first.evidence.anchor.excerpt, 'Órgão;Vendas;1.234,56;pessoas;2025\n');
  }
  assert.deepEqual(result.value.rows[1], { record: 3, status: 'refused', reason: 'missing', fields: ['value'] });
  const header = prepareMemoryMarketRows(made.material, made.source, doc.value, { ...plan, mapping: { ...mapping, unit: { record: 'header', column: 3 } } }, 1, ctx);
  assert.ok(header.ok); assert.equal(header.value.rows[0].status, 'refused');
});
