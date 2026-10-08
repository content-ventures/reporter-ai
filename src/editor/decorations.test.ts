import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EditorState } from '@tiptap/pm/state';
import type { Decoration, DecorationSet } from '@tiptap/pm/view';
import { dividerBlock, figureBlock, headingBlock, paragraphBlock } from '../domain/index.ts';
import { articleDecorationInput, articleDecorationsKey, buildArticleDecorations, setArticleDecorations } from './decorations.ts';
import type { ArticleWidgetHandlers, ProseWidgetFactory } from './decorations.ts';
import { findBlockEntry, textRangeToPositions } from './ranges.ts';
import { streamKey } from './streaming.ts';
import type { StreamMeta } from './streaming.ts';
import { articleState, RICH_BODY, testView } from './test-support.ts';

type Found = { from: number; to: number; attrs: Record<string, string>; inline: boolean };

/** Decoration attributes are internal to ProseMirror; the tests read them to check the hooks. */
function found(set: DecorationSet): Found[] {
  return set.find().map((decoration: Decoration) => {
    const internal = decoration as unknown as { type: { attrs: Record<string, string> }; inline: boolean };
    return { from: decoration.from, to: decoration.to, attrs: internal.type.attrs, inline: internal.inline };
  });
}

function decorations(state: EditorState): Found[] {
  const set = articleDecorationsKey.getState(state)?.set;
  assert.ok(set);
  return found(set);
}

describe('buildArticleDecorations', () => {
  const state = articleState(RICH_BODY);
  const doc = state.doc;

  test('marks unreviewed AI blocks with data-ai and a description, never reviewed ones', () => {
    const marked = found(buildArticleDecorations(doc, { activeSourceBlockIds: [], suggestions: [], quotes: [], stale: [] }));
    const b1 = findBlockEntry(doc, 'b1');
    const b2 = findBlockEntry(doc, 'b2');
    assert.ok(b1 && b2);
    assert.deepEqual(
      marked.map((entry) => [entry.from, entry.attrs['data-ai'], entry.attrs['aria-description']]),
      [
        [b1.pos, 'unreviewed', 'Texto da IA não revisado'],
        [b2.pos, 'unreviewed', 'Texto da IA não revisado'],
      ],
    );
    assert.ok(marked.every((entry) => !entry.inline));
  });

  test('lights the text of the active source blocks with an inline span, never a block attribute', () => {
    const set = found(buildArticleDecorations(doc, { activeSourceBlockIds: ['b4'], suggestions: [], quotes: [], stale: [] }));
    const quote = findBlockEntry(doc, 'b4');
    assert.ok(quote);
    const lit = set.filter((entry) => 'data-source-active' in entry.attrs);
    assert.deepEqual(
      lit.map((entry) => [entry.from, entry.to, entry.inline]),
      [[quote.pos + 1, quote.pos + quote.node.nodeSize - 1, true]],
    );
  });

  test('a lit block keeps its suggestion target as a separate inline range', () => {
    const range = { blockId: 'b8', from: 0, to: 5 };
    const set = found(
      buildArticleDecorations(doc, { activeSourceBlockIds: ['b8'], suggestions: [{ id: 's1', ranges: [range] }], quotes: [], stale: [] }),
    ).filter((entry) => entry.inline);
    assert.deepEqual(set.map((entry) => Object.keys(entry.attrs).join()).sort(), ['data-source-active', 'data-suggestion']);
  });

  test('suggestion targets are inline delete ranges; stale ones also carry data-stale', () => {
    const range = { blockId: 'b8', from: 0, to: 5 };
    const positions = textRangeToPositions(doc, range);
    assert.ok(positions);
    const set = found(
      buildArticleDecorations(doc, {
        activeSourceBlockIds: [],
        suggestions: [
          { id: 's1', ranges: [range] },
          { id: 's2', ranges: [{ blockId: 'b3', from: 0, to: 8 }], stale: true },
        ],
        quotes: [],
        stale: [],
      }),
    ).filter((entry) => entry.inline);
    assert.deepEqual(set[1], { from: positions.from, to: positions.to, attrs: { 'data-suggestion': 'delete' }, inline: true });
    assert.deepEqual(set[0].attrs, { 'data-suggestion': 'delete', 'data-stale': '' });
  });

  test('quotations carry data-source-state; stale ranges carry data-stale; impossible ranges are skipped', () => {
    const set = found(
      buildArticleDecorations(doc, {
        activeSourceBlockIds: [],
        suggestions: [],
        quotes: [
          { range: { blockId: 'b4', from: 1, to: 10 }, state: 'used' },
          { range: { blockId: 'b1', from: 0, to: 7 }, state: 'missing' },
          { range: { blockId: 'gone', from: 0, to: 3 }, state: 'used' },
        ],
        stale: [{ blockId: 'b8', from: 0, to: 2 }, { blockId: 'b8', from: 3, to: 3 }],
      }),
    ).filter((entry) => entry.inline);
    assert.deepEqual(
      set.map((entry) => entry.attrs),
      [{ 'data-source-state': 'missing' }, { 'data-source-state': 'used' }, { 'data-stale': '' }],
    );
  });
});

describe('reviewer-pointed passages', () => {
  test('are wrapped in a <mark data-pointed> highlighter, never the stale (amber) hook', () => {
    const state = articleState(RICH_BODY);
    const set = found(
      buildArticleDecorations(state.doc, { activeSourceBlockIds: [], suggestions: [], quotes: [], stale: [], pointed: [{ blockId: 'b1', from: 0, to: 7 }] }),
    ).filter((entry) => entry.inline);
    assert.deepEqual(set.map((entry) => entry.attrs), [{ nodeName: 'mark', 'data-pointed': '' }]);
  });
});

describe('decorations plugin', () => {
  test('React sets inputs through meta, without touching the document or the history', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Texto original aqui')] }, { history: true }));
    const before = view.state.doc;
    setArticleDecorations(view, { suggestions: [{ id: 's1', ranges: [{ blockId: 'p1', from: 6, to: 14 }] }] });
    assert.equal(view.state.doc, before);
    assert.equal(view.dispatched[0].getMeta('addToHistory'), false);
    assert.equal(articleDecorationInput(view.state).suggestions.length, 1);
    assert.deepEqual(decorations(view.state).map((entry) => [entry.from, entry.to]), [[7, 15]]);
  });

  test('ranges follow the text while the person types, and vanish when the text is deleted', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Texto original aqui')] }));
    setArticleDecorations(view, { quotes: [{ range: { blockId: 'p1', from: 6, to: 14 }, state: 'used' }] });
    view.dispatch(view.state.tr.insertText('Novo ', 1));
    assert.deepEqual(decorations(view.state).map((entry) => [entry.from, entry.to]), [[12, 20]]);
    view.dispatch(view.state.tr.delete(12, 20));
    assert.deepEqual(decorations(view.state), []);
  });

  test('node hooks follow the document: AI state and lit blocks are recomputed on change', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Um', { ai: 'unreviewed' }), paragraphBlock('p2', 'Dois')] }));
    setArticleDecorations(view, { activeSourceBlockIds: ['p2'] });
    assert.equal(decorations(view.state).length, 2);
    view.dispatch(view.state.tr.setNodeAttribute(0, 'ai', 'reviewed'));
    view.dispatch(view.state.tr.insertText('Zero ', 1));
    const after = decorations(view.state);
    assert.equal(after.length, 1);
    assert.ok('data-source-active' in after[0].attrs);
    assert.equal(after[0].inline, true);
    const p2 = findBlockEntry(view.state.doc, 'p2');
    assert.ok(p2);
    assert.equal(after[0].from, p2.pos + 1);
    setArticleDecorations(view, { activeSourceBlockIds: [] });
    assert.deepEqual(decorations(view.state), []);
  });
});

describe('room for a floating bar (data-bar-space)', () => {
  test('the block a bar decides about opens room under it; clearing it closes the room', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Um'), paragraphBlock('p2', 'Dois')] }));
    setArticleDecorations(view, { barSpace: 'p1' });
    const p1 = findBlockEntry(view.state.doc, 'p1');
    assert.ok(p1);
    const room = decorations(view.state).filter((entry) => entry.attrs['data-bar-space'] === 'below');
    assert.deepEqual(room.map((entry) => [entry.from, entry.inline]), [[p1.pos, false]]);
    // It follows the block while the person types above it.
    view.dispatch(view.state.tr.insertText('Zero ', 1));
    const moved = findBlockEntry(view.state.doc, 'p1');
    assert.equal(decorations(view.state).find((entry) => entry.attrs['data-bar-space'])?.from, moved?.pos);
    setArticleDecorations(view, { barSpace: null });
    assert.equal(decorations(view.state).filter((entry) => entry.attrs['data-bar-space']).length, 0);
  });
});

type WidgetCall = { kind: 'insertion' | 'gutterMarker'; text?: string; options?: Record<string, unknown> };

/** A stand-in for the Design System `proseWidgets` (no DOM in node --test): records each call. */
function fakeWidgets(): { factory: ProseWidgetFactory; calls: WidgetCall[] } {
  const calls: WidgetCall[] = [];
  const element = () => ({}) as HTMLElement;
  return {
    calls,
    factory: {
      insertion: (text, options) => {
        calls.push({ kind: 'insertion', text, options });
        return element();
      },
      gutterMarker: (_kind, options) => {
        calls.push({ kind: 'gutterMarker', options });
        return element();
      },
    },
  };
}

type Widget = { pos: number; key: string; side: number; render: () => void };

/** Widget decorations (internal shape read by the tests): position, key, side and their DOM factory. */
function widgets(set: DecorationSet): Widget[] {
  return set
    .find()
    .filter((decoration) => decoration.from === decoration.to)
    .map((decoration) => {
      const internal = decoration as unknown as { type: { toDOM: (view: unknown, pos: () => number) => unknown; side: number } };
      return { pos: decoration.from, key: decoration.spec.key as string, side: internal.type.side, render: () => void internal.type.toDOM(null, () => decoration.from) };
    });
}

const EMPTY = { activeSourceBlockIds: [], suggestions: [], quotes: [], stale: [] };

describe('Design System widgets (proseWidgets, handed in by the client)', () => {
  const body = {
    blocks: [
      paragraphBlock('p1', 'Na verdade o limite é o custo.', { ai: 'unreviewed' }),
      headingBlock('h1', 'Seção', 2, { ai: 'unreviewed' }),
      figureBlock('f1', { assetId: 'ast-1' }, { ai: 'unreviewed' }),
      dividerBlock('d1'),
      paragraphBlock('p2', 'Revisado.', { ai: 'reviewed' }),
    ],
  };
  const state = articleState(body);

  test('the AI gutter marker sits at the start of each unreviewed text block, never on images or rules', () => {
    const { factory, calls } = fakeWidgets();
    const activated: string[] = [];
    const handlers: ArticleWidgetHandlers = { onAiMarker: (blockId) => activated.push(blockId) };
    const set = buildArticleDecorations(state.doc, EMPTY, { widgets: factory, handlers: () => handlers });
    const markers = widgets(set);
    const p1 = findBlockEntry(state.doc, 'p1');
    const h1 = findBlockEntry(state.doc, 'h1');
    assert.ok(p1 && h1);
    assert.deepEqual(
      markers.map((entry) => [entry.pos, entry.key, entry.side]),
      [
        [p1.pos + 1, 'ai:p1', -1],
        [h1.pos + 1, 'ai:h1', -1],
      ],
    );
    // The figure keeps the attribute-only marker of the Prose.
    assert.ok(found(set).some((entry) => entry.attrs?.['data-ai'] === 'unreviewed' && entry.from === findBlockEntry(state.doc, 'f1')?.pos));
    markers[1].render();
    assert.equal(calls[0].kind, 'gutterMarker');
    (calls[0].options?.onActivate as (event: Event) => void)({} as Event);
    assert.deepEqual(activated, ['h1']);
  });

  test('a suggestion reads in the paragraph: struck words, then the factory insertion after them', () => {
    const { factory, calls } = fakeWidgets();
    const set = buildArticleDecorations(
      state.doc,
      {
        ...EMPTY,
        suggestions: [
          { id: 's1', ranges: [{ blockId: 'p1', from: 0, to: 13 }], insertions: [{ blockId: 'p1', offset: 13, text: 'O' }] },
          { id: 's2', ranges: [], insertions: [{ blockId: 'p1', offset: 400, text: 'proposta antiga' }], stale: true },
        ],
      },
      { widgets: factory },
    );
    const p1 = findBlockEntry(state.doc, 'p1');
    assert.ok(p1);
    const inserted = widgets(set).filter((entry) => entry.key.startsWith('ins:'));
    // The stale one is clamped to the end of the paragraph's text.
    assert.deepEqual(
      inserted.map((entry) => [entry.pos, entry.side]),
      [
        [p1.pos + 1 + 13, 1],
        [p1.pos + 1 + 'Na verdade o limite é o custo.'.length, 1],
      ],
    );
    for (const entry of inserted) entry.render();
    assert.deepEqual(
      calls.map((call) => [call.text, call.options?.stale ?? false]),
      [
        ['O', false],
        ['proposta antiga', true],
      ],
    );
    const struck = found(set).filter((entry) => entry.inline && entry.attrs['data-suggestion'] === 'delete');
    assert.equal(struck.length, 1, 'a stale suggestion strikes nothing');
  });

  test('without the factory, suggestions and AI blocks are attributes only', () => {
    const set = buildArticleDecorations(state.doc, { ...EMPTY, suggestions: [{ id: 's1', ranges: [], insertions: [{ blockId: 'p1', offset: 2, text: 'x' }] }] });
    assert.deepEqual(widgets(set), []);
  });

  test('while a generation writes, only the block being written is marked', () => {
    const { factory } = fakeWidgets();
    const set = buildArticleDecorations(state.doc, EMPTY, { widgets: factory, writing: ['p1', 'h1'] });
    const marked = found(set).filter((entry) => entry.attrs && 'data-ai' in entry.attrs);
    assert.deepEqual(
      marked.map((entry) => [entry.from, entry.attrs['data-ai']]),
      [[findBlockEntry(state.doc, 'h1')?.pos, 'writing']],
    );
    assert.deepEqual(widgets(set), []);
  });

  test('the plugin follows the stream: markers pause while it writes and come back when it ends', () => {
    const { factory } = fakeWidgets();
    const view = testView(articleState(body, { decorations: { widgets: factory } }));
    const meta = (type: StreamMeta['type'], inFlight: string[]): StreamMeta => ({ type, runId: 'run-1', mode: 'append', inFlight, owned: inFlight });
    const aiStates = () => decorations(view.state).filter((entry) => entry.attrs && 'data-ai' in entry.attrs).map((entry) => entry.attrs['data-ai']);
    assert.deepEqual(aiStates(), ['unreviewed', 'unreviewed', 'unreviewed']);
    view.dispatch(view.state.tr.setMeta(streamKey, meta('begin', ['p1'])));
    assert.deepEqual(aiStates(), ['writing']);
    view.dispatch(view.state.tr.setMeta(streamKey, meta('sync', [])));
    assert.deepEqual(aiStates(), []);
    view.dispatch(view.state.tr.setMeta(streamKey, meta('end', [])));
    assert.deepEqual(aiStates(), ['unreviewed', 'unreviewed', 'unreviewed']);
  });
});
