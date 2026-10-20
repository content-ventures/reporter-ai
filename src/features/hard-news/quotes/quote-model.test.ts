import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CitationView } from '../../../domain/citation-library.ts';
import { citationInputOf, locatorOf, quoteOf } from './quote-model.ts';

function citation(patch: Partial<CitationView> = {}): CitationView {
  return {
    id: 'c-1', revision: 3, text: 'O filé fresco chega em 48 horas.', sourceHash: 'h', productionId: 'p-1',
    ref: { kind: 'source', sourceId: 's-1', sourceVersion: 2, locator: { type: 'segment', segmentId: 'seg-4' } },
    createdAt: '2026-09-18T10:00:00.000Z', updatedAt: '2026-09-18T10:00:00.000Z', personId: 'person-1', authorConfirmed: true,
    relevance: 'Explica o voo direto.', podcastName: 'Cadeia do Pescado #41', podcastUrl: 'https://podcast.exemplo/41',
    speaker: 'Marina Castro', podcast: 'Cadeia do Pescado #41', sourceTitle: 'Entrevista com Marina', startMs: 872_000,
    evidence: '', authorized: true, ready: true, participants: [], uses: [], ...patch,
  } as CitationView;
}

test('the position in the recording reads as minutes, or hours when longer', () => {
  assert.equal(locatorOf(872_000), '14:32');
  assert.equal(locatorOf(3_725_000), '1:02:05');
  assert.equal(locatorOf(undefined), undefined);
  assert.equal(locatorOf(-1), undefined);
});

test('an R1 citation reads as an interview quote with its source, minute and check', () => {
  const quote = quoteOf(citation());
  assert.equal(quote.author, 'Marina Castro');
  assert.equal(quote.origin, 'transcript');
  assert.equal(quote.sourceTitle, 'Cadeia do Pescado #41');
  assert.equal(quote.sourceUrl, 'https://podcast.exemplo/41');
  assert.equal(quote.locator, '14:32');
  assert.equal(quote.context, 'Explica o voo direto.');
  assert.equal(quote.recordedOn, '2026-09-18');
  assert.equal(quote.verified, true);
});

test('a quote of part 2 reads Parte 2 · 3:12', () => {
  const place = { part: 2, count: 2, fileName: 'REC_0013.srt', startMs: 192_000 };
  assert.equal(quoteOf(citation({ startMs: 1_092_000, place })).locator, 'Parte 2 · 3:12');
  assert.equal(quoteOf(citation({ startMs: undefined, place: { part: 2, count: 2, fileName: 'REC_0013.txt' } })).locator, 'Parte 2');
});

test('without a program name the quote takes the source title, and an unsafe link is dropped', () => {
  const quote = quoteOf(citation({ podcastName: undefined, podcastUrl: 'http://inseguro.exemplo', recordedOn: '2026-09-01' }));
  assert.equal(quote.sourceTitle, 'Entrevista com Marina');
  assert.equal(quote.sourceUrl, undefined);
  assert.equal(quote.recordedOn, '2026-09-01');
});

test('saving keeps the words, source and speaker and takes the desk context, date and check', () => {
  const input = citationInputOf(citation(), { context: '  Voo direto de Curitiba.  ', recordedOn: '2026-09-20', verified: false });
  assert.equal(input.text, 'O filé fresco chega em 48 horas.');
  assert.equal(input.sourceId, 's-1');
  assert.equal(input.sourceVersion, 2);
  assert.equal(input.personId, 'person-1');
  assert.equal(input.relevance, 'Voo direto de Curitiba.');
  assert.equal(input.recordedOn, '2026-09-20');
  assert.equal(input.authorConfirmed, false);
  assert.equal(input.podcastName, 'Cadeia do Pescado #41');
});
