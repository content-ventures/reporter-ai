import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentSourceVersion, resolveSourceRef } from './source.ts';
import { createKit, sampleSource } from './testing/scenario.ts';
import { writingSourceCandidates } from './writing-source.ts';

test('writing sources preserve interviewer questions, pleasantries and complete multi-sentence turns', () => {
  const source = sampleSource(createKit());
  const segments = currentSourceVersion(source).content.segments;
  segments.push({ id: 'long', speaker: 'Marina Lopes', text: '  Primeira frase.\n' + 'Informação integral. '.repeat(500) + 'Última ressalva.  ' });
  segments.push({ id: 'thanks', text: 'Obrigado.' }, { id: 'blank', text: ' \n ' });
  const candidates = writingSourceCandidates([source]);
  assert.equal(candidates.length, segments.length - 1);
  assert.ok(candidates.some(candidate => candidate.speaker === 'Entrevistadora' && candidate.text.includes('?')));
  assert.ok(candidates.some(candidate => candidate.text === 'Obrigado.'));
  assert.equal(candidates.find(candidate => candidate.ref.locator.type === 'segment' && candidate.ref.locator.segmentId === 'long')?.text, segments.at(-3)?.text);
  for (const candidate of candidates) {
    assert.equal(resolveSourceRef([source], candidate.ref)?.excerpt, candidate.text);
    assert.ok(candidate.key.length <= 128);
  }
});

test('evidence identities distinguish sources and revisions while staying stable across ordering and reloads', () => {
  const first = sampleSource(createKit()), second = structuredClone(first); second.id = 'another-source';
  const firstCandidates = writingSourceCandidates([first, second]);
  assert.equal(new Set(firstCandidates.map(candidate => candidate.key)).size, firstCandidates.length);
  assert.deepEqual(writingSourceCandidates(structuredClone([first, second])), firstCandidates);
  assert.deepEqual(writingSourceCandidates([second, first]).map(candidate => candidate.key).sort(), firstCandidates.map(candidate => candidate.key).sort());
  const previous = currentSourceVersion(first), latest = structuredClone(previous); latest.number = 2;
  latest.content.segments[0].text = 'Pergunta corrigida?'; first.versions.push(latest);
  const revised = writingSourceCandidates([first]);
  assert.equal(revised[0].text, 'Pergunta corrigida?'); assert.equal(revised[0].ref.sourceVersion, 2);
  assert.notEqual(revised[0].key, firstCandidates[0].key);
  assert.equal(resolveSourceRef([first], firstCandidates[0].ref)?.excerpt, previous.content.segments[0].text);
});
