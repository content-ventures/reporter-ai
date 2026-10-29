import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryCorrectionSchema, memoryImportInputSchema } from '../src/server/editorial-memory-input.ts';
import { createMemoryMaterial, memoryBlocks } from '../src/domain/editorial-memory-import.ts';
import { materializeMemoryCandidates, memoryExtractionWindow } from '../src/domain/editorial-memory-extraction.ts';
import { memoryEvidenceRef } from '../src/domain/editorial-memory.ts';

const metadata = { publishedOn: '1987-04-12', recordedOn: null, institution: null, company: null, event: null,
  edition: '42', topics: [], originalUrl: null, publication: 'Jornal Sintético', documentAuthor: 'Autora Sintética', documentSection: 'Página 3' };
const text = 'Uma declaração sintética preservada no documento original.';
const input = { title: 'Matéria sintética', kind: 'archive' as const, text, metadata, authorized: true, primaryOrigin: null, originalFileId: null };
const ctx = { actorId: 'editor', now: '2026-10-29T12:00:00Z', newId: (prefix: string) => prefix };

test('historical metadata accepts explicit publication, document author and section while remaining compatible with older records', () => {
  assert.deepEqual(memoryImportInputSchema.parse(input), input);
  const { publication, documentAuthor, documentSection, ...older } = metadata;
  assert.deepEqual([publication, documentAuthor, documentSection], ['Jornal Sintético', 'Autora Sintética', 'Página 3']);
  assert.deepEqual(memoryImportInputSchema.parse({ ...input, metadata: older }).metadata, older);
  assert.deepEqual(memoryImportInputSchema.parse({ ...input, metadata: { ...older, publication: null, documentAuthor: null, documentSection: null } }).metadata, older);
  for (const [key, value] of [['publication', ' '], ['documentAuthor', 'x'.repeat(241)], ['documentSection', 'x'.repeat(241)]])
    assert.equal(memoryImportInputSchema.safeParse({ ...input, metadata: { ...metadata, [key]: value } }).success, false);
});

test('document authorship is copied to the evidence without confirming who made the statement', () => {
  const { material } = createMemoryMaterial(input, 'workspace', ctx);
  const block = memoryBlocks(material, 'job', text)[0];
  const [evidence] = materializeMemoryCandidates([{ kind: 'citation', excerpt: text, from: 0, kinds: ['declared'] }], block, material, memoryExtractionWindow(block, text), ctx);
  assert.equal(evidence.kind, 'citation');
  if (evidence.kind !== 'citation') return;
  assert.equal(evidence.metadata.documentAuthor, 'Autora Sintética');
  assert.equal(evidence.personId, null);
  assert.equal(evidence.authorConfirmed, false);
  assert.notEqual(memoryEvidenceRef(evidence).hash, memoryEvidenceRef({ ...evidence, metadata: { ...evidence.metadata, documentAuthor: 'Outra autora' } }).hash);
  assert.equal(memoryCorrectionSchema.safeParse({ expected: memoryEvidenceRef(evidence), reason: 'Conferido no original',
    changes: { kind: 'citation', metadata: { publication: null, documentAuthor: 'Outra autora', documentSection: 'Caderno B' } } }).success, true);
});
