import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_DRAFT, MAX_MATERIAL_PARTS, RECEIVED_PART, type MaterialPart, type NewProductionDraft } from './form.ts';
import { partSlots, partViews } from './material-parts.ts';
import type { PartReads } from './use-file-reader.ts';

const part = (id: string, extra: Partial<MaterialPart> = {}): MaterialPart => ({ id, name: `${id}.mp3`, size: 6 * 1024 ** 2, ...extra });
const filed = (...parts: MaterialPart[]): NewProductionDraft => ({ ...EMPTY_DRAFT, mode: 'file', parts });

test('partViews gives every part its own read: upload percent, chunks, cancel, retry and stats of the same parts', () => {
  const draft = filed(part('a'), part('b'), part('c'), part('d', { text: 'Ana: oi' }), part('e', { text: 'WEBVTT' }));
  const reads: PartReads = {
    a: { status: 'reading', name: 'a.mp3', size: 6 * 1024 ** 2, phase: 'uploading', message: 'Enviando arquivo', uploadedBytes: 5 * 1024 ** 2, totalBytes: 6 * 1024 ** 2 },
    b: { status: 'reading', name: 'b.mp3', size: 1, phase: 'transcribing', message: 'Transcrevendo áudio', done: 2, total: 6 },
    c: { status: 'error', name: 'c.mp3', size: 1, phase: 'uploading', message: 'Conexão perdida.', retry: 'reread' },
  };
  const views = partViews(draft, reads);
  assert.deepEqual(views.map((view) => view.number), [1, 2, 3, 4, 5]);
  assert.deepEqual(views[0].status, { kind: 'reading', message: 'Enviando arquivo', cancellable: true, upload: { sent: 5 * 1024 ** 2, total: 6 * 1024 ** 2, percent: 83 } });
  assert.deepEqual(views[1].status, { kind: 'reading', message: 'Transcrevendo áudio', cancellable: false, chunks: { done: 2, total: 6 } });
  assert.deepEqual(views[2].status, { kind: 'error', message: 'Conexão perdida.', retry: 'reread' });
  assert.equal(views[2].size, 1);
  assert.deepEqual(views[3].status, { kind: 'ready' });
  // Stats only from an analysis of these same parts.
  const cue = { format: 'srt' as const, segments: 1 };
  const analysis = { parts: [cue, cue, cue, { format: 'plain' as const, segments: 4, startMs: 0, durationMs: 9000 }, { format: 'vtt' as const, segments: 0 }] };
  const ready = partViews(draft, reads, analysis);
  assert.deepEqual(ready[3].status, { kind: 'ready', segments: 4, durationMs: 9000 });
  assert.deepEqual(ready[4].status, { kind: 'ready', segments: 0, empty: true });
  assert.deepEqual(partViews(draft, reads, { parts: analysis.parts.slice(0, 2) })[3].status, { kind: 'ready' });
  assert.deepEqual(partViews(filed(part('a'), part('b', { text: 'x' })), {})[0].status, { kind: 'reading', message: 'Lendo arquivo', cancellable: false });
});

test('partSlots: open in "Arquivo", full at the limit, closed elsewhere and beside a Drive file', () => {
  assert.equal(partSlots(filed()), 'open');
  assert.equal(partSlots(filed(part('a'))), 'open');
  assert.equal(partSlots(filed(...Array.from({ length: MAX_MATERIAL_PARTS }, (_, index) => part(`p${index}`)))), 'full');
  assert.equal(partSlots(filed(part(RECEIVED_PART, { received: true }))), 'closed');
  assert.equal(partSlots({ ...EMPTY_DRAFT, mode: 'paste' }), 'closed');
});
