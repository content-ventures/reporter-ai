import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { paragraphBlock } from './article.ts';
import { segmentRef } from './refs.ts';
import { applyRunEvent, articleBodyFromRun, foldRun, hasUsableOutput, stampRunEvent, trimToWordBoundary } from './run-events.ts';
import type { RunEvent, RunEventPayload } from './run-events.ts';
import { currentStep, isRunActive, runDurationMs, SIMULATED_MODEL, stepProgress } from './run.ts';

const RUN = 'run-1';
let seq = 0;
const at = (second: number) => `2026-10-07T12:00:${String(second).padStart(2, '0')}.000Z`;
function event(payload: RunEventPayload): RunEvent {
  seq += 1;
  return stampRunEvent(payload, RUN, seq, at(seq));
}

function started(): RunEvent {
  seq = 0;
  return event({
    type: 'run.started',
    kind: 'article.generate',
    productionId: 'prod-1',
    pieceId: 'piece-article',
    prompt: { key: 'article.from-transcript', version: '1', hash: 'abc' },
    model: SIMULATED_MODEL,
    inputs: [{ kind: 'source-version', sourceId: 'src-1', sourceVersion: 1, hash: 'h' }],
    steps: [
      { id: 'read', label: 'Lendo material' },
      { id: 'outline', label: 'Montando estrutura' },
      { id: 'write', label: 'Escrevendo' },
      { id: 'check', label: 'Conferindo citações' },
    ],
    createdBy: 'person-joao',
  });
}

function streamToSecondBlock(): RunEvent[] {
  return [
    started(),
    event({ type: 'step.started', stepId: 'read', meta: '6 falas · 2 falantes' }),
    event({ type: 'source.used', ref: segmentRef('src-1', 1, 'seg-002') }),
    event({ type: 'step.completed', stepId: 'read' }),
    event({ type: 'step.started', stepId: 'outline' }),
    event({ type: 'outline', title: 'Da garagem à feira', sections: [{ title: 'O começo' }] }),
    event({ type: 'step.completed', stepId: 'outline' }),
    event({ type: 'step.started', stepId: 'write', meta: 'seção 1 de 1' }),
    event({ type: 'block.started', block: { id: 'b1', type: 'paragraph' } }),
    event({ type: 'text.delta', blockId: 'b1', delta: 'O Ateliê Sul ' }),
    event({ type: 'text.delta', blockId: 'b1', delta: 'nasceu numa garagem.' }),
    event({
      type: 'block.completed',
      block: paragraphBlock('b1', 'O Ateliê Sul nasceu numa garagem.', { ai: 'unreviewed', sourceRefs: [segmentRef('src-1', 1, 'seg-002')] }),
    }),
    event({ type: 'block.started', block: { id: 'b2', type: 'paragraph' } }),
    event({ type: 'text.delta', blockId: 'b2', delta: 'A feira mudou tu' }),
  ];
}

describe('foldRun', () => {
  test('interprets steps, outline, sources and streaming blocks', () => {
    const fold = foldRun(streamToSecondBlock());
    assert.ok(fold);
    assert.equal(fold.run.status, 'running');
    assert.equal(fold.run.model.label, 'Simulação local');
    assert.deepEqual(
      fold.run.steps.map((step) => step.state),
      ['done', 'done', 'current', 'upcoming'],
    );
    assert.equal(fold.run.steps[0].meta, '6 falas · 2 falantes');
    assert.equal(currentStep(fold.run)?.id, 'write');
    assert.deepEqual(stepProgress(fold.run), { done: 2, total: 4 });
    assert.equal(fold.title, 'Da garagem à feira');
    assert.deepEqual(
      fold.blocks.map((block) => [block.id, block.text, block.complete]),
      [
        ['b1', 'O Ateliê Sul nasceu numa garagem.', true],
        ['b2', 'A feira mudou tu', false],
      ],
    );
    assert.equal(fold.sourcesUsed.length, 1, 'refs are deduplicated');
    assert.deepEqual(fold.keyRefs, [segmentRef('src-1', 1, 'seg-002')], 'what the run announced, apart from block evidence');
    const more = applyRunEvent(fold, event({ type: 'block.completed', block: paragraphBlock('b3', 'Outra.', { sourceRefs: [segmentRef('src-1', 1, 'seg-009')] }) }));
    assert.equal(more.sourcesUsed.length, 2);
    assert.equal(more.keyRefs?.length, 1, 'block evidence never inflates the key excerpts');
    assert.equal(fold.run.usage, undefined, 'simulated runs carry no usage');
    assert.equal(fold.run.cost, undefined, 'simulated runs never invent cost');
  });

  test('is order-independent and idempotent (duplicates and replays ignored)', () => {
    const events = streamToSecondBlock();
    const shuffled = [...events].reverse();
    const duplicated = [...events, ...events.slice(5)];
    assert.deepEqual(foldRun(shuffled), foldRun(events));
    assert.deepEqual(foldRun(duplicated), foldRun(events));
  });

  test('continues from a snapshot with live deltas (attach)', () => {
    const events = streamToSecondBlock();
    const snapshot = foldRun(events.slice(0, 10));
    assert.ok(snapshot);
    const live = foldRun(events.slice(8), snapshot);
    assert.deepEqual(live, foldRun(events));
    const other = applyRunEvent(snapshot, { ...events[11], runId: 'run-other', seq: 99 });
    assert.equal(other, snapshot, 'events of another run are ignored');
  });

  test('cancel keeps the partial output, trimmed to a word boundary ("interrompida")', () => {
    const events = [...streamToSecondBlock(), event({ type: 'run.cancelled', reason: 'Parado pelo usuário' })];
    const fold = foldRun(events);
    assert.ok(fold);
    assert.equal(fold.run.status, 'cancelled');
    assert.equal(isRunActive(fold.run), false);
    assert.equal(fold.run.steps[2].state, 'skipped');
    const partial = articleBodyFromRun(fold, { includePartial: true });
    assert.equal(partial.title, 'Da garagem à feira');
    assert.deepEqual(
      partial.blocks.map((block) => [block.id, block.type === 'paragraph' ? block.inlines[0].text : '', block.ai]),
      [
        ['b1', 'O Ateliê Sul nasceu numa garagem.', 'unreviewed'],
        ['b2', 'A feira mudou', 'unreviewed'],
      ],
    );
    assert.equal(articleBodyFromRun(fold).blocks.length, 1, 'without includePartial only complete blocks');
    assert.equal(hasUsableOutput(fold), true);
  });

  test('a failure marks the step red, keeps inputs and completed blocks', () => {
    const events = [
      ...streamToSecondBlock(),
      event({ type: 'step.failed', stepId: 'write', error: { code: 'timeout', message: 'A seção 2 demorou demais.', retryable: true } }),
      event({ type: 'run.failed', error: { code: 'timeout', message: 'A seção 2 demorou demais.', retryable: true, stepId: 'write' } }),
    ];
    const fold = foldRun(events);
    assert.ok(fold);
    assert.equal(fold.run.status, 'failed');
    assert.equal(fold.run.steps[2].state, 'error');
    assert.equal(fold.run.error?.stepId, 'write');
    assert.deepEqual(fold.run.inputs, [{ kind: 'source-version', sourceId: 'src-1', sourceVersion: 1, hash: 'h' }]);
    assert.equal(articleBodyFromRun(fold).blocks[0].id, 'b1');
  });

  test('awaiting_input pauses the run until a step resumes it (R3/R4 plug)', () => {
    const events = [
      started(),
      event({ type: 'step.started', stepId: 'outline' }),
      event({ type: 'step.awaiting_input', stepId: 'outline', request: { kind: 'outline-review', message: 'Revise a estrutura.' } }),
    ];
    const paused = foldRun(events);
    assert.ok(paused);
    assert.equal(paused.run.status, 'awaiting_input');
    assert.equal(paused.awaiting?.request.kind, 'outline-review');
    assert.equal(isRunActive(paused.run), true);
    const resumed = foldRun([event({ type: 'step.completed', stepId: 'outline' })], paused);
    assert.ok(resumed);
    assert.equal(resumed.run.status, 'running');
    assert.equal(resumed.awaiting, undefined);
  });

  test('completion records output, usage when a provider reports it, and duration', () => {
    const events = [
      ...streamToSecondBlock(),
      event({ type: 'usage', usage: { inputTokens: 1200, outputTokens: 800 }, cost: { usd: 0.01, source: 'provider' } }),
      event({ type: 'run.completed', output: { kind: 'version', pieceId: 'piece-article', versionId: 'ver-1', number: 1, hash: 'x' } }),
    ];
    const fold = foldRun(events);
    assert.ok(fold);
    assert.equal(fold.run.status, 'completed');
    assert.equal(fold.run.output?.versionId, 'ver-1');
    assert.equal(fold.run.cost?.source, 'provider');
    assert.ok(fold.run.steps.every((step) => step.state !== 'current'));
    assert.equal(runDurationMs(fold.run), 15_000);
  });

  test('without run.started there is nothing to fold', () => {
    assert.equal(foldRun([{ type: 'text.delta', runId: RUN, seq: 1, at: at(1), blockId: 'b1', delta: 'x' }]), undefined);
  });
});

describe('trimToWordBoundary', () => {
  test('drops a trailing partial word but keeps finished ones', () => {
    assert.equal(trimToWordBoundary('A feira mudou tu'), 'A feira mudou');
    assert.equal(trimToWordBoundary('A feira mudou tudo.'), 'A feira mudou tudo.');
    assert.equal(trimToWordBoundary('A feira '), 'A feira');
    assert.equal(trimToWordBoundary('Palavr'), '');
    assert.equal(trimToWordBoundary(''), '');
  });
});
