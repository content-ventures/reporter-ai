import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { undo } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { DecorationSet } from '@tiptap/pm/view';
import { applyRunEvent, articleBodyFromRun, articleHash, foldRun, headingBlock, paragraphBlock, SIMULATED_MODEL } from '../domain/index.ts';
import type { ArticleBlock, RunEvent, RunEventPayload, RunFold, RunKind } from '../domain/index.ts';
import { docBody } from './nodes.ts';
import { blockEntries, blockTextOf, findBlockEntry } from './ranges.ts';
import { applyRunUpdateToEditor, isStreaming, settleRunInEditor, streamKey, streamState, syncRunSnapshotInEditor } from './streaming.ts';
import type { StreamMode } from './streaming.ts';
import { suggestionTransaction } from './suggestions.ts';
import { articleState, REF_A, REF_B, runEvents, testView } from './test-support.ts';
import type { TestView } from './test-support.ts';

const FINAL_1 = paragraphBlock('g1', [{ text: 'Olá ' }, { text: 'mundo', marks: ['bold'] }, { text: ' novo.' }], { ai: 'unreviewed', sourceRefs: [REF_A] });
const FINAL_2 = headingBlock('g2', 'Seção um', 2, { ai: 'unreviewed' });
const FINAL_3 = paragraphBlock('g3', 'Texto da seção com várias palavras.', { ai: 'unreviewed', sourceRefs: [REF_B] });

function started(kind: RunKind = 'article.generate'): RunEventPayload {
  return {
    type: 'run.started',
    kind,
    productionId: 'prod-1',
    pieceId: 'piece-1',
    prompt: { key: 'article.draft', version: '1', hash: 'h' },
    model: SIMULATED_MODEL,
    inputs: [],
    steps: [{ id: 'intro', label: 'Introdução' }],
    createdBy: 'joao',
  };
}

function stream(block: ArticleBlock, deltas: string[], complete = true): RunEventPayload[] {
  const shape =
    block.type === 'heading' ? { id: block.id, type: block.type, level: block.level } : { id: block.id, type: block.type };
  return [
    { type: 'block.started', block: shape },
    ...deltas.map((delta): RunEventPayload => ({ type: 'text.delta', blockId: block.id, delta })),
    ...(complete ? [{ type: 'block.completed', block } as RunEventPayload] : []),
  ];
}

const FULL_RUN: RunEventPayload[] = [
  started(),
  ...stream(FINAL_1, ['Olá ', 'mundo', ' novo.']),
  ...stream(FINAL_2, ['Seção ', 'um']),
  ...stream(FINAL_3, ['Texto da ', 'seção com ', 'várias palavras.']),
  { type: 'run.completed' },
];

/** Feeds events one by one, as `useRunListener` would, and returns the fold. */
function play(view: TestView, events: readonly RunEvent[], mode?: StreamMode): RunFold {
  let fold = foldRun([events[0]]);
  assert.ok(fold);
  for (const event of events.slice(1)) {
    fold = applyRunEvent(fold, event);
    applyRunUpdateToEditor(view, { event, fold }, mode ? { mode } : {});
  }
  return fold;
}

function streamingDecorations(state: EditorState) {
  const plugin = streamKey.get(state);
  assert.ok(plugin?.props.decorations);
  const set = plugin.props.decorations.call(plugin, state) as DecorationSet;
  return set.find().map((decoration) => ({ from: decoration.from, attrs: (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs }));
}

function texts(state: EditorState): string[] {
  return blockEntries(state.doc).map((entry) => blockTextOf(entry.node));
}

describe('streaming a draft into the editor', () => {
  test('a blank document ends exactly equal to "v1 · IA" (blocks, marks, sourceRefs, hash)', () => {
    const view = testView(articleState({ blocks: [] }));
    const fold = play(view, runEvents('run-1', FULL_RUN));
    const v1 = articleBodyFromRun(fold);
    assert.deepEqual(docBody(view.state.doc), v1);
    assert.equal(articleHash(docBody(view.state.doc)), articleHash(v1));
    assert.equal(isStreaming(view.state), false);
  });

  test('stream transactions stay out of the undo history and never emit an update', () => {
    const view = testView(articleState({ blocks: [] }, { history: true }));
    play(view, runEvents('run-1', FULL_RUN));
    const streamed = view.dispatched.filter((tr) => tr.docChanged);
    assert.ok(streamed.length > 5);
    assert.ok(streamed.every((tr) => tr.getMeta('addToHistory') === false && tr.getMeta('preventUpdate') === true));
    assert.equal(undo(view.state), false);
  });

  test('while a block streams it is read-only, busy and marked as AI', () => {
    const view = testView(articleState({ blocks: [] }));
    const events = runEvents('run-1', [started(), ...stream(FINAL_1, ['Olá ', 'mundo'], false)]);
    play(view, events);
    const entry = findBlockEntry(view.state.doc, 'g1');
    assert.ok(entry);
    assert.equal(blockTextOf(entry.node), 'Olá mundo');
    assert.equal(entry.node.attrs.ai, 'unreviewed');
    assert.deepEqual(streamState(view.state).inFlight, ['g1']);
    assert.deepEqual(streamingDecorations(view.state), [{ from: entry.pos, attrs: { contenteditable: 'false', 'aria-busy': 'true' } }]);

    const before = view.state;
    view.dispatch(view.state.tr.insertText('X', entry.pos + 3));
    assert.equal(view.state, before, 'typing inside the streaming block is dropped');
    view.dispatch(view.state.tr.addMark(entry.pos + 1, entry.pos + 4, view.state.schema.marks.bold.create()));
    assert.equal(view.state, before, 'formatting the streaming block is dropped');
    view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
    assert.equal(view.state, before, 'deleting across the streaming block is dropped');
  });

  test('the person keeps writing elsewhere: caret untouched, edits kept, ⌘Z only undoes them', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('u1', 'Minha nota')] }, { history: true }));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
    const events = runEvents('run-1', FULL_RUN);
    let fold = foldRun([events[0]]);
    assert.ok(fold);
    for (const [index, event] of events.slice(1).entries()) {
      fold = applyRunEvent(fold, event);
      applyRunUpdateToEditor(view, { event, fold });
      assert.equal(view.state.selection.from, index < 4 ? 6 : 7, `caret after event ${index}`);
      if (index === 3) {
        view.dispatch(view.state.tr.insertText('!'));
        assert.equal(streamState(view.state).edited, true);
      }
    }
    assert.deepEqual(texts(view.state), ['Minha! nota', 'Olá mundo novo.', 'Seção um', 'Texto da seção com várias palavras.']);
    assert.ok(undo(view.state, view.dispatch));
    assert.deepEqual(texts(view.state), ['Minha nota', 'Olá mundo novo.', 'Seção um', 'Texto da seção com várias palavras.']);
    assert.equal(undo(view.state), false);
  });

  test('finished blocks are editable at once', () => {
    const view = testView(articleState({ blocks: [] }));
    play(view, runEvents('run-1', [started(), ...stream(FINAL_1, ['Olá ', 'mundo', ' novo.']), ...stream(FINAL_3, ['Texto'], false)]));
    const done = findBlockEntry(view.state.doc, 'g1');
    assert.ok(done);
    view.dispatch(view.state.tr.insertText('Oi, ', done.pos + 1));
    assert.equal(blockTextOf(view.state.doc.child(0)), 'Oi, Olá mundo novo.');
  });

  test('"Gerar nova versão" (replace) keeps the old text until the first block arrives', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('old', 'Rascunho antigo')] }));
    const events = runEvents('run-2', FULL_RUN);
    let fold = foldRun([events[0]]);
    assert.ok(fold);
    fold = applyRunEvent(fold, events[1]);
    assert.ok(applyRunUpdateToEditor(view, { event: events[1], fold }, { mode: 'replace' }));
    assert.deepEqual(texts(view.state), ['']);
    for (const event of events.slice(2)) {
      fold = applyRunEvent(fold, event);
      applyRunUpdateToEditor(view, { event, fold }, { mode: 'replace' });
    }
    assert.deepEqual(docBody(view.state.doc), articleBodyFromRun(fold));
  });

  test('an interrupted run keeps its partial text cut at a word boundary ("v1 · interrompida")', () => {
    const view = testView(articleState({ blocks: [] }));
    const fold = play(view, runEvents('run-1', [started(), ...stream(FINAL_1, ['Olá ', 'mundo', ' novo.']), ...stream(FINAL_3, ['Texto da ', 'seção com vár'], false), { type: 'run.cancelled' }]));
    const partial = articleBodyFromRun(fold, { includePartial: true });
    assert.deepEqual(docBody(view.state.doc), partial);
    assert.equal(blockTextOf(view.state.doc.child(1)), 'Texto da seção com');
    assert.equal(isStreaming(view.state), false);
  });

  test('a failed run drops the unfinished block and keeps the finished ones', () => {
    const view = testView(articleState({ blocks: [] }));
    const fold = play(view, runEvents('run-1', [started(), ...stream(FINAL_1, ['Olá ', 'mundo', ' novo.']), ...stream(FINAL_3, ['Texto da '], false), { type: 'run.failed', error: { code: 'simulated', message: 'Falhou', retryable: true } }]));
    assert.deepEqual(docBody(view.state.doc), articleBodyFromRun(fold));
    assert.deepEqual(texts(view.state), ['Olá mundo novo.']);
  });

  test('attaching mid-run inserts every known block in order and keeps writing the open one', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('u1', 'Antes')] }));
    const events = runEvents('run-1', [started(), ...stream(FINAL_1, ['Olá ', 'mundo', ' novo.']), ...stream(FINAL_2, ['Seção um']), ...stream(FINAL_3, ['Texto da '], false), { type: 'step.progress', stepId: 'intro', meta: 'seção 2' }]);
    const fold = foldRun(events);
    assert.ok(fold);
    applyRunUpdateToEditor(view, { event: events[events.length - 1], fold });
    assert.deepEqual(texts(view.state), ['Antes', 'Olá mundo novo.', 'Seção um', 'Texto da ']);
    assert.deepEqual(streamState(view.state).inFlight, ['g3']);
  });

  test('a new block lands after the previous streamed block, before the empty caret paragraph', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('u1', 'Antes'), paragraphBlock('caret', '')] }));
    play(view, runEvents('run-1', FULL_RUN));
    assert.deepEqual(
      blockEntries(view.state.doc).map((entry) => entry.id),
      ['u1', 'g1', 'g2', 'g3', 'caret'],
    );
  });

  test('a retry never overwrites a finished block the person already edited', () => {
    const view = testView(articleState({ blocks: [] }));
    play(view, runEvents('run-1', FULL_RUN));
    view.dispatch(view.state.tr.insertText('Editado: ', 1));
    const final4 = paragraphBlock('g4', 'Bloco novo.', { ai: 'unreviewed' });
    play(view, runEvents('run-3', [started(), ...stream(FINAL_1, [], true), ...stream(FINAL_2, [], true), ...stream(FINAL_3, [], true), ...stream(final4, ['Bloco ', 'novo.']), { type: 'run.completed' }]));
    assert.deepEqual(texts(view.state), ['Editado: Olá mundo novo.', 'Seção um', 'Texto da seção com várias palavras.', 'Bloco novo.']);
  });

  test('a snapshot of a finished run settles in one go', () => {
    const view = testView(articleState({ blocks: [] }));
    const fold = foldRun(runEvents('run-1', FULL_RUN));
    assert.ok(fold);
    assert.ok(settleRunInEditor(view, fold));
    assert.deepEqual(docBody(view.state.doc), articleBodyFromRun(fold));
    assert.equal(isStreaming(view.state), false);
  });

  test('a finished block the person deletes while the run goes on stays deleted', () => {
    const view = testView(articleState({ blocks: [] }));
    const events = runEvents('run-1', FULL_RUN);
    let fold = foldRun([events[0]]);
    assert.ok(fold);
    for (const event of events.slice(1)) {
      fold = applyRunEvent(fold, event);
      applyRunUpdateToEditor(view, { event, fold });
      const g1 = findBlockEntry(view.state.doc, 'g1');
      if (event.type === 'block.started' && event.block.id === 'g2' && g1) view.dispatch(view.state.tr.delete(g1.pos, g1.pos + g1.node.nodeSize));
    }
    assert.deepEqual(texts(view.state), ['Seção um', 'Texto da seção com várias palavras.']);
    assert.equal(isStreaming(view.state), false);
  });

  test('a missed block.completed never leaves a block read-only: the next event settles it', () => {
    const view = testView(articleState({ blocks: [] }));
    const events = runEvents('run-1', FULL_RUN);
    let fold = foldRun([events[0]]);
    assert.ok(fold);
    for (const event of events.slice(1)) {
      fold = applyRunEvent(fold, event);
      if (event.type === 'block.completed' && event.block.id === 'g1') continue;
      applyRunUpdateToEditor(view, { event, fold });
      if (event.type === 'block.started' && event.block.id === 'g2') {
        assert.deepEqual(streamState(view.state).inFlight, ['g2']);
        assert.deepEqual(docBody(view.state.doc).blocks[0], FINAL_1);
      }
    }
    assert.deepEqual(docBody(view.state.doc), articleBodyFromRun(fold));
  });

  test('the attach snapshot: a live run is brought in, a settled run never re-inserts what the person deleted', () => {
    const live = runEvents('run-1', [started(), ...stream(FINAL_1, ['Olá ', 'mundo', ' novo.']), ...stream(FINAL_3, ['Texto da '], false)]);
    const liveFold = foldRun(live);
    assert.ok(liveFold);
    const view = testView(articleState({ blocks: [] }));
    assert.ok(syncRunSnapshotInEditor(view, liveFold));
    assert.deepEqual(texts(view.state), ['Olá mundo novo.', 'Texto da ']);
    assert.deepEqual(streamState(view.state).inFlight, ['g3']);

    const done = foldRun(runEvents('run-1', FULL_RUN));
    assert.ok(done);
    assert.ok(syncRunSnapshotInEditor(view, done), 'settles the stream it was showing');
    assert.equal(isStreaming(view.state), false);

    const settled = testView(articleState({ blocks: [paragraphBlock('g2b', 'Rascunho já salvo')] }));
    assert.equal(syncRunSnapshotInEditor(settled, done), false);
    assert.deepEqual(texts(settled.state), ['Rascunho já salvo']);
  });

  test('a suggestion on a block still being written is refused', () => {
    const view = testView(articleState({ blocks: [] }));
    play(view, runEvents('run-1', [started(), ...stream(FINAL_1, ['Olá ', 'mundo'], false)]));
    const result = suggestionTransaction(view.state, {
      id: 'sug-1',
      runId: 'run-a',
      pieceId: 'piece-1',
      baseRevision: 1,
      target: [{ blockId: 'g1', from: 0, to: 3 }],
      anchorText: ['Olá'],
      proposal: { kind: 'replace-text', text: 'Oi' },
      state: 'ready',
      createdAt: '2026-10-07T12:00:00.000Z',
    });
    assert.equal(result.ok ? '' : result.refusal.code, 'streaming');
  });

  test('runs that do not write the article are ignored', () => {
    const view = testView(articleState({ blocks: [] }));
    const events = runEvents('run-9', [started('article.assist'), ...stream(FINAL_1, ['Olá'])]);
    const fold = foldRun(events);
    assert.ok(fold);
    assert.equal(applyRunUpdateToEditor(view, { event: events[events.length - 1], fold }), false);
    assert.deepEqual(texts(view.state), ['']);
  });
});
