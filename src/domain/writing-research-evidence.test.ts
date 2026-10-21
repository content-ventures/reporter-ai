import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writingResearchEvidence } from './writing-research-evidence.ts';
import { writingSourceCandidates } from './writing-source.ts';
import { resolveSourceRef } from './source.ts';
import { createKit, sampleSource } from './testing/scenario.ts';
import { writingArticleBody } from './writing-article.ts';
import { r1ArticleQuotationIssue } from './article-policy.ts';
import type { WritingExternalSource } from './writing-research.ts';

const web: WritingExternalSource = { id: 'web-one', kind: 'external', provider: 'tavily', query: 'documentação de produto',
  title: 'Documentação primária', url: 'https://example.org/product', site: 'example.org',
  excerpt: 'O programa exige acompanhamento profissional durante todo o ciclo.', publishedOn: '2026-02-03', retrievedAt: '2026-10-21T15:00:00.000Z' };
const context = { runId: 'run-one', workspaceId: 'workspace-one', actorId: 'editor-one' };

test('web excerpts retain URL provenance across serialization and never become interview input', () => {
  const original = sampleSource(createKit());
  const evidence = writingResearchEvidence([web], context);
  const sources = JSON.parse(JSON.stringify([original, ...evidence.sources]));
  const ref = evidence.references.get(web.id)!;
  const resolved = resolveSourceRef(sources, ref)!;
  assert.equal(resolved.excerpt, web.excerpt);
  assert.equal(resolved.source.sourceUrl, web.url);
  assert.deepEqual(resolved.source.research, { provider: 'tavily', runId: context.runId, query: web.query, retrievedAt: web.retrievedAt, publishedOn: web.publishedOn });
  assert.equal(resolved.source.recordedOn, undefined, 'publication date is not a recording date');
  assert.deepEqual(resolved.source.speakers, []);
  assert.deepEqual(writingSourceCandidates(sources), writingSourceCandidates([original]));
  assert.deepEqual(writingResearchEvidence([web], context), evidence, 'retry keeps immutable reference identity');
  assert.notEqual(writingResearchEvidence([web], { ...context, runId: 'run-two' }).sources[0].id, evidence.sources[0].id);
});

test('article conversion keeps original and external references, and quotes resolve to exact excerpts', () => {
  const evidence = writingResearchEvidence([web], context);
  const body = writingArticleBody({ title: 'Contexto do programa', dek: '', titleEvidenceIds: [web.id], dekEvidenceIds: [],
    blocks: [{ id: 'context', type: 'paragraph', level: 2, text: `A documentação informa: “${web.excerpt}”`, items: [], evidenceIds: [web.id] }] },
  context.runId, ids => ids.map(id => evidence.references.get(id)!));
  assert.deepEqual(body.blocks[0].sourceRefs, [evidence.references.get(web.id)]);
  assert.equal(r1ArticleQuotationIssue(body, evidence.sources, 1), undefined);
  assert.notEqual(r1ArticleQuotationIssue(body, [], 1), undefined, 'absent evidence cannot validate a quote');
});
