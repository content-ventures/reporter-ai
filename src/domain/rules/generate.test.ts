import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ArticleBody } from '../article.ts';
import { toVersionRef } from '../piece.ts';
import { stageState } from '../stage.ts';
import {
  approvedPackage,
  baseRecord,
  commitVersion,
  createKit,
  JOAO,
  recordDecision,
  sampleArticle,
} from '../testing/scenario.ts';
import { canGenerate } from './generate.ts';

describe('canGenerate', () => {
  test('article generation records source version and brief snapshot as run inputs', () => {
    const record = baseRecord(createKit());
    const result = canGenerate(record, 'article');
    assert.ok(result.ok);
    assert.deepEqual(
      result.value.inputs.map((input) => input.kind),
      ['source-version', 'brief'],
    );
    assert.deepEqual(result.value.parents, []);
  });

  test('unauthorised or missing material never reaches generation', () => {
    const blocked = canGenerate(baseRecord(createKit(), { authorized: false }), 'article');
    assert.equal(!blocked.ok && blocked.refusal.code, 'source_not_authorized');
    const empty = baseRecord(createKit());
    empty.sources = [];
    const missing = canGenerate(empty, 'article');
    assert.equal(!missing.ok && missing.refusal.code, 'source_missing');
  });

  test('the carousel needs the approved article and records that exact version', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const locked = canGenerate(record, 'carousel');
    assert.equal(!locked.ok && locked.refusal.code, 'parent_not_ready');
    assert.equal(!locked.ok && locked.refusal.message, 'Disponível após aprovar artigo.');
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    recordDecision(record, kit, v1, 'approved');
    const allowed = canGenerate(record, 'carousel');
    assert.ok(allowed.ok);
    assert.deepEqual(allowed.value.parents, [toVersionRef(v1)]);
    assert.deepEqual(allowed.value.inputs.at(-1), toVersionRef(v1));
  });

  test('refuses a second concurrent run and pieces outside the plan', () => {
    const kit = createKit();
    const record = baseRecord(kit, { plan: ['article'] });
    const notPlanned = canGenerate(record, 'carousel');
    assert.equal(!notPlanned.ok && notPlanned.refusal.code, 'not_planned');
    record.runs = [
      {
        id: 'run-1',
        kind: 'article.generate',
        productionId: record.production.id,
        pieceId: record.pieces[0].id,
        prompt: { key: 'k', version: '1', hash: 'h' },
        model: { alias: 'local-simulation', label: 'Simulação local', engine: 'simulated' },
        inputs: [],
        status: 'running',
        steps: [],
        createdBy: JOAO,
        createdAt: kit.now(),
      },
    ];
    const busy = canGenerate(record, 'article');
    assert.equal(!busy.ok && busy.refusal.code, 'run_in_progress');
  });
});

describe('delivery availability', () => {
  test('an approved package stays deliverable while a new article revision is under review', () => {
    const kit = createKit();
    const { record, article } = approvedPackage(kit);
    const v2 = commitVersion(record, kit, 'article', { ...(article.body as ArticleBody), title: 'Revisão' });
    recordDecision(record, kit, v2, 'changes_requested', { note: 'Rever título' });
    const journey = stageState(record);
    assert.equal(journey.currentStageId, 'article');
    const delivery = journey.stages.find((stage) => stage.id === 'delivery');
    assert.equal(delivery?.state, 'upcoming');
    assert.equal(delivery?.selectable, true);
  });
});
