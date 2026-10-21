import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { citationId, locateCitation } from './citation-library.ts';
import type { Citation } from './citation-library.ts';
import { CURATED_CHARS, curatedEvidence, explainedHints, isCuratedCitation, planningSource, quotableShortlist, writingSource } from './evidence-hints.ts';
import type { EvidenceCandidate } from './evidence-hints.ts';
import { EDITORIAL_FORMATS } from './formats.ts';
import { defaultPipelineDefinition, formatPipelineDefinition } from './pipeline.ts';
import type { PipelineDefinition } from './pipeline.ts';
import { createTranscriptSource } from './source.ts';
import type { Source } from './source.ts';
import { parseTranscript } from './text/transcript-parse.ts';

const now = '2026-10-21T12:00:00Z';
const ctx = { now, actorId: 'editor', newId: () => 'source' };
const MARKET = 'Nós investimos 12 milhões em câmaras frias neste ano.';
const COLD = 'O controle de temperatura precisa acompanhar o pescado durante todo o transporte.';
const EXPORT = 'A exportação para o Chile começa em março, com dois contêineres por mês.';

function material(): Source {
  return createTranscriptSource({ workspaceId: 'workspace', title: 'Entrevista sintética', origin: 'interview', authorized: true,
    parsed: parseTranscript(`Ana Costa: ${COLD} ${MARKET}\nPedro Lima: E o mercado externo?\nAna Costa: ${EXPORT}`, { format: 'speaker-lines' }),
    speakerPeople: { 'Ana Costa': 'ana' } }, ctx);
}
/** The editorial candidates of the material: one per sentence, keyed in material order. */
function candidates(source: Source): EvidenceCandidate[] {
  const [first, , third] = source.versions[0].content.segments;
  return [[first, COLD], [first, MARKET], [third, EXPORT]].map(([segment, text], index) => {
    const { id, speaker } = segment as typeof first, from = (segment as typeof first).text.indexOf(text as string);
    return { key: String(index), text: text as string, ...(speaker ? { speaker } : {}),
      ref: { kind: 'source' as const, sourceId: source.id, sourceVersion: 1, locator: { type: 'segment' as const, segmentId: id, from, to: from + (text as string).length } } };
  });
}
function saved(source: Source, text: string, changes: Partial<Citation> = {}): Citation {
  const located = locateCitation(source, 1, text);
  assert.ok(located);
  return { id: citationId(located.ref, located.text), revision: 1, text: located.text, ref: located.ref, sourceHash: located.hash,
    productionId: 'production', createdAt: now, updatedAt: now, authorConfirmed: true, personId: 'ana', relevance: 'Mostra o investimento da empresa.', ...changes };
}

test('a curated citation maps to the sentences inside it and to the sentence that holds it, newest first', () => {
  const source = material(), all = candidates(source);
  const both = saved(source, `${COLD} ${MARKET}`, { updatedAt: '2026-10-20T10:00:00Z', relevance: `  ${'r'.repeat(300)}  ` });
  const part = saved(source, 'A exportação para o Chile começa em março', { updatedAt: '2026-10-21T10:00:00Z', relevance: ' ' });
  const curated = curatedEvidence([both, part], [source], all);
  assert.deepEqual(curated.lines.map(line => line.keys), [['2'], ['0', '1']]);
  assert.equal(curated.lines[0].text, part.text);
  assert.equal(curated.lines[0].speaker, 'Ana Costa');
  assert.equal('relevance' in curated.lines[0], false, 'an empty relevance is left out');
  assert.equal(curated.lines[1].relevance, 'r'.repeat(200));
  assert.deepEqual(curated.byKey.get('0'), { citationId: both.id, relevance: 'r'.repeat(200) });
  assert.deepEqual(curated.byKey.get('2'), { citationId: part.id });
});

test('a citation is curated only when a person saved, confirmed and linked it to an unchanged authorized source', () => {
  const source = material(), all = candidates(source), citation = saved(source, MARKET);
  assert.equal(isCuratedCitation(citation, [source]), true);
  for (const changes of [{ revision: 0 }, { authorConfirmed: false }, { personId: undefined }, { sourceHash: 'changed' }])
    assert.equal(isCuratedCitation({ ...citation, ...changes }, [source]), false, JSON.stringify(changes));
  assert.equal(isCuratedCitation(citation, [{ ...source, rights: { authorized: false } }]), false);
  assert.equal(isCuratedCitation(citation, []), false);
  const corrected: Source = { ...source, versions: [...source.versions, { ...source.versions[0], number: 2 }] };
  const current = all.map(candidate => ({ ...candidate, ref: { ...candidate.ref, sourceVersion: 2 } }));
  assert.equal(curatedEvidence([citation], [corrected], current).lines.length, 0, 'another version of the material is not this text');
  assert.equal(curatedEvidence([{ ...citation, authorConfirmed: false }], [source], all).byKey.size, 0);
});

test('curated lines stop at their character budget', () => {
  const source = material(), all = candidates(source);
  const lines = Array.from({ length: 40 }, (_, index) => saved(source, MARKET, { id: `c${index}`, relevance: 'r'.repeat(200) }));
  const curated = curatedEvidence(lines, [source], all);
  assert.ok(curated.lines.length > 1 && curated.lines.length < 40);
  assert.ok(planningSource('', curated, []).length <= CURATED_CHARS + 200);
});

test('the planning source is the context alone when there is nothing to add', () => {
  const source = material(), all = candidates(source);
  assert.equal(planningSource('contexto', { byKey: new Map(), lines: [] }, []), 'contexto');
  const curated = curatedEvidence([saved(source, MARKET)], [source], all);
  assert.equal(planningSource('contexto', curated, [all[2]]), 'contexto'
    + '\n\nFALAS CURADAS (conferidas pela redação no banco de citações; os ids são os da fonte):\n'
    + `[1] Ana Costa: ${MARKET} — por que importa: Mostra o investimento da empresa.`
    + '\n\nFALAS LITERAIS CITÁVEIS (frases exatas da transcrição original, com seus ids):\n'
    + `[2] Ana Costa: ${EXPORT}`);
});

test('the shortlist takes the best quotable line of each third in turn, in material order, up to its size', () => {
  const words = (count: number, extra = '') => `${extra}${Array.from({ length: count }, () => 'palavra').join(' ')}.`;
  const line = (key: number, text: string, speaker = 'Ana Costa'): EvidenceCandidate => ({ key: String(key), text, speaker,
    ref: { kind: 'source', sourceId: 'source', sourceVersion: 1, locator: { type: 'segment', segmentId: `seg-${key}` } } });
  const all = [
    line(0, words(10)), line(1, words(14, 'Nós vendemos 30 toneladas ')), line(2, words(5)),
    line(3, words(20)), line(4, words(15, 'Eu ')), line(5, words(70)),
    line(6, words(9)), line(7, words(16, 'Exportamos 12 ')), line(8, words(12), 'Pedro Lima'),
  ];
  const identified = (candidate: EvidenceCandidate) => candidate.speaker === 'Ana Costa';
  assert.deepEqual(quotableShortlist(all, identified, new Set()).map(candidate => candidate.key), ['0', '1', '3', '4', '6', '7']);
  assert.deepEqual(quotableShortlist(all, identified, new Set(['4'])).map(candidate => candidate.key), ['0', '1', '3', '6', '7']);
  const size = (keys: string[]) => keys.reduce((sum, key) => sum + `[${key}] Ana Costa: ${all[Number(key)].text}`.length + 1, 0);
  assert.deepEqual(quotableShortlist(all, identified, new Set(), size(['1', '4', '7'])).map(candidate => candidate.key), ['1', '4', '7']);
  assert.deepEqual(quotableShortlist(all, identified, new Set(), size(['1', '4', '7']) - 1).map(candidate => candidate.key), ['1', '4']);
});

test('the writing source is unchanged without curated lines and marks the curated ones', () => {
  const source = material(), all = candidates(source), selected = new Set(['1', '2']);
  const today = JSON.stringify({ context: 'contexto', literalEvidence: all.filter(candidate => selected.has(candidate.key))
    .map(candidate => ({ id: candidate.key, text: candidate.text, ...(candidate.speaker ? { speaker: candidate.speaker } : {}) })) });
  assert.equal(writingSource('contexto', all, selected, new Map()), today);
  const marked = JSON.parse(writingSource('contexto', all, selected, new Map([['1', { citationId: 'c', relevance: 'Mostra o investimento.' }], ['2', { citationId: 'd' }]])));
  assert.deepEqual(marked.literalEvidence, [
    { id: '1', text: MARKET, speaker: 'Ana Costa', curated: true, relevance: 'Mostra o investimento.' },
    { id: '2', text: EXPORT, speaker: 'Ana Costa', curated: true },
  ]);
});

test('hints reach only the prompts that explain them: revision 1 keeps its exact source', () => {
  const revisionOne: PipelineDefinition = JSON.parse(readFileSync(new URL('../../tests/fixtures/pipeline-revision-1.json', import.meta.url), 'utf8'));
  const none = { planning: false, writing: false }, both = { planning: true, writing: true };
  assert.deepEqual(explainedHints(revisionOne), none);
  assert.deepEqual(explainedHints({ ...revisionOne, articleMode: 'single' }), none);
  const current = defaultPipelineDefinition('openai/gpt-6-astra');
  assert.deepEqual(explainedHints(current), both);
  assert.deepEqual(explainedHints({ ...current, articleMode: 'single' }), both);
  for (const format of EDITORIAL_FORMATS) assert.deepEqual(explainedHints(formatPipelineDefinition(revisionOne, format)), both, format);
});
