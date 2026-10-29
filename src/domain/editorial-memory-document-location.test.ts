import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMemoryDocument } from './editorial-memory-document.ts';
import { locateMemoryDocumentEvidence } from './editorial-memory-document-location.ts';
import { createMemoryMaterial } from './editorial-memory-import.ts';
import { reviseMemoryMaterial } from './editorial-memory-material-revision.ts';
import { toSourceVersionRef } from './source.ts';

const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
let id = 0;
const ctx = { actorId: 'actor', now: '2026-10-29T00:00:00Z', newId: (prefix: string) => `${prefix}-${++id}` };
function fixture(name: string, text: string, delimiter?: ',' | ';' | '\t') {
  const parsed = readMemoryDocument({ name, bytes: new TextEncoder().encode(text), delimiter }); assert.ok(parsed.ok);
  const created = createMemoryMaterial({ title: 'Original', kind: 'archive', text, metadata, authorized: true, primaryOrigin: null, originalFileId: 'original-file' }, 'workspace', ctx);
  const anchor = (excerpt: string) => { const from = text.indexOf(excerpt); assert.ok(from >= 0); return { source: toSourceVersionRef(created.source), spans: [{ segmentId: 'original', from, to: from + excerpt.length }], excerpt }; };
  return { ...created, document: parsed.value, anchor };
}

test('locations retain exact Unicode offsets and physical lines across CRLF and lone carriage returns', () => {
  const f = fixture('original.txt', '\ufeffPrimeira 🐟\r\nSegunda linha\rTerceira linha\nFim');
  const anchor = f.anchor('Segunda linha\rTerceira'), location = locateMemoryDocumentEvidence(f.material, f.source, anchor, 'original-file', f.document);
  assert.ok(location); assert.deepEqual([location.firstLine, location.lastLine], [2, 3]);
  assert.deepEqual(location.records, [{ record: 2, columns: [] }, { record: 3, columns: [] }]);
  assert.equal(f.document.text.slice(location.from, location.to), anchor.excerpt);
});

test('table locations identify the original record and columns without interpreting values or dates', () => {
  const f = fixture('mercado.csv', 'instituição;valor;nota\r\nÓrgão;"1.234,56";"primeira\r\nsegunda"\r\n', ';');
  const anchor = f.anchor('1.234,56";"primeira\r\nsegunda');
  const location = locateMemoryDocumentEvidence(f.material, f.source, anchor, 'original-file', f.document);
  assert.ok(location); assert.deepEqual([location.firstLine, location.lastLine], [2, 3]);
  assert.deepEqual(location.records, [{ record: 2, columns: [2, 3] }]);
  assert.equal(f.document.text.slice(location.from, location.to), anchor.excerpt);
});

test('a changed source, wrong file, wrong workspace or invalid anchor never receives a guessed original location', () => {
  const f = fixture('original.txt', 'Primeira linha\nSegunda linha'); const anchor = f.anchor('Segunda');
  assert.equal(locateMemoryDocumentEvidence(f.material, f.source, anchor, 'other-file', f.document), undefined);
  assert.equal(locateMemoryDocumentEvidence({ ...f.material, workspaceId: 'other' }, f.source, anchor, 'original-file', f.document), undefined);
  assert.equal(locateMemoryDocumentEvidence(f.material, f.source, { ...anchor, excerpt: 'inferred' }, 'original-file', f.document), undefined);
  assert.equal(locateMemoryDocumentEvidence(f.material, f.source, { ...anchor, source: { ...anchor.source, hash: 'different' } }, 'original-file', f.document), undefined);
  const changed = structuredClone(f.source); changed.versions[0].content.segments[0].text = 'Texto alterado';
  assert.equal(locateMemoryDocumentEvidence(f.material, changed, anchor, 'original-file', f.document), undefined);
  assert.equal(locateMemoryDocumentEvidence(f.material, f.source, anchor, 'original-file', { ...f.document, text: 'Arquivo diferente' }), undefined);
});

test('anchors cannot claim half a Unicode character or invent a physical page', () => {
  const f = fixture('original.txt', 'Antes 🐟 depois'); const from = f.document.text.indexOf('🐟');
  const partial = { source: toSourceVersionRef(f.source), spans: [{ segmentId: 'original', from, to: from + 1 }], excerpt: f.document.text.slice(from, from + 1) };
  assert.equal(locateMemoryDocumentEvidence(f.material, f.source, partial, 'original-file', f.document), undefined);
  const valid = locateMemoryDocumentEvidence(f.material, f.source, f.anchor('🐟'), 'original-file', f.document);
  assert.ok(valid); assert.equal('page' in valid, false);
});

test('a later source correction preserves the old location but cannot claim its new words came from the old file', () => {
  const f = fixture('original.txt', 'Trecho original\nOutra linha');
  const oldAnchor = f.anchor('Trecho original');
  const revised = reviseMemoryMaterial(f.material, f.source, 'Trecho corrigido\nOutra linha', 'Revisão sintética', ctx);
  assert.ok(locateMemoryDocumentEvidence(revised.material, revised.source, oldAnchor, 'original-file', f.document));
  const newAnchor = { source: toSourceVersionRef(revised.source), spans: [{ segmentId: 'original', from: 0, to: 16 }], excerpt: 'Trecho corrigido' };
  assert.equal(locateMemoryDocumentEvidence(revised.material, revised.source, newAnchor, 'original-file', f.document), undefined);
});
