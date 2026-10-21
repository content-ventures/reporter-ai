import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArticleBody } from './article.ts';
import type { Citation } from './citation-library.ts';
import { LIBRARY_CAP, SUGGESTIONS_PER_PRODUCTION, SUGGESTIONS_PER_RUN, isSuggestedCitation, mergeCitationAdditions, suggestedCitations } from './citation-suggestions.ts';
import type { EvidenceCandidate } from './evidence-hints.ts';
import { createTranscriptSource } from './source.ts';
import type { Source } from './source.ts';

const now = '2026-10-21T12:00:00Z';
const ctx = { now, actorId: 'editor', newId: () => 'source' };
const S1 = 'A fábrica passou a operar em dois turnos em março.';
const S2 = 'Dobramos a capacidade de defumação para atender os supermercados.';
const S3 = 'O pedido de habilitação sanitária para o Chile sai ainda este ano.';
const S4 = 'Então o mercado chinês pediu cinco contêineres em setembro.';
const S5 = 'Cada contêiner leva vinte toneladas de filé congelado.';
const B1 = 'Nossa cooperativa reúne quarenta produtores do Vale do Ribeira.';
const C1 = 'O preço da ração subiu doze por cento no primeiro semestre.';
const SHORT = 'Isso é muito bom.';
const LONG = Array.from({ length: 30 }, (_, index) => `A linha número ${index + 1} de produção recebeu uma nova câmara fria neste ano.`);
const segments: [string, string[]][] = [
  ['Ana Costa', [S1, S2, S3]], ['Pedro Lima', ['E o mercado externo?']], ['Ana Costa', [S4, S5]],
  ['Bruno Reis', [B1]], ['Ana Costa', [SHORT]], ['Carla Dias', [C1]], ['Ana Costa', LONG],
];

function material(): Source {
  return createTranscriptSource({ workspaceId: 'workspace', title: 'Entrevista sintética', origin: 'interview', authorized: true,
    // Built by hand: the parser splits a long turn, and one test needs a segment over the citation size.
    parsed: { format: 'speaker-lines', warnings: [], speakers: [...new Set(segments.map(([speaker]) => speaker))],
      segments: segments.map(([speaker, lines], index) => ({ id: `seg-${index + 1}`, speaker, text: lines.join(' ') })) },
    speakerPeople: { 'Ana Costa': 'ana' }, unattributed: ['Bruno Reis'],
    programName: 'Programa fictício', sourceUrl: 'https://example.com/episodio', recordedOn: '2026-10-12', location: 'Estúdio fictício' }, ctx);
}
/** One candidate per sentence, keyed by its text so a test reads like the material. */
function candidates(source: Source): Map<string, EvidenceCandidate> {
  const found = new Map<string, EvidenceCandidate>();
  source.versions[0].content.segments.forEach((segment, index) => {
    for (const text of segments[index][1]) {
      const from = segment.text.indexOf(text);
      found.set(text, { key: String(found.size), text, speaker: segment.speaker,
        ref: { kind: 'source', sourceId: source.id, sourceVersion: 1, locator: { type: 'segment', segmentId: segment.id, from, to: from + text.length } } });
    }
  });
  return found;
}
function article(text: string, refs: EvidenceCandidate[]): ArticleBody {
  return { type: 'article', title: 'Teste', blocks: [{ id: 'p', type: 'paragraph', inlines: [{ text }], sourceRefs: refs.map(candidate => candidate.ref) }] };
}
function suggest(source: Source, all: Map<string, EvidenceCandidate>, selected: string[], body = article('Sem citação.', []), limit?: number) {
  return suggestedCitations({ body, selected: selected.map(text => all.get(text)!.key), candidates: [...all.values()], sources: [source],
    productionId: 'production', now, ...(limit ? { limit } : {}) });
}

test('adjacent selected sentences become one suggestion, separate ones stay apart, opening first', () => {
  const source = material(), all = candidates(source);
  assert.deepEqual(suggest(source, all, [S1, S2]).map(entry => entry.text), [`${S1} ${S2}`]);
  assert.deepEqual(suggest(source, all, [S4, S3, S1]).map(entry => entry.text), [S4, S1, S3]);
});

test('quoted words are never suggested, even when a quotation covers half of a sentence', () => {
  const source = material(), all = candidates(source);
  const half = article('Segundo Ana, “Dobramos a capacidade de defumação”, disse.', [all.get(S2)!]);
  assert.deepEqual(suggest(source, all, [S1, S2, S3], half).map(entry => entry.text), [S1, S3]);
  const capital = article('“O mercado chinês pediu cinco contêineres em setembro”, afirmou.', [all.get(S4)!]);
  assert.deepEqual(suggest(source, all, [S4, S5], capital).map(entry => entry.text), [S5]);
});

test('only a linked speaker is suggested, within the citation size', () => {
  const source = material(), all = candidates(source);
  assert.deepEqual(suggest(source, all, [B1, C1, SHORT]), [], 'unattributed, unlinked and short lines are skipped');
  const [long] = suggest(source, all, LONG);
  assert.ok(long.text.length <= 1200 && long.text.length > 1100);
  assert.ok(`${LONG.join(' ')}`.startsWith(long.text) && long.text.endsWith('ano.'), 'whole sentences are dropped from the end');
  assert.deepEqual(suggest({ ...source, rights: { authorized: false } }, all, [S1]), []);
});

test('a suggestion is untouched, unconfirmed and limited per run', () => {
  const source = material(), all = candidates(source);
  assert.equal(SUGGESTIONS_PER_RUN, 10);
  const [entry] = suggest(source, all, [S1]);
  assert.deepEqual({ ...entry, id: undefined, ref: undefined, sourceHash: undefined }, { id: undefined, ref: undefined, sourceHash: undefined,
    revision: 0, origin: 'outline', text: S1, productionId: 'production', createdAt: now, updatedAt: now, authorConfirmed: false, personId: 'ana',
    relevance: '', podcastName: 'Programa fictício', podcastUrl: 'https://example.com/episodio', recordedOn: '2026-10-12', location: 'Estúdio fictício' });
  assert.equal(isSuggestedCitation(entry), true);
  assert.equal(isSuggestedCitation({ ...entry, authorConfirmed: true }), false);
  assert.equal(suggest(source, all, [S1, S3, S4, LONG[0]], article('Sem citação.', []), 2).length, 2);
});

test('merging keeps one entry per id and per passage, promotes quotations and respects the caps', () => {
  const source = material(), all = candidates(source);
  const [s1] = suggest(source, all, [S1]), [s3] = suggest(source, all, [S3]), [both] = suggest(source, all, [S1, S2]);
  const quoted: Citation = { ...both, id: 'article', origin: 'article', authorConfirmed: true };
  assert.deepEqual(mergeCitationAdditions([s1], [s1], 'production'), [s1], 'an existing id is skipped');
  assert.deepEqual(mergeCitationAdditions([quoted], [s1], 'production'), [quoted], 'a suggestion inside an entry is skipped');
  assert.deepEqual(mergeCitationAdditions([s1, s3], [quoted], 'production'), [s3, quoted], 'a quotation replaces the untouched suggestion it covers');
  const edited = { ...s1, revision: 1, relevance: 'Mostra a capacidade.' };
  assert.deepEqual(mergeCitationAdditions([edited], [quoted], 'production'), [edited, quoted], 'an edited suggestion stays');
  const full = Array.from({ length: SUGGESTIONS_PER_PRODUCTION }, (_, index) => ({ ...s3, id: `s${index}`, text: `${index} ${S3}` }));
  assert.equal(mergeCitationAdditions(full, [s1], 'production').length, SUGGESTIONS_PER_PRODUCTION);
  assert.equal(mergeCitationAdditions(full, [s1], 'other').length, SUGGESTIONS_PER_PRODUCTION + 1, 'another production has its own allowance');
  assert.equal(LIBRARY_CAP, 5000);
  const kept = [{ ...quoted, id: 'a1' }, { ...quoted, id: 'a2', text: S5 }];
  assert.deepEqual(mergeCitationAdditions(kept, [{ ...quoted, id: 'a3', text: S4 }, s3], 'production', 2), kept, 'nothing is added at the cap');
  assert.equal(mergeCitationAdditions([kept[0], s3], [{ ...quoted, id: 'a3', text: S4 }], 'production', 2).length, 3, 'suggestions do not count toward the cap');
});
