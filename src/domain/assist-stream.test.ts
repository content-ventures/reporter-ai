import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldRun } from './run-events.ts';
import type { RunEvent, RunFold } from './run-events.ts';
import { applySuggestion } from './suggestion.ts';
import type { Suggestion } from './suggestion.ts';
import type { ArticleBody } from './article.ts';
import { segmentRef } from './refs.ts';

const started: RunEvent = { type: 'run.started',runId: 'r',seq: 1,at: '2026-10-11T12:00:00Z',kind: 'article.assist',productionId: 'p',pieceId: 'a',
  prompt: { key: 'assist',version: '1',hash: 'test' },model: { alias: 'provider',label: 'Provider',engine: 'provider' },inputs: [],steps: [],createdBy: 'test' };
test('unvalidated assistant deltas are visible but never become document blocks or ready suggestions', () => {
  const preview: RunEvent = { type: 'assist.preview',runId: 'r',seq: 2,at: started.at,reply: 'Recebendo resposta',proposals: [{ id: 'preview',text: 'Um novo texto' }] };
  const fold = foldRun([started,preview])!;
  assert.equal(fold.assistPreview?.reply,'Recebendo resposta');
  assert.deepEqual(fold.blocks,[]); assert.deepEqual(fold.suggestions,[]);
  for (const terminal of ['run.completed','run.cancelled','run.failed'] as const) {
    const event = { type: terminal,runId: 'r',seq: 3,at: started.at,...(terminal === 'run.failed' ? { error: { code: 'PROVIDER_FAILURE',message: 'Failed',retryable: true } } : {}) } as RunEvent;
    const ended: RunFold = foldRun([started,preview,event])!;
    assert.equal(ended.assistPreview,undefined);
    assert.deepEqual(ended.suggestions,[]);
  }
});
test('accepting source-backed text retains old evidence and adds new evidence once, without changing untouched blocks', () => {
  const first = segmentRef('source',1,'a'), added = segmentRef('source',1,'b');
  const body: ArticleBody = { type: 'article',title: 'Test',blocks: [{ id: 'p',type: 'paragraph',inlines: [{ text: 'Texto da fonte.' }],sourceRefs: [first],ai: 'reviewed' },
    { id: 'other',type: 'paragraph',inlines: [{ text: 'Outro parágrafo.' }] }] };
  const suggestion: Suggestion = { id: 's',runId: 'r',pieceId: 'a',baseRevision: 1,target: [{ blockId: 'p',from: 0,to: 15 }],anchorText: ['Texto da fonte.'],
    proposal: { kind: 'replace-text',text: 'Novo texto com fatos da fonte.',sourceRefs: [first,added,added] },state: 'ready',createdAt: started.at };
  const applied = applySuggestion(body,suggestion); assert.ok(applied.ok);
  assert.deepEqual(applied.value.blocks[0].sourceRefs,[first,added]);
  assert.deepEqual(applied.value.blocks[1],body.blocks[1]);
  assert.equal(body.blocks[0].ai,'reviewed');
});
