import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CitationView } from '../../../domain/citation-library.ts';
import type { BankQuote } from '../../../domain/hard-news.ts';
import { bankSummary, citationInputOf, DEFAULT_SORT, inTab, kindDistribution, locatorOf, matchesFilters, NO_FILTERS, pendingBatch, QUOTE_TABS, quoteOf, rankQuote, sortQuotes, verdictDistribution } from './quote-model.ts';

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

const site = { url: 'https://www.embrapa.br/x', title: 'Embrapa', site: 'embrapa.br', excerpt: 'Trecho.' };
function quote(id: string, verdicts: ('validated' | 'disputed' | 'not_validated' | 'opinion')[] | null, patch: Partial<BankQuote> = {}): BankQuote {
  const base = quoteOf(citation({ id }));
  return { ...base, ...patch, ...(verdicts ? { factCheck: { id, checkedAt: '2026-10-20T12:00:00Z', model: 'test', overrides: [], history: [],
    strength: { score: 5, reason: '' }, claims: verdicts.map((verdict, index) => verdict === 'opinion' ? { text: `Opinião ${index}`, kind: 'opinion' as const, sources: [] }
      : { text: `Fato ${index}`, kind: 'fact' as const, verdict, sources: verdict === 'not_validated' ? [] : [site] }) } } : {}) };
}

test('the ranking puts the best first, keeps unchecked quotes last and caps a disputed one', () => {
  const entries = [quote('a', ['validated', 'opinion'], { uses: 5 }), quote('b', null, { uses: 9 }), quote('c', ['disputed'], { uses: 9 }), quote('d', ['not_validated'], { uses: 0 })].map(rankQuote);
  assert.deepEqual(sortQuotes(entries, DEFAULT_SORT).map(entry => entry.quote.id), ['a', 'd', 'c', 'b']);
  assert.deepEqual(sortQuotes(entries, { key: 'score', direction: 'asc' }).map(entry => entry.quote.id), ['c', 'd', 'a', 'b']);
  assert.equal(entries[2].score?.total, 30);
  assert.deepEqual(QUOTE_TABS.map(tab => entries.filter(entry => inTab(entry, tab.value)).map(entry => entry.quote.id)),
    [['a', 'b', 'c', 'd'], ['a'], ['c', 'd'], ['b']]);
});

test('filters, summary and distributions read the effective claims', () => {
  const entries = [quote('a', ['validated', 'opinion'], { uses: 2 }), quote('b', null, { uses: 1, verified: false }), quote('c', ['disputed'])].map(rankQuote);
  assert.deepEqual(entries.filter(entry => matchesFilters(entry, { ...NO_FILTERS, kind: 'opinion' })).map(entry => entry.quote.id), ['a']);
  assert.deepEqual(entries.filter(entry => matchesFilters(entry, { ...NO_FILTERS, authorship: 'pending' })).map(entry => entry.quote.id), ['b']);
  assert.deepEqual(bankSummary(entries), { total: 3, checked: 2, disputed: 1, averageScore: Math.round((entries[0].score!.total + 30) / 2), uses: 3 });
  assert.deepEqual(kindDistribution(entries), { fact: 2, declared: 0, opinion: 1, forecast: 0 });
  assert.equal(verdictDistribution(entries).pending, 1);
  assert.deepEqual(pendingBatch(entries), ['b']);
});

test('connected attribution reads the real programme and day, and unauthorized quotes are never queued', () => {
  const unnamed = quoteOf(citation({ podcastName: undefined, podcast: 'Podcast não informado', recordedOn: undefined, authorized: false }));
  assert.deepEqual(unnamed.attribution, { sourceNamed: false, dated: false });
  assert.equal(unnamed.recordedOn, '2026-09-18', 'the card still shows a day');
  const scored = rankQuote({ ...unnamed, verified: true, factCheck: quote('u', ['opinion']).factCheck, uses: 0 });
  assert.equal(scored.score?.attribution, 13, 'the confirmed author and the episode link count; the placeholders do not');
  assert.deepEqual(pendingBatch([rankQuote(unnamed)]), []);
});
