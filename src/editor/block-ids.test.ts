import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EditorState } from '@tiptap/pm/state';
import { findWrapping, liftTarget } from '@tiptap/pm/transform';
import { listBlock, paragraphBlock } from '../domain/index.ts';
import { blockIdFixes, createBlockIdFactory, ensureBlockIds } from './block-ids.ts';
import { articleSchema } from './extensions.ts';
import { docBody } from './nodes.ts';
import { blockEntries, blockTextOf, findBlockEntry } from './ranges.ts';
import { articleState, REF_A, testView } from './test-support.ts';

const schema = articleSchema();

function ids(state: EditorState): (string | null)[] {
  return blockEntries(state.doc).map((entry) => entry.id);
}

describe('createBlockIdFactory', () => {
  test('prefix, per-editor salt and counter', () => {
    const next = createBlockIdFactory({ salt: 'abc123' });
    assert.equal(next(), 'blk-abc123-1');
    assert.equal(next(), 'blk-abc123-2');
    const random = createBlockIdFactory();
    assert.match(random(), /^blk-[0-9a-z]{6}-1$/);
  });
});

describe('block id plugin', () => {
  test('gives a new block an id and leaves the others alone', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Um'), paragraphBlock('p2', 'Dois')] }));
    const end = view.state.doc.content.size;
    view.dispatch(view.state.tr.insert(end, schema.nodes.paragraph.create(null, schema.text('Três'))));
    assert.deepEqual(ids(view.state), ['p1', 'p2', 'blk-test01-1']);
  });

  test('a split in the middle keeps the id on the first half; the second half is a new block with the same provenance', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Olá mundo', { ai: 'unreviewed', sourceRefs: [REF_A] })] }));
    view.dispatch(view.state.tr.split(1 + 4));
    const [first, second] = blockEntries(view.state.doc);
    assert.equal(first.id, 'p1');
    assert.equal(blockTextOf(first.node), 'Olá ');
    assert.notEqual(second.id, 'p1');
    assert.equal(second.node.attrs.ai, 'unreviewed');
    assert.deepEqual(second.node.attrs.sourceRefs, [REF_A]);
  });

  test('Enter at the start of a block keeps the id on the text, and the empty block carries no AI state', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Texto', { ai: 'unreviewed', sourceRefs: [REF_A] })] }));
    view.dispatch(view.state.tr.split(1));
    const [empty, text] = blockEntries(view.state.doc);
    assert.equal(text.id, 'p1');
    assert.equal(blockTextOf(text.node), 'Texto');
    assert.notEqual(empty.id, 'p1');
    assert.equal(empty.node.attrs.ai, null);
    assert.equal(empty.node.attrs.sourceRefs, null);
  });

  test('a pasted copy of a block gets a new id; the original keeps its own', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Original'), paragraphBlock('p2', 'Outro')] }));
    const original = view.state.doc.child(0);
    view.dispatch(view.state.tr.insert(0, original.copy(original.content)));
    const entries = blockEntries(view.state.doc);
    assert.deepEqual(
      entries.map((entry) => [entry.id === 'p1', blockTextOf(entry.node)]),
      [
        [false, 'Original'],
        [true, 'Original'],
        [false, 'Outro'],
      ],
    );
    assert.equal(new Set(ids(view.state)).size, 3);
  });

  test('wrapping a paragraph in a list moves its identity to the list', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Item', { ai: 'unreviewed', sourceRefs: [REF_A] })] }));
    const $from = view.state.doc.resolve(1);
    const range = $from.blockRange();
    assert.ok(range);
    const wrapping = findWrapping(range, schema.nodes.bulletList);
    assert.ok(wrapping);
    view.dispatch(view.state.tr.wrap(range, wrapping));
    const list = view.state.doc.child(0);
    assert.equal(list.type.name, 'bulletList');
    assert.equal(list.attrs.blockId, 'p1');
    assert.equal(list.attrs.ai, 'unreviewed');
    assert.deepEqual(list.attrs.sourceRefs, [REF_A]);
    const inner = list.child(0).child(0);
    assert.deepEqual([inner.attrs.blockId, inner.attrs.ai, inner.attrs.sourceRefs], [null, null, null]);
    assert.deepEqual(docBody(view.state.doc).blocks, [{ id: 'p1', type: 'list', ordered: false, items: [[{ text: 'Item' }]], ai: 'unreviewed', sourceRefs: [REF_A] }]);
  });

  test('a restyle that resets attributes (clearNodes + setBlockType) keeps id, AI state and sources', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p0', 'Antes'), paragraphBlock('p1', 'Texto da IA', { ai: 'unreviewed', sourceRefs: [REF_A] })] }));
    const p1 = findBlockEntry(view.state.doc, 'p1');
    assert.ok(p1);
    // What TipTap's `clearNodes().setHeading()` does: markup with default attributes, then the new type.
    const tr = view.state.tr.setNodeMarkup(p1.pos, schema.nodes.paragraph);
    tr.setBlockType(p1.pos + 1, p1.pos + 1, schema.nodes.heading, { level: 2 });
    view.dispatch(tr);
    const heading = view.state.doc.child(1);
    assert.equal(heading.type.name, 'heading');
    assert.deepEqual([heading.attrs.blockId, heading.attrs.ai, heading.attrs.sourceRefs], ['p1', 'unreviewed', [REF_A]]);
    assert.deepEqual(ids(view.state), ['p0', 'p1']);
  });

  test('Enter at the end of a block (TipTap splits with reset attributes) gives the new block a fresh, clean identity', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Texto', { ai: 'unreviewed', sourceRefs: [REF_A] }), paragraphBlock('p2', 'Depois')] }));
    const p1 = findBlockEntry(view.state.doc, 'p1');
    assert.ok(p1);
    const end = p1.pos + p1.node.nodeSize - 1;
    view.dispatch(view.state.tr.split(end, 1, [{ type: schema.nodes.paragraph, attrs: {} }]));
    const [first, created, last] = blockEntries(view.state.doc);
    assert.deepEqual([first.id, last.id], ['p1', 'p2']);
    assert.equal(created.id, 'blk-test01-1');
    assert.deepEqual([created.node.attrs.ai, created.node.attrs.sourceRefs], [null, null]);
  });

  test('lifting the items out of a list: the first takes the list identity, the others keep its provenance', () => {
    const view = testView(articleState({ blocks: [listBlock('l1', ['um', 'dois'], false, { ai: 'unreviewed', sourceRefs: [REF_A] })] }));
    const list = view.state.doc.child(0);
    // TipTap `clearNodes` ("Texto" in Estilo ▾): each paragraph is re-marked and lifted out.
    const tr = view.state.tr;
    view.state.doc.nodesBetween(3, list.nodeSize - 3, (node, pos) => {
      if (node.type.isText) return;
      const range = tr.doc.resolve(tr.mapping.map(pos)).blockRange(tr.doc.resolve(tr.mapping.map(pos + node.nodeSize)));
      if (!range) return;
      const target = liftTarget(range);
      if (node.isTextblock) tr.setNodeMarkup(range.start, schema.nodes.paragraph);
      if (target !== null) tr.lift(range, target);
    });
    view.dispatch(tr);
    const blocks = docBody(view.state.doc).blocks;
    assert.deepEqual(
      blocks.map((block) => [block.type, block.id === 'l1', block.ai, block.sourceRefs]),
      [
        ['paragraph', true, 'unreviewed', [REF_A]],
        ['paragraph', false, 'unreviewed', [REF_A]],
      ],
    );
  });

  test('text pasted over a deleted block takes its place but not its AI state or sources', () => {
    const view = testView(articleState({ blocks: [paragraphBlock('p1', 'Da IA', { ai: 'unreviewed', sourceRefs: [REF_A] }), paragraphBlock('p2', 'Outro')] }));
    const p1 = findBlockEntry(view.state.doc, 'p1');
    assert.ok(p1);
    view.dispatch(view.state.tr.replaceWith(p1.pos, p1.pos + p1.node.nodeSize, schema.nodes.paragraph.create(null, schema.text('Colado'))));
    const pasted = view.state.doc.child(0);
    assert.equal(blockTextOf(pasted), 'Colado');
    assert.deepEqual([pasted.attrs.ai, pasted.attrs.sourceRefs], [null, null]);
    assert.equal(new Set(ids(view.state)).size, 2);
  });

  test('never hands out an id that is already in the document', () => {
    let calls = 0;
    const newId = () => (calls++ === 0 ? 'p1' : 'fresh');
    const doc = schema.nodeFromJSON({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'p1' }, content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    });
    assert.deepEqual(blockIdFixes(doc, { newId }), [{ pos: 3, attrs: { blockId: 'fresh' } }]);
  });
});

describe('ensureBlockIds', () => {
  test('fills missing ids outside the undo history and without an update', () => {
    const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'heading', attrs: { level: 2 } }] });
    const state = EditorState.create({ schema, doc });
    const tr = ensureBlockIds(state, createBlockIdFactory({ salt: 'zzzzzz' }));
    assert.ok(tr);
    assert.equal(tr.getMeta('addToHistory'), false);
    assert.equal(tr.getMeta('preventUpdate'), true);
    const next = state.apply(tr);
    assert.deepEqual(ids(next), ['blk-zzzzzz-1', 'blk-zzzzzz-2']);
    assert.equal(ensureBlockIds(next, createBlockIdFactory()), null);
  });

  test('a loaded article keeps its ids', () => {
    const state = articleState({ blocks: [paragraphBlock('p1', 'a')] });
    assert.equal(ensureBlockIds(state, createBlockIdFactory()), null);
    assert.ok(findBlockEntry(state.doc, 'p1'));
  });
});
