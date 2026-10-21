import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleGateForPiece, articleMinimumQuotesFor } from './article-generation-policy.ts';
import { r1ArticleIssue } from './article-policy.ts';
import type { ArticleBody } from './article.ts';
import { foldRun } from './run-events.ts';
import { buildPieceView, evaluatePieceChecks } from './views.ts';
import { baseRecord, commitVersion, createKit, pieceIn } from './testing/scenario.ts';

const body: ArticleBody = { type: 'article', title: 'Título', blocks: [{ id: 'p1', type: 'paragraph', inlines: [{ text: 'fato '.repeat(600) + '.' }] }] };

test('the completed generation retains its quote policy through editing and later model settings', () => {
  const kit = createKit(), record = baseRecord(kit);
  const original = commitVersion(record, kit, 'article', body, { origin: 'generation' }); original.runId = 'run-zero';
  const policy = { minimumQuotes: 0 };
  const fold = foldRun([{ type: 'run.started', runId: 'run-zero', seq: 1, at: kit.now(), kind: 'article.generate',
    productionId: record.production.id, pieceId: original.pieceId, articlePolicy: policy,
    prompt: { key: 'writing', version: '1', hash: 'saved-configuration' }, model: { alias: 'openai/gpt-4.1', label: 'OpenAI', engine: 'provider' },
    inputs: [], steps: [], createdBy: 'editor' }, { type: 'run.completed', runId: 'run-zero', seq: 2, at: kit.now() }])!;
  policy.minimumQuotes = 2;
  record.runs.push(fold.run);
  assert.equal(fold.run.articlePolicy?.minimumQuotes, 0, 'the event captured its policy rather than a mutable settings object');
  let piece = pieceIn(record, 'article');
  assert.equal(articleMinimumQuotesFor(record, piece), 0);
  assert.equal(r1ArticleIssue(piece.draft.body as ArticleBody, record.sources, articleGateForPiece(record, piece)), undefined);
  assert.equal(evaluatePieceChecks(record, piece).find(check => check.id === 'article.quotes')?.status, 'pass');
  assert.deepEqual(buildPieceView(record, 'article', { now: kit.now() })?.articlePolicy, { minimumQuotes: 0 });
  commitVersion(record, kit, 'article', { ...body, title: 'Título editado' });
  piece = pieceIn(record, 'article');
  assert.equal(articleMinimumQuotesFor(record, piece), 0);
  assert.equal(articleMinimumQuotesFor(record, piece, original.body as ArticleBody), 0);
  const forged = structuredClone(piece.draft.body) as ArticleBody;
  forged.blocks[0] = { id: 'fake', type: 'quote', inlines: [{ text: 'Uma fala inventada.' }] };
  assert.equal(r1ArticleIssue(forged, record.sources, { ...articleGateForPiece(record, piece), minChars: 0, minWords: 0 }), 'UNSUPPORTED_ARTICLE_QUOTE');
});

test('a new legacy generation restores the legacy policy and restoring an earlier version restores its own policy', () => {
  const kit = createKit(), record = baseRecord(kit);
  const original = commitVersion(record, kit, 'article', body, { origin: 'generation' }); original.runId = 'run-zero';
  record.runs.push({ id: 'run-zero', kind: 'article.generate', productionId: record.production.id, pieceId: original.pieceId,
    articlePolicy: { minimumQuotes: 0 }, prompt: { key: 'writing', version: '1', hash: 'hash' },
    model: { alias: 'openai/gpt-4.1', label: 'OpenAI', engine: 'provider' }, inputs: [], steps: [], status: 'completed', createdBy: 'editor', createdAt: kit.now() });
  const legacy = commitVersion(record, kit, 'article', { ...body, title: 'Versão legada' }, { origin: 'generation' }); legacy.runId = 'legacy';
  let piece = pieceIn(record, 'article');
  assert.equal(articleMinimumQuotesFor(record, piece), undefined);
  assert.equal(articleGateForPiece(record, piece).minQuotes, 2);
  assert.equal(evaluatePieceChecks(record, piece).find(check => check.id === 'article.quotes')?.status, 'fail');
  assert.equal(articleMinimumQuotesFor(record, piece, original.body as ArticleBody), 0, 'historical versions do not inherit the latest run');
  const restored = commitVersion(record, kit, 'article', body, { origin: 'restore' }); restored.restoredFrom = original.id;
  piece = pieceIn(record, 'article');
  assert.equal(articleMinimumQuotesFor(record, piece), 0);
  assert.equal(evaluatePieceChecks(record, piece).find(check => check.id === 'article.quotes')?.status, 'pass');
  delete record.runs[0].articlePolicy;
  record.production.brief.format = 'note';
  assert.equal(articleGateForPiece(record, piece).minQuotes, 0, 'older note articles retain their format contract');
  record.production.brief.format = 'stand';
  assert.equal(articleGateForPiece(record, piece).minQuotes, 2);
});
