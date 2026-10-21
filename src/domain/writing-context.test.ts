import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readWritingTemporalContext, writingExecutionDate, writingTemporalContext } from './writing-context.ts';

test('temporal context keeps each supplied recording date separate from execution and upload dates', () => {
  const sources = [
    { id: 'may-interview', title: 'Entrevista na feira', recordedOn: '2026-05-20', createdAt: '2026-10-20T09:00:00Z' },
    { id: 'september-interview', title: 'Entrevista posterior', recordedOn: '2026-09-01', createdAt: '2026-10-20T09:00:00Z' },
    { id: 'undated', title: 'Gravação sem data informada', createdAt: '2026-10-20T09:00:00Z' },
  ];
  const context = writingTemporalContext(sources, '2026-10-21');
  assert.deepEqual(context, { executionDate: '2026-10-21', sources: [
    { sourceId: 'may-interview', title: 'Entrevista na feira', recordedOn: '2026-05-20' },
    { sourceId: 'september-interview', title: 'Entrevista posterior', recordedOn: '2026-09-01' },
    { sourceId: 'undated', title: 'Gravação sem data informada', recordedOn: null },
  ] });
  sources[0].recordedOn = '2026-05-21';
  assert.equal(context.sources[0].recordedOn, '2026-05-20', 'captured context is not a live reference to source metadata');
});

test('missing historical metadata stays absent while explicitly unknown source dates stay visible', () => {
  for (const brief of [undefined, null, {}, { today: '21 de outubro de 2026', event: { dates: '20 a 22 de maio' } },
    { temporalContext: { executionDate: '2026-10-21', sources: [{ sourceId: 's1', title: 'Fonte' }] } }]) {
    assert.equal(readWritingTemporalContext(brief), undefined);
  }
  const temporalContext = writingTemporalContext([{ id: 's1', title: 'Fonte', recordedOn: ' ' }], '2026-10-21');
  assert.deepEqual(readWritingTemporalContext({ temporalContext }), temporalContext);
  assert.equal(readWritingTemporalContext({ temporalContext })!.sources[0].recordedOn, null);
});

test('execution date follows the newsroom calendar across UTC midnight', () => {
  assert.equal(writingExecutionDate(new Date('2026-10-21T01:30:00Z')), '2026-10-20');
  assert.equal(writingExecutionDate(new Date('2026-10-21T03:00:00Z')), '2026-10-21');
});
