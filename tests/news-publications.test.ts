import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranscriptSource, resolveSourceRef } from '../src/domain/source.ts';
import { parseTranscript } from '../src/domain/text/transcript-parse.ts';
import { writingTemporalContext } from '../src/domain/writing-context.ts';
import { prepareNewsPublications } from '../src/server/news-publications.ts';
import { sourceAttributionGroundingText } from '../src/domain/source-attribution-grounding.ts';
import { ungroundedTerms } from '../src/domain/grounding.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const context = { runId: 'run', workspaceId: 'workspace', actorId: 'editor' };
const original = () => createTranscriptSource({ workspaceId: context.workspaceId, title: 'Publisher: Notícia recebida',
  kind: 'news', origin: 'other', sourceUrl: 'https://publisher.example/story', authorized: true,
  parsed: parseTranscript('Um título e um resumo muito curto.', { format: 'plain' }) },
{ now: '2026-11-12T10:00:00Z', actorId: context.actorId, newId: () => 'original' });
const html = (date = '2026-11-11T23:45:00-03:00') => `<html><head><meta property="og:type" content="article"><meta property="og:title" content="Notícia original"><meta property="og:site_name" content="Publisher"><meta property="article:published_time" content="${date}"></head><body><article><p>A publicação original confirma os dados, explica sua origem e informa os próximos passos com ressalvas.</p><p>O segundo parágrafo contém outra informação documentada e relevante para a notícia.</p></article></body></html>`;
const response = (text: string, url = 'https://publisher.example/story') => ({ status: 200 as const, url, text, contentType: 'text/html' });

test('a short feed gains immutable publisher evidence and its publication day before planning', async () => {
  const source = original(), before = structuredClone(source);
  const prepared = await prepareNewsPublications([source], context, { fetch: async () => response(html()), now: () => '2026-11-12T10:30:00Z' });
  assert.deepEqual(source, before, 'the received source and previous versions are unchanged');
  assert.equal(prepared.sources.length, 1);
  assert.equal(prepared.sources[0].research?.provider, 'publisher');
  assert.equal(prepared.sources[0].research?.originalSourceId, source.id);
  assert.equal(prepared.dates.get(source.id), '2026-11-11', 'the publisher calendar day survives the UTC boundary');
  assert.equal(prepared.sources[0].recordedOn, undefined);
  for (const candidate of prepared.candidates) assert.equal(resolveSourceRef(prepared.sources, candidate.ref)?.excerpt, candidate.text);
  const datedAttribution = 'No site Publisher publicado em 11/11/2026, a publicação original confirma os dados.';
  const grounded = sourceAttributionGroundingText(datedAttribution, prepared.sources, prepared.candidates.map(candidate => candidate.ref));
  assert.deepEqual(ungroundedTerms(grounded, prepared.candidates.map(candidate => candidate.text).join(' ')), []);
  const temporal = writingTemporalContext([{ ...source, publishedOn: prepared.dates.get(source.id) }], '2026-11-12');
  assert.deepEqual(temporal.sources[0], { sourceId: source.id, title: source.title, recordedOn: null,
    publishedOn: '2026-11-11', sourceUrl: source.sourceUrl });
});

test('a shorter publisher snapshot documents its date without replacing a richer feed', async () => {
  const source = original(); source.versions[0].content.segments[0].text = 'Texto completo recebido. '.repeat(40);
  const before = structuredClone(source);
  const prepared = await prepareNewsPublications([source], context, { fetch: async () => response(html()) });
  assert.equal(prepared.sources.length, 1);
  assert.deepEqual(source, before);
  assert.equal(prepared.dates.get(source.id), '2026-11-11');
});

test('missing dates, fetch failures and redirects never manufacture current publication dates', async () => {
  const source = original();
  for (const date of ['', 'not-a-date', '2026-02-30T12:00:00Z']) {
    const prepared = await prepareNewsPublications([source], context, { fetch: async () => response(html(date)) });
    assert.equal(prepared.dates.size, 0);
    assert.equal(prepared.sources[0].publishedOn, undefined);
  }
  for (const fetch of [async () => { throw new Error('unreachable'); }, async () => response(html(), 'https://publisher.example/another-story')]) {
    const prepared = await prepareNewsPublications([source], context, { fetch });
    assert.equal(prepared.sources.length, 0); assert.equal(prepared.dates.size, 0);
  }
});

test('unauthorized, foreign, bank, research and ordinary transcript sources are never fetched', async () => {
  const source = original();
  const prepared = await prepareNewsPublications([{ ...source, rights: { authorized: false } }, { ...source, workspaceId: 'other' },
    { ...source, memory: [] }, { ...source, kind: 'transcript' },
    { ...source, research: { provider: 'tavily', runId: 'old', query: 'query', retrievedAt: source.createdAt, publishedOn: null } }], context,
  { fetch: async () => { assert.fail('no public read is permitted for these sources'); } });
  assert.equal(prepared.sources.length, 0);
});

test('worker retries reuse a frozen publisher snapshot and stable evidence references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reporter-publication-'));
  const source = original(); let reads = 0;
  try {
    const first = await prepareNewsPublications([source], context, { directory, fetch: async () => { reads++; return response(html()); }, now: () => '2026-11-12T10:00:00Z' });
    const retried = await prepareNewsPublications([source], context, { directory,
      fetch: async () => { assert.fail('the same run must not silently refresh evidence'); }, now: () => '2026-11-12T11:00:00Z' });
    assert.deepEqual(retried, first);
    assert.equal(reads, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('historical single-story hard news can prepare its legacy transcript snapshot', async () => {
  const source = { ...original(), kind: 'transcript' as const };
  const prepared = await prepareNewsPublications([source], context, { legacyNews: true, fetch: async () => response(html()) });
  assert.equal(prepared.sources.length, 1);
  assert.equal(prepared.dates.get(source.id), '2026-11-11');
});
