import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ArticleBody } from '../article.ts';
import { toVersionRef } from '../piece.ts';
import type { ProductionRecord } from '../record.ts';
import { reviseSource } from '../source.ts';
import { stageState } from '../stage.ts';
import {
  addCarouselPiece,
  approvedPackage,
  baseRecord,
  commitVersion,
  createKit,
  recordDecision,
  requestReview,
  sampleArticle,
  sampleCarousel,
} from '../testing/scenario.ts';
import type { TestKit } from '../testing/scenario.ts';
import { canExport, defaultExportSelection, resolveExport } from './export.ts';
import type { MixedVersionsDetails } from './export.ts';
import { freshnessMessage, pieceFreshness } from './freshness.ts';
import { isDelivered, pieceStatus, productionStatus, productionTab } from './status.ts';

/** Article re-approved at v2 while the carousel stays approved on article v1. */
function reapprovedArticle(kit: TestKit) {
  const pack = approvedPackage(kit);
  const v2 = commitVersion(pack.record, kit, 'article', { ...(pack.article.body as ArticleBody), title: 'Título revisto' });
  recordDecision(pack.record, kit, v2, 'approved');
  return { ...pack, v2 };
}

function deliver(record: ProductionRecord, kit: TestKit): void {
  const items = canExport(record, defaultExportSelection(record));
  assert.ok(items.ok);
  kit.advance();
  record.deliveries = [
    ...record.deliveries,
    {
      id: 'del-1',
      productionId: record.production.id,
      channel: 'export',
      mode: 'download',
      items: items.value.map((item) => ({ version: item.version, decisionId: item.decisionId, format: item.kind === 'article' ? 'md' : 'png' })),
      attempts: [{ at: kit.now(), status: 'succeeded' }],
      status: 'completed',
      idempotencyKey: 'k',
      createdBy: 'person-joao',
      createdAt: kit.now(),
    },
  ];
}

describe('canExport (REQ-1.6)', () => {
  test('exports when every item is approved and derivatives match the exported parent', () => {
    const { record, article, carousel } = approvedPackage(createKit());
    const result = canExport(record, defaultExportSelection(record));
    assert.ok(result.ok);
    assert.deepEqual(
      result.value.map((item) => [item.kind, item.version.versionId]),
      [
        ['article', article.id],
        ['carousel', carousel.id],
      ],
    );
    assert.ok(result.value.every((item) => record.decisions.some((decision) => decision.id === item.decisionId)));
  });

  test('refuses mixed versions (article v2 with a carousel made from v1) and offers "Exportar com artigo v1"', () => {
    const kit = createKit();
    const { record, article, carousel } = reapprovedArticle(kit);
    const resolution = resolveExport(record);
    assert.equal(resolution.result.ok, false);
    assert.ok(!resolution.result.ok);
    assert.equal(resolution.result.refusal.code, 'mixed_versions');
    assert.equal(resolution.result.refusal.message, 'Carrossel foi feito a partir da v1 de artigo, mas o pacote usa a v2.');
    const details = resolution.result.refusal.details as MixedVersionsDetails;
    assert.equal(details.derivedFrom.versionId, article.id);
    assert.deepEqual(details.exportWithParent, [toVersionRef(article), toVersionRef(carousel)]);
    assert.ok(canExport(record, details.exportWithParent ?? []).ok, 'the consistent older package is still exportable');
  });

  test('refuses unapproved items, missing planned pieces, unknown versions and empty packages', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    const notApproved = canExport(record, [toVersionRef(v1)]);
    assert.equal(!notApproved.ok && notApproved.refusal.code, 'not_approved');
    recordDecision(record, kit, v1, 'approved');
    const missing = canExport(record, [toVersionRef(v1)]);
    assert.equal(!missing.ok && missing.refusal.code, 'missing_piece');
    assert.equal(!missing.ok && missing.refusal.message, 'Aprove carrossel antes de exportar.');
    const tampered = canExport(record, [{ ...toVersionRef(v1), hash: '1111111111111111' }]);
    assert.equal(!tampered.ok && tampered.refusal.code, 'unknown_version');
    const empty = canExport(record, []);
    assert.equal(!empty.ok && empty.refusal.code, 'nothing_to_export');
    const articleOnly = baseRecord(createKit(), { plan: ['article'] });
    const solo = commitVersion(articleOnly, kit, 'article', sampleArticle(articleOnly.sources[0]));
    recordDecision(articleOnly, kit, solo, 'approved');
    assert.ok(canExport(articleOnly, [toVersionRef(solo)]).ok);
  });
});

describe('staleness ("Desatualizado")', () => {
  test('a derivative becomes stale when its parent gets a newer approved version, and is never deleted', () => {
    const kit = createKit();
    const { record, carousel, v2 } = reapprovedArticle(kit);
    const carouselPiece = record.pieces.find((piece) => piece.kind === 'carousel');
    assert.ok(carouselPiece);
    const freshness = pieceFreshness(record, carouselPiece.id);
    assert.equal(freshness.state, 'stale');
    assert.equal(freshness.staleInputs[0].latest?.versionId, v2.id);
    assert.equal(freshnessMessage(freshness), 'O artigo aprovado mudou para a versão 2.');
    assert.equal(pieceStatus(record, 'carousel'), 'stale');
    assert.ok(record.versions.some((version) => version.id === carousel.id), 'the stale carousel version still exists');
    assert.equal(productionStatus(record), 'stale');
  });

  test('editing the approved article without a new approval keeps derivatives valid', () => {
    const kit = createKit();
    const { record, article } = approvedPackage(kit);
    commitVersion(record, kit, 'article', { ...(article.body as ArticleBody), title: 'Rascunho novo' });
    const carouselPiece = record.pieces.find((piece) => piece.kind === 'carousel');
    assert.ok(carouselPiece);
    assert.equal(pieceFreshness(record, carouselPiece.id).state, 'fresh');
    assert.equal(pieceStatus(record, 'article'), 'approved', 'the approval stays on vN while a new draft exists');
  });

  test('a corrected source version makes the content built from it stale', () => {
    const kit = createKit();
    const { record } = approvedPackage(kit);
    const revised = reviseSource(record.sources[0], [{ type: 'update', segmentId: 'seg-002', text: 'Começamos em 2014.' }], kit.ctx());
    assert.ok(revised.ok);
    record.sources = [revised.value];
    const articlePiece = record.pieces.find((piece) => piece.kind === 'article');
    assert.ok(articlePiece);
    const freshness = pieceFreshness(record, articlePiece.id);
    assert.equal(freshness.state, 'stale');
    assert.equal(freshness.staleSources[0].latest.sourceVersion, 2);
    assert.equal(freshnessMessage(freshness), 'O material foi corrigido (versão 2).');
  });
});

describe('derived status and journey', () => {
  test('new production: material done, article current, carousel and delivery blocked with reasons', () => {
    const record = baseRecord(createKit());
    const journey = stageState(record);
    assert.deepEqual(
      journey.stages.map((stage) => [stage.id, stage.state]),
      [
        ['source', 'done'],
        ['article', 'current'],
        ['carousel', 'blocked'],
        ['delivery', 'blocked'],
      ],
    );
    assert.equal(journey.stages[2].blockedReason, 'Disponível após aprovar o artigo.');
    assert.equal(journey.stages[3].blockedReason, 'Disponível após aprovar o artigo e o carrossel.');
    assert.equal(journey.stages[2].selectable, false);
    assert.equal(journey.status, 'draft');
    assert.equal(pieceStatus(record, 'article'), 'not_started');
    assert.equal(pieceStatus(record, 'carousel'), 'locked');
  });

  test('unauthorised material keeps the journey on Material and blocks the article', () => {
    const record = baseRecord(createKit(), { authorized: false });
    const journey = stageState(record);
    assert.equal(journey.currentStageId, 'source');
    assert.equal(journey.stages[1].state, 'blocked');
    assert.equal(journey.stages[1].blockedReason, 'Disponível após autorizar o material.');
  });

  test('review → changes requested → resubmitted → approved', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    assert.equal(pieceStatus(record, 'article'), 'draft');
    requestReview(record, kit, v1);
    assert.equal(pieceStatus(record, 'article'), 'in_review');
    assert.equal(productionStatus(record), 'in_review');
    assert.equal(productionTab(productionStatus(record)), 'in_review');
    recordDecision(record, kit, v1, 'changes_requested', { note: 'Encurtar' });
    assert.equal(pieceStatus(record, 'article'), 'changes_requested');
    assert.equal(stageState(record).stages[1].state, 'current');
    const v2 = commitVersion(record, kit, 'article', { ...sampleArticle(record.sources[0]), title: 'Mais curto' });
    assert.equal(pieceStatus(record, 'article'), 'changes_requested', 'stays until resubmitted');
    requestReview(record, kit, v2);
    assert.equal(pieceStatus(record, 'article'), 'in_review');
    recordDecision(record, kit, v2, 'approved');
    assert.equal(pieceStatus(record, 'article'), 'approved');
    assert.equal(pieceStatus(record, 'carousel'), 'not_started');
    const journey = stageState(record);
    assert.deepEqual(journey.stages.map((stage) => stage.state), ['done', 'done', 'current', 'blocked']);
    assert.equal(journey.status, 'draft');
  });

  test('all approved → approved; delivered → completed; a newer approval reopens it', () => {
    const kit = createKit();
    const { record, article } = approvedPackage(kit);
    assert.equal(productionStatus(record), 'approved');
    assert.equal(stageState(record).currentStageId, 'delivery');
    assert.equal(stageState(record).stages[3].status, 'ready');
    deliver(record, kit);
    assert.equal(isDelivered(record), true);
    assert.equal(productionStatus(record), 'completed');
    assert.equal(stageState(record).stages[3].state, 'current');
    assert.equal(stageState(record).stages[3].status, 'completed');
    const v2 = commitVersion(record, kit, 'article', { ...(article.body as ArticleBody), title: 'Pós-entrega' });
    recordDecision(record, kit, v2, 'approved');
    assert.equal(isDelivered(record), false);
    assert.equal(productionStatus(record), 'stale');
  });

  test('a running generation shows as generating; a failed one without output as error', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const run = {
      id: 'run-1',
      kind: 'article.generate' as const,
      productionId: record.production.id,
      pieceId: record.pieces[0].id,
      prompt: { key: 'k', version: '1', hash: 'h' },
      model: { alias: 'local-simulation', label: 'Simulação local', engine: 'simulated' as const },
      inputs: [],
      status: 'running' as const,
      steps: [],
      createdBy: 'person-joao',
      createdAt: kit.now(),
    };
    record.runs = [run];
    assert.equal(pieceStatus(record, 'article'), 'generating');
    assert.equal(productionStatus(record), 'generating');
    record.runs = [{ ...run, status: 'failed', error: { code: 'x', message: 'Falhou', retryable: true } }];
    assert.equal(pieceStatus(record, 'article'), 'failed');
    assert.equal(stageState(record).stages[1].state, 'current');
    assert.equal(productionStatus(record), 'failed');
  });

  test('archived productions and plans without carousel', () => {
    const kit = createKit();
    const record = baseRecord(kit, { plan: ['article'] });
    assert.deepEqual(stageState(record).stages.map((stage) => stage.id), ['source', 'article', 'delivery']);
    record.production = { ...record.production, archivedAt: kit.now() };
    assert.equal(productionStatus(record), 'archived');
  });

  test('carousel in review with a stale input keeps "in_review" and flags freshness', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const a1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    recordDecision(record, kit, a1, 'approved');
    addCarouselPiece(record, kit);
    const c1 = commitVersion(record, kit, 'carousel', sampleCarousel(), { inputs: [toVersionRef(a1)] });
    requestReview(record, kit, c1);
    const a2 = commitVersion(record, kit, 'article', { ...sampleArticle(record.sources[0]), title: 'Novo' });
    recordDecision(record, kit, a2, 'approved');
    assert.equal(pieceStatus(record, 'carousel'), 'in_review');
    const piece = record.pieces.find((candidate) => candidate.kind === 'carousel');
    assert.ok(piece);
    assert.equal(pieceFreshness(record, piece.id).state, 'stale');
  });
});
