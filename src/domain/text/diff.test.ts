import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commonLength, diffSequence, diffTokens, diffWords, wordSimilarity } from './diff.ts';
import type { DiffHunk, SeqOp } from './diff.ts';

function apply<T>(a: readonly T[], b: readonly T[], ops: SeqOp[]): { before: T[]; after: T[] } {
  const before: T[] = [];
  const after: T[] = [];
  for (const op of ops) {
    if (op.kind !== 'insert') before.push(...a.slice(op.aStart, op.aStart + op.length));
    if (op.kind !== 'delete') after.push(...b.slice(op.bStart, op.bStart + op.length));
    if (op.kind === 'equal') assert.deepEqual(a.slice(op.aStart, op.aStart + op.length), b.slice(op.bStart, op.bStart + op.length));
  }
  return { before, after };
}

function rebuild(hunks: DiffHunk[]): { before: string; after: string } {
  return {
    before: hunks.filter((hunk) => hunk.kind !== 'insert').map((hunk) => hunk.text).join(''),
    after: hunks.filter((hunk) => hunk.kind !== 'delete').map((hunk) => hunk.text).join(''),
  };
}

/** Small deterministic PRNG for property-style checks. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('diffSequence (Myers)', () => {
  test('finds the minimal edit script on the classic example', () => {
    const a = [...'ABCABBA'];
    const b = [...'CBABAC'];
    const ops = diffSequence(a, b);
    const edits = ops.filter((op) => op.kind !== 'equal').reduce((total, op) => total + op.length, 0);
    assert.equal(edits, 5);
    assert.equal(commonLength(a, b), 4);
    assert.deepEqual(apply(a, b, ops), { before: a, after: b });
  });

  test('handles empty inputs and identical inputs', () => {
    assert.deepEqual(diffSequence([], []), []);
    assert.deepEqual(diffSequence([], [1, 2]), [{ kind: 'insert', aStart: 0, bStart: 0, length: 2 }]);
    assert.deepEqual(diffSequence([1, 2], []), [{ kind: 'delete', aStart: 0, bStart: 0, length: 2 }]);
    assert.deepEqual(diffSequence([1, 2, 3], [1, 2, 3]), [{ kind: 'equal', aStart: 0, bStart: 0, length: 3 }]);
  });

  test('always reconstructs both sides (randomised)', () => {
    const random = prng(42);
    for (let round = 0; round < 200; round += 1) {
      const a = Array.from({ length: Math.floor(random() * 30) }, () => Math.floor(random() * 5));
      const b = Array.from({ length: Math.floor(random() * 30) }, () => Math.floor(random() * 5));
      const ops = diffSequence(a, b);
      assert.deepEqual(apply(a, b, ops), { before: a, after: b });
    }
  });

  test('falls back to delete + insert beyond maxCost, still reconstructing', () => {
    const a = Array.from({ length: 50 }, (_, index) => `a${index}`);
    const b = Array.from({ length: 50 }, (_, index) => `b${index}`);
    const ops = diffSequence(['x', ...a, 'y'], ['x', ...b, 'y'], undefined, { maxCost: 10 });
    assert.deepEqual(
      ops.map((op) => op.kind),
      ['equal', 'delete', 'insert', 'equal'],
    );
    assert.deepEqual(apply(['x', ...a, 'y'], ['x', ...b, 'y'], ops), { before: ['x', ...a, 'y'], after: ['x', ...b, 'y'] });
  });
});

describe('diffWords', () => {
  test('tokens are lossless', () => {
    const text = 'Olá, mundo!  Tudo bem?\nSim.';
    assert.equal(diffTokens(text).join(''), text);
  });

  test('marks word-level changes and keeps punctuation separate', () => {
    const hunks = diffWords('A feira mudou tudo.', 'A feira mudou quase tudo!');
    assert.deepEqual(hunks, [
      { kind: 'equal', text: 'A feira mudou ' },
      { kind: 'insert', text: 'quase ' },
      { kind: 'equal', text: 'tudo' },
      { kind: 'delete', text: '.' },
      { kind: 'insert', text: '!' },
    ]);
  });

  test('folds whitespace between changes into one deletion and one insertion', () => {
    assert.deepEqual(diffWords('alfa beta gama', 'alfa delta épsilon'), [
      { kind: 'equal', text: 'alfa ' },
      { kind: 'delete', text: 'beta gama' },
      { kind: 'insert', text: 'delta épsilon' },
    ]);
  });

  test('reconstructs before and after (randomised sentences)', () => {
    const vocabulary = ['o', 'ateliê', 'cresceu', 'na', 'feira', ',', 'muito', 'e', 'hoje', 'vende', '.', 'mais'];
    const random = prng(7);
    const sentence = () => Array.from({ length: 1 + Math.floor(random() * 15) }, () => vocabulary[Math.floor(random() * vocabulary.length)]).join(' ');
    for (let round = 0; round < 100; round += 1) {
      const before = sentence();
      const after = sentence();
      assert.deepEqual(rebuild(diffWords(before, after)), { before, after });
    }
  });

  test('word similarity is 1 for equal and 0 for disjoint sequences', () => {
    assert.equal(wordSimilarity(['a', 'b'], ['a', 'b']), 1);
    assert.equal(wordSimilarity(['a'], ['b']), 0);
    assert.equal(wordSimilarity([], []), 1);
    assert.equal(wordSimilarity(['a', 'b', 'c', 'd'], ['a', 'b', 'x', 'y']), 0.5);
  });
});
