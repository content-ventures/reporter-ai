import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEMORY_TEXT_MAX_BYTES, memoryCorrectionSchema, memoryDecisionInputSchema, memoryImportInputSchema,
  memoryArticleBatchSchema, memoryDuplicateResolutionSchema, memorySelectionInputSchema, parseMemoryQuery } from '../src/server/editorial-memory-input.ts';

const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
const ref = { id: 'evidence', revision: 0, hash: 'a'.repeat(16) };
const material = { title: 'Synthetic document', kind: 'report', text: '  Texto sintético com contexto original preservado.\n',
  metadata, authorized: true, primaryOrigin: null, originalFileId: null };
const decision = { evidence: ref, check: null, policyRevision: 1, previousSequence: 0, action: 'accept', reason: 'Conferi a fonte.', supports: [] };
test('article continuation rejects impossible offsets before PostgreSQL integer conversion and binds partial resumes to a document', () => {
  const after = { productionId: 'p', kind: 'piece', id: 'article', offset: 1, storageHash: 'a'.repeat(32) };
  assert.equal(memoryArticleBatchSchema.safeParse({ after }).success, true);
  for (const offset of [-1, 0.5, 10 ** 12]) assert.equal(memoryArticleBatchSchema.safeParse({ after: { ...after, offset } }).success, false);
  assert.equal(memoryArticleBatchSchema.safeParse({ after: { ...after, storageHash: null } }).success, false);
  assert.equal(memoryArticleBatchSchema.safeParse({ after, actor: 'forged' }).success, false);
});

test('import validation keeps original source whitespace and explicit unknown dates', () => {
  assert.deepEqual(memoryImportInputSchema.parse(material), material);
  assert.equal(memoryImportInputSchema.safeParse({ ...material, actor: 'forged' }).success, false);
  assert.equal(memoryImportInputSchema.safeParse({ ...material, workspaceId: 'other' }).success, false);
  assert.equal(memoryImportInputSchema.safeParse({ ...material, metadata: { ...metadata, publishedOn: '2025-02-29' } }).success, false);
  for (const url of ['not-a-url', 'javascript:alert(1)', 'https://user:secret@source.invalid', 'file:///tmp/file'])
    assert.equal(memoryImportInputSchema.safeParse({ ...material, metadata: { ...metadata, originalUrl: url } }).success, false);
});

test('text capacity is measured in UTF-8 bytes and refuses NUL, broken Unicode and empty input', () => {
  for (const text of [' '.repeat(100), `Synthetic invalid source with nul \0`, `Synthetic broken Unicode \ud800`, 'á'.repeat(MEMORY_TEXT_MAX_BYTES / 2 + 1)])
    assert.equal(memoryImportInputSchema.safeParse({ ...material, text }).success, false);
  assert.equal(memoryImportInputSchema.safeParse({ ...material, text: 'á'.repeat(MEMORY_TEXT_MAX_BYTES / 2) }).success, true);
});

test('review payloads cannot supply actor identity or omit the reason/revision guards', () => {
  assert.equal(memoryDecisionInputSchema.safeParse(decision).success, true);
  for (const changed of [{ ...decision, personId: 'someone' }, { ...decision, at: '2026-01-01T00:00:00Z' },
    { ...decision, reason: ' ' }, { ...decision, previousSequence: -1 }, { ...decision, evidence: { ...ref, revision: -1 } }])
    assert.equal(memoryDecisionInputSchema.safeParse(changed).success, false);
});

test('URL filters have explicit date semantics, strict booleans, bounded pages and no silent duplicate selectors', () => {
  const query = parseMemoryQuery(new URLSearchParams('kind=statistic&q=volume&topic=Beta&topic=Alfa&topic=Beta&dateField=observation&from=2024-01-01&to=2024-12-31&unused=true&minConfidence=85'));
  assert.deepEqual(query.topics, ['Alfa', 'Beta']); assert.equal(query.query, 'volume'); assert.equal(query.unused, true);
  assert.equal(query.limit, 25); assert.equal(query.useStage, 'inserted'); assert.equal(query.minConfidence, 85); assert.equal(query.status, 'active');
  assert.equal(parseMemoryQuery(new URLSearchParams('status=superseded')).status, 'superseded');
  for (const invalid of ['limit=101', 'limit=', 'limit=1.5', 'unused=1', 'from=2025-01-01', 'dateField=recorded&from=2025-03-01&to=2024-03-01',
    'minConfidence=NaN', 'minConfidence=101', 'kind=citation&kind=statistic', 'actor=other', 'q=a&query=b', 'sort=unknown', 'status=unknown', 'status=active&status=all'])
    assert.throws(() => parseMemoryQuery(new URLSearchParams(invalid)), { name: 'ZodError' }, invalid);
  assert.throws(() => parseMemoryQuery(new URLSearchParams(Array(21).fill('topic=Same').join('&'))));
});

test('duplicate resolution binds both exact evidence snapshots and refuses fabricated actor or an implicit choice', () => {
  const input = { expected: ref, canonical: { ...ref, id: 'canonical' }, choice: 'keep_variant', reason: 'Preservar a edição revisada.' };
  assert.deepEqual(memoryDuplicateResolutionSchema.parse(input), input);
  for (const changed of [{ ...input, actor: 'someone' }, { ...input, reason: ' ' }, { ...input, canonical: ref }, { ...input, choice: 'automatic' },
    { ...input, canonical: { ...input.canonical, revision: -1 } }]) assert.equal(memoryDuplicateResolutionSchema.safeParse(changed).success, false);
});

test('corrections are discriminated and decimal ranges retain precision beyond floating point', () => {
  const value = { raw: 'entre 1 e 2', decimal: null, lower: '1.000000000000000001', upper: '1.000000000000000002', scale: null };
  const correction = { expected: ref, reason: 'Ajuste da extração.', changes: { kind: 'statistic', value } };
  assert.equal(memoryCorrectionSchema.safeParse(correction).success, true);
  assert.equal(memoryCorrectionSchema.safeParse({ ...correction, changes: { kind: 'statistic', value: { ...value, lower: value.upper, upper: value.lower } } }).success, false);
  assert.equal(memoryCorrectionSchema.safeParse({ ...correction, changes: { kind: 'statistic', value: { ...value, scale: '0' } } }).success, false);
  for (const decimal of ['invalid', '1e20', '9'.repeat(101), '']) {
    assert.equal(memoryCorrectionSchema.safeParse({ ...correction, changes: { kind: 'statistic', value: { ...value, lower: decimal } } }).success, false);
    assert.equal(memoryCorrectionSchema.safeParse({ ...correction, changes: { kind: 'statistic', value: { ...value, scale: decimal } } }).success, false);
  }
  for (const changes of [{ kind: 'citation' }, { kind: 'citation', metadata: {} }, { kind: 'citation', value }, { kind: 'statistic', authorConfirmed: true }])
    assert.equal(memoryCorrectionSchema.safeParse({ ...correction, changes }).success, false);
});

test('selection keeps order, permits unattached briefs and refuses repeated evidence or forged workspace', () => {
  const input = { baseRevision: 0, productionId: null, evidence: [ref, { ...ref, id: 'second' }] };
  assert.deepEqual(memorySelectionInputSchema.parse(input), input);
  assert.equal(memorySelectionInputSchema.safeParse({ ...input, evidence: [ref, { ...ref, revision: 2 }] }).success, false);
  assert.equal(memorySelectionInputSchema.safeParse({ ...input, workspaceId: 'other' }).success, false);
});
