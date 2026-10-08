/**
 * Myers O(ND) sequence diff plus word-level text hunks. Pure and dependency-free so the same
 * function powers version comparison, staleness of suggestions and the AI-retention metric.
 */

export type SeqOpKind = 'equal' | 'insert' | 'delete';

/** A run of operations: `equal` and `delete` start at `aStart`; `equal` and `insert` at `bStart`. */
export type SeqOp = { kind: SeqOpKind; aStart: number; bStart: number; length: number };

export type DiffOptions = {
  /**
   * Upper bound for the edit distance explored after trimming common prefix/suffix. Beyond it
   * the middle is reported as one delete + one insert (honest "everything changed").
   */
  maxCost?: number;
};

const DEFAULT_MAX_COST = 3000;

function pushOp(ops: SeqOp[], kind: SeqOpKind, aStart: number, bStart: number, length: number): void {
  if (length <= 0) return;
  const last = ops[ops.length - 1];
  if (last && last.kind === kind) {
    const contiguousA = kind === 'insert' || last.aStart + last.length === aStart;
    const contiguousB = kind === 'delete' || last.bStart + last.length === bStart;
    if (contiguousA && contiguousB) {
      last.length += length;
      return;
    }
  }
  ops.push({ kind, aStart, bStart, length });
}

type Step = { kind: SeqOpKind; a: number; b: number };

/** Core Myers search on `a[aLo..aHi)` vs `b[bLo..bHi)`; returns steps in forward order or null. */
function myersSteps<T>(
  a: readonly T[],
  b: readonly T[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  equals: (x: T, y: T) => boolean,
  maxCost: number,
): Step[] | null {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const max = Math.min(n + m, maxCost);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && equals(a[aLo + x], b[bLo + y])) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, aLo, bLo);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number, aLo: number, bLo: number): Step[] {
  const steps: Step[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const slice = trace[d];
    // slice[i] holds v[k] for k = i - d - 1.
    const at = (k: number) => slice[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      steps.push({ kind: 'equal', a: aLo + x - 1, b: bLo + y - 1 });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      if (x === prevX) steps.push({ kind: 'insert', a: aLo + x, b: bLo + y - 1 });
      else steps.push({ kind: 'delete', a: aLo + x - 1, b: bLo + y });
    }
    x = prevX;
    y = prevY;
  }
  return steps.reverse();
}

/** Diffs two sequences into merged runs of equal/insert/delete operations. */
export function diffSequence<T>(
  a: readonly T[],
  b: readonly T[],
  equals: (x: T, y: T) => boolean = (x, y) => x === y,
  options: DiffOptions = {},
): SeqOp[] {
  const ops: SeqOp[] = [];
  let start = 0;
  while (start < a.length && start < b.length && equals(a[start], b[start])) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && equals(a[endA - 1], b[endB - 1])) {
    endA -= 1;
    endB -= 1;
  }

  pushOp(ops, 'equal', 0, 0, start);
  if (start === endA) {
    pushOp(ops, 'insert', start, start, endB - start);
  } else if (start === endB) {
    pushOp(ops, 'delete', start, start, endA - start);
  } else {
    const steps = myersSteps(a, b, start, endA, start, endB, equals, options.maxCost ?? DEFAULT_MAX_COST);
    if (steps) {
      for (const step of steps) pushOp(ops, step.kind, step.a, step.b, 1);
    } else {
      pushOp(ops, 'delete', start, start, endA - start);
      pushOp(ops, 'insert', endA, start, endB - start);
    }
  }
  pushOp(ops, 'equal', endA, endB, a.length - endA);
  return ops;
}

/** Length of the longest common subsequence, derived from the diff. */
export function commonLength<T>(a: readonly T[], b: readonly T[], equals?: (x: T, y: T) => boolean): number {
  return diffSequence(a, b, equals).reduce((total, op) => (op.kind === 'equal' ? total + op.length : total), 0);
}

export type DiffHunkKind = 'equal' | 'insert' | 'delete';
export type DiffHunk = { kind: DiffHunkKind; text: string };

/** Words, whitespace runs and single punctuation marks; concatenating tokens restores the text. */
const TOKEN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*|\s+|[^\s\p{L}\p{N}]/gu;

export function diffTokens(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

function isBlank(text: string): boolean {
  return text.trim() === '';
}

/**
 * Makes hunks readable: a whitespace-only `equal` between two changes is folded into them, so
 * "a b" → "c d" reads as one deletion and one insertion instead of four fragments.
 */
function tidy(hunks: DiffHunk[]): DiffHunk[] {
  const out: DiffHunk[] = [];
  let index = 0;
  while (index < hunks.length) {
    const hunk = hunks[index];
    if (hunk.kind === 'equal') {
      out.push(hunk);
      index += 1;
      continue;
    }
    let deleted = '';
    let inserted = '';
    let cursor = index;
    while (cursor < hunks.length) {
      const current = hunks[cursor];
      if (current.kind === 'delete') deleted += current.text;
      else if (current.kind === 'insert') inserted += current.text;
      else {
        const next = hunks[cursor + 1];
        if (!(isBlank(current.text) && next && next.kind !== 'equal')) break;
        deleted += current.text;
        inserted += current.text;
      }
      cursor += 1;
    }
    if (deleted) out.push({ kind: 'delete', text: deleted });
    if (inserted) out.push({ kind: 'insert', text: inserted });
    index = cursor;
  }
  return out;
}

/** Word-level diff of two strings; concatenating equal+delete gives `before`, equal+insert gives `after`. */
export function diffWords(before: string, after: string): DiffHunk[] {
  const a = diffTokens(before);
  const b = diffTokens(after);
  const raw: DiffHunk[] = [];
  for (const op of diffSequence(a, b)) {
    const text =
      op.kind === 'insert'
        ? b.slice(op.bStart, op.bStart + op.length).join('')
        : a.slice(op.aStart, op.aStart + op.length).join('');
    const last = raw[raw.length - 1];
    if (last && last.kind === op.kind) last.text += text;
    else raw.push({ kind: op.kind, text });
  }
  return tidy(raw);
}

/** Dice similarity of the word sequences (0 = unrelated, 1 = identical). */
export function wordSimilarity(aWords: readonly string[], bWords: readonly string[]): number {
  if (aWords.length === 0 && bWords.length === 0) return 1;
  const common = commonLength(aWords, bWords);
  return (2 * common) / (aWords.length + bWords.length);
}
