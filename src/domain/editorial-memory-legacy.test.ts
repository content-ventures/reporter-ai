import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleCitations, mapLegacyCitation } from './editorial-memory-legacy.ts';
import { resolveMemoryAnchor } from './editorial-memory.ts';
import { createTranscriptSource } from './source.ts';
import { literalQuoteText } from './article-policy.ts';
import { citationId } from './citation-library.ts';
import type { Citation } from './citation-library.ts';
import { articleHash } from './article.ts';
import type { ArticleBody } from './article.ts';

function fixture(original: string, quoted: string) {
  const source = createTranscriptSource({ title: 'Synthetic legacy', workspaceId: 'w', origin: 'other', authorized: true,
    parsed: { format: 'plain', speakers: [], segments: [{ id: 'segment', text: original }], warnings: [] } },
  { actorId: 'actor', now: '2020-01-01T00:00:00Z', newId: () => 'source' });
  const ref = { kind: 'source' as const, sourceId: source.id, sourceVersion: 1, locator: { type: 'segment' as const, segmentId: 'segment' } };
  const citation: Citation = { id: citationId(ref, quoted), revision: 0, ref, sourceHash: source.versions[0].hash, text: quoted,
    productionId: 'p', createdAt: source.createdAt, updatedAt: source.createdAt, authorConfirmed: false, relevance: '' };
  return { source, citation, factCheck: null };
}
test('legacy presentation resolves to exact contiguous NFD/whitespace original offsets after an emoji', () => {
  const original = '🙂 Antes. A ação  registrada\nmantém os valores em 2025. Depois.';
  const quoted = 'A ação registrada mantém os valores em 2025.', candidate = fixture(original, quoted), before = structuredClone(candidate);
  const mapped = mapLegacyCitation(candidate, 'w', 'actor', '2026-01-01T00:00:00Z'); assert.notEqual(typeof mapped, 'string');
  if (typeof mapped === 'string') return;
  assert.equal(mapped.evidence.id, candidate.citation.id); assert.equal(mapped.evidence.text, 'A ação  registrada\nmantém os valores em 2025.');
  assert.equal(resolveMemoryAnchor(candidate.source, mapped.evidence.anchor), mapped.evidence.text);
  assert.equal(mapped.evidence.anchor.spans[0].from, original.indexOf('A ação'));
  assert.equal(literalQuoteText(mapped.evidence.text), quoted); assert.deepEqual(candidate, before);
});
test('legacy migration cannot join disjoint words or replace missing observations with import time', () => {
  const candidate = fixture('A equipe confirmou cem vagas. Outro assunto. A pesquisa continua amanhã.', 'A equipe confirmou A pesquisa continua amanhã.');
  assert.equal(mapLegacyCitation(candidate, 'w', 'actor', '2026-01-01T00:00:00Z'), 'nonliteral');
  const whole = fixture('A equipe confirmou cem vagas para o curso.', 'A equipe confirmou cem vagas para o curso.');
  const mapped = mapLegacyCitation(whole, 'w', 'actor', '2026-01-01T00:00:00Z'); assert.notEqual(typeof mapped, 'string');
  if (typeof mapped !== 'string') { assert.equal(mapped.evidence.metadata.recordedOn, null); assert.equal(mapped.evidence.metadata.publishedOn, null); assert.equal(mapped.evidence.personId, null); }
});
test('known HTTP source URLs survive migration and source lineage is independent of private curation links', () => {
  const candidate = fixture('A equipe confirmou cem vagas para o curso.', 'A equipe confirmou cem vagas para o curso.');
  candidate.source.sourceUrl = 'http://synthetic.test/original'; candidate.citation.podcastUrl = 'https://synthetic.test/curation';
  const mapped = mapLegacyCitation(candidate, 'w', 'actor', '2026-01-01T00:00:00Z'); assert.notEqual(typeof mapped, 'string');
  if (typeof mapped !== 'string') { assert.equal(mapped.material.primaryOrigin, 'http://synthetic.test/original'); assert.equal(mapped.material.metadata.originalUrl, candidate.source.sourceUrl); }
  delete candidate.source.sourceUrl;
  const fallback = mapLegacyCitation(candidate, 'w', 'actor', '2026-01-01T00:00:00Z');
  if (typeof fallback !== 'string') assert.equal(fallback.material.primaryOrigin, 'source:source');
});
test('two voices repeating the same words retain separate source anchors and attribution under one legacy alias', () => {
  const text = 'A equipe confirmou cem vagas para o curso.';
  const source = createTranscriptSource({ title: 'Synthetic voices', workspaceId: 'w', origin: 'interview', authorized: true,
    parsed: { format: 'speaker-lines', speakers: ['Ana', 'Bia'], segments: [{ id: 'ana', speaker: 'Ana', text }, { id: 'bia', speaker: 'Bia', text }], warnings: [] },
    speakerPeople: { Ana: 'person-a', Bia: 'person-b' } }, { actorId: 'actor', now: '2025-01-01T00:00:00Z', newId: () => 'voices' });
  const body: ArticleBody = { type: 'article', title: 'Synthetic', blocks: ['ana', 'bia'].map(segmentId => ({ id: segmentId, type: 'quote', inlines: [{ text }],
    sourceRefs: [{ kind: 'source', sourceId: source.id, sourceVersion: 1, locator: { type: 'segment', segmentId } }] })) };
  const origin = { productionId: 'p', kind: 'piece' as const, id: 'piece', storageHash: 'a'.repeat(32), bodyHash: articleHash(body), at: '2025-01-01T00:00:00Z' };
  const [a, b] = articleCitations(body, [source], origin); assert.ok(a && b && a !== 'ambiguous' && b !== 'ambiguous');
  assert.equal(a.citation.id, b.citation.id); assert.equal(a.citation.personId, 'person-a'); assert.equal(b.citation.personId, 'person-b');
  const one = mapLegacyCitation(a, 'w', 'actor', origin.at), two = mapLegacyCitation(b, 'w', 'actor', origin.at); assert.ok(typeof one !== 'string' && typeof two !== 'string');
  assert.notEqual(one.evidence.id, two.evidence.id); assert.equal(one.evidence.anchor.spans[0].segmentId, 'ana'); assert.equal(two.evidence.anchor.spans[0].segmentId, 'bia');
  const ambiguous: ArticleBody = { ...body, blocks: [{ ...body.blocks[0], sourceRefs: body.blocks.flatMap(block => block.sourceRefs ?? []) }] };
  assert.deepEqual(articleCitations(ambiguous, [source], { ...origin, bodyHash: articleHash(ambiguous) }), ['ambiguous']);
});
