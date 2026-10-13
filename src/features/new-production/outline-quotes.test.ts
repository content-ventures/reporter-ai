import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quoteView } from './outline-quotes.ts';

test('visible evidence retains the whole phrase instead of a 280-character tooltip', () => {
  const text = 'Trecho literal completo. '.repeat(30);
  const ref = { kind: 'source' as const, sourceId: 'source', sourceVersion: 1,
    locator: { type: 'segment' as const, segmentId: 'segment', from: 12, to: text.length - 10 } };
  const view = quoteView(ref, { segments: [{ id: 'segment', text, startMs: 123000 }], speakers: [] });
  assert.equal(view.excerpt, text.slice(12, -10).replace(/\s+/g, ' ').trim());
  assert.ok(view.excerpt.length > 280);
  assert.equal(view.startMs, 123000);
});
