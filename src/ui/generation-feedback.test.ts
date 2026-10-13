import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generationFeedback, newestRunId } from './generation-feedback.ts';

test('a later run replaces a stale tab selection without dropping optimistic starts', () => {
  const runs = [{ id: 'failed', createdAt: '2026-10-10T18:00:00Z' },{ id: 'success',createdAt: '2026-10-10T18:01:00Z' }];
  assert.equal(newestRunId(runs,'failed'),'success');
  assert.equal(newestRunId(runs,'pending'),'pending');
  assert.equal(newestRunId([...runs].reverse()),'success');
  assert.equal(newestRunId([]),undefined);
});
test('feedback shows real preparation/retry detail and elapsed time without a fake ETA', () => {
  const run = { status: 'running' as const, startedAt: '2026-10-10T18:00:00Z',steps: [{ id: 'source',label: 'Preparando a fonte',state: 'current' as const,meta: '4 de 10 trechos preparados' }] };
  const feedback = generationFeedback(run,Date.parse('2026-10-10T18:00:42Z'));
  assert.equal(feedback.elapsed,'42 s decorridos');
  assert.equal(feedback.detail,'4 de 10 trechos preparados');
  assert.match(feedback.notice!,/após a validação/);
  assert.match(feedback.background,/continua no servidor/);
  const retry = generationFeedback({ ...run,steps: [{ ...run.steps[0],meta: 'Limite temporário; nova tentativa em 30 s.' }] });
  assert.equal(retry.notice,'Limite temporário; nova tentativa em 30 s.');
  assert.equal(retry.elapsed,undefined);
});
test('ended runs stop the clock and queued work is not described as writing', () => {
  const run = { status: 'completed' as const,startedAt: '2026-10-10T18:00:00Z',endedAt: '2026-10-10T18:00:20Z',steps: [] };
  assert.equal(generationFeedback(run,Date.parse('2026-10-10T20:00:00Z')).elapsed,'20 s decorridos');
  assert.equal(generationFeedback({ status: 'queued',steps: [] }).label,'Na fila para iniciar');
});
