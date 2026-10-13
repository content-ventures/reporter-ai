import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { blockText, sliceText } from '../domain/index.ts';
import { articleSchema } from './extensions.ts';
import { articleDocNode } from './nodes.ts';
import {
  blockEntries,
  blockTextOf,
  findBlockEntry,
  offsetToPos,
  posToBlockOffset,
  posToOffset,
  positionsToTextRanges,
  textRangeToPositions,
} from './ranges.ts';
import { RICH_BODY } from './test-support.ts';

const schema = articleSchema();
const doc = articleDocNode(schema, RICH_BODY);

/** Text between two positions with the same conventions as `blockText`. */
function textAt(from: number, to: number): string {
  return doc.textBetween(from, to, '\n', (leaf) => (leaf.type.name === 'hardBreak' ? '\n' : ''));
}

describe('block text', () => {
  test('matches the domain blockText for every block type', () => {
    for (const block of RICH_BODY.blocks) {
      const entry = findBlockEntry(doc, block.id);
      assert.ok(entry, block.id);
      assert.equal(blockTextOf(entry.node), blockText(block), block.id);
    }
  });

  test('lists every top-level block with its index and id', () => {
    assert.deepEqual(
      blockEntries(doc).map((entry) => [entry.index, entry.id]),
      RICH_BODY.blocks.map((block, index) => [index, block.id]),
    );
  });
});

describe('text ranges ⇄ positions', () => {
  test('every range maps to positions whose text equals the domain slice', () => {
    for (const block of RICH_BODY.blocks) {
      const length = blockText(block).length;
      for (let from = 0; from <= length; from += 1) {
        for (let to = from; to <= length; to += 1) {
          const range = { blockId: block.id, from, to };
          const positions = textRangeToPositions(doc, range);
          assert.ok(positions, `${block.id} ${from}-${to}`);
          assert.equal(textAt(positions.from, positions.to), sliceText(RICH_BODY, range), `${block.id} ${from}-${to}`);
        }
      }
    }
  });

  test('offset → position → offset is the identity inside each block', () => {
    for (const entry of blockEntries(doc)) {
      const length = blockTextOf(entry.node).length;
      for (let offset = 0; offset <= length; offset += 1) {
        const pos = offsetToPos(entry, offset);
        assert.equal(posToOffset(entry, pos), offset, `${entry.id} @${offset}`);
        assert.deepEqual(posToBlockOffset(doc, pos), { blockId: entry.id, index: entry.index, offset });
      }
    }
  });

  test('rejects unknown blocks and offsets past the text', () => {
    assert.equal(textRangeToPositions(doc, { blockId: 'nope', from: 0, to: 1 }), undefined);
    assert.equal(textRangeToPositions(doc, { blockId: 'b8', from: 0, to: 99 }), undefined);
    assert.equal(textRangeToPositions(doc, { blockId: 'b8', from: 3, to: 2 }), undefined);
    assert.equal(posToBlockOffset(doc, -1), undefined);
  });

  test('a list range can span items, with the item separator counted once', () => {
    const range = { blockId: 'b5', from: 1, to: 6 };
    const positions = textRangeToPositions(doc, range);
    assert.ok(positions);
    assert.equal(textAt(positions.from, positions.to), 'm\ndoi');
    assert.equal(sliceText(RICH_BODY, range), 'm\ndoi');
  });
});

describe('positions → text ranges', () => {
  test('splits a selection across blocks, skipping dividers', () => {
    const quote = findBlockEntry(doc, 'b4');
    const last = findBlockEntry(doc, 'b8');
    assert.ok(quote && last);
    const ranges = positionsToTextRanges(doc, quote.pos + 3, last.pos + 4);
    assert.deepEqual(
      ranges.map((range) => range.blockId),
      ['b4', 'b5', 'b6', 'b8'],
    );
    assert.deepEqual(ranges[0], { blockId: 'b4', from: 2, to: blockTextOf(quote.node).length });
    assert.deepEqual(ranges[3], { blockId: 'b8', from: 0, to: 3 });
  });

  test('a selection that only reaches the start of the next block does not include it', () => {
    const heading = findBlockEntry(doc, 'b2');
    const next = findBlockEntry(doc, 'b3');
    assert.ok(heading && next);
    const ranges = positionsToTextRanges(doc, heading.pos + 1, next.pos + 1);
    assert.deepEqual(ranges, [{ blockId: 'b2', from: 0, to: blockTextOf(heading.node).length }]);
  });

  test('a caret gives one empty range in its block', () => {
    const entry = findBlockEntry(doc, 'b3');
    assert.ok(entry);
    assert.deepEqual(positionsToTextRanges(doc, entry.pos + 4, entry.pos + 4), [{ blockId: 'b3', from: 3, to: 3 }]);
  });
});
