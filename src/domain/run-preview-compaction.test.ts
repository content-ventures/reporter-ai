import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactRunPreviews, foldRun, stampRunEvent } from './run-events.ts';
import type { RunEvent, RunEventPayload } from './run-events.ts';

function fixture() {
  const events: RunEvent[] = [];
  const append = (payload: RunEventPayload) => events.push(stampRunEvent(payload, 'run', events.length + 1, '2026-10-15T12:00:00Z'));
  append({ type: 'run.started', kind: 'article.generate', productionId: 'production', createdBy: 'person',
    prompt: { key: 'article', version: '1', hash: 'saved' }, model: { alias: 'model', label: 'Model', engine: 'provider' }, inputs: [], steps: [] });
  for (let i = 0; i < 100; i++) {
    append({ type: 'article.preview', body: { type: 'article', title: String(i), blocks: [
      { id: 'p', type: 'paragraph', inlines: [{ text: 'Prévia '.repeat(2000) }] },
    ] } });
    append({ type: 'assist.preview', reply: 'Sugestão '.repeat(1000), proposals: [{ id: String(i), text: 'Proposta '.repeat(500) }] });
  }
  return { events, append };
}

test('preview storage remains bounded with the same event cursors and active fold', () => {
  const { events } = fixture(), before = JSON.stringify(events);
  const compacted = compactRunPreviews(events);
  assert.deepEqual(foldRun(compacted), foldRun(events));
  assert.deepEqual(compacted.map(event => [event.type, event.seq, event.at]), events.map(event => [event.type, event.seq, event.at]));
  assert.ok(JSON.stringify(compacted).length < before.length / 30);
  assert.equal(events.filter(event => event.type === 'article.preview' && event.body).length, 100, 'the input is immutable');
  assert.deepEqual(compactRunPreviews(compacted), compacted);
});

test('terminal runs retain final blocks and provenance with no stale preview payloads', () => {
  for (const type of ['run.completed', 'run.failed', 'run.cancelled'] as const) {
    const { events, append } = fixture();
    append({ type: 'block.completed', block: { id: 'final', type: 'paragraph', inlines: [{ text: 'Texto final revisável.' }], ai: 'unreviewed' } });
    append(type === 'run.failed' ? { type, error: { code: 'failure', message: 'Falha sintética', retryable: false } } : { type });
    const compacted = compactRunPreviews(events);
    assert.deepEqual(foldRun(compacted), foldRun(events));
    assert.equal(compacted.filter(event => event.type === 'article.preview' && event.body).length, 0);
    assert.equal(compacted.filter(event => event.type === 'assist.preview' && (event.reply || event.proposals.length)).length, 0);
    assert.deepEqual(compacted.filter(event => event.type === 'block.completed' || event.type === 'run.started'), events.filter(event => event.type === 'block.completed' || event.type === 'run.started'));
  }
});
