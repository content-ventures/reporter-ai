import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ChangeNotice } from '../ports/common.ts';
import type { DraftView, ReviewView } from '../ports/production-queries.ts';
import { createRuntime } from '../runtime/create-runtime.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { pngFile } from '../ports/contracts/assets.contract.ts';
import {
  approvalsQuery,
  assetQuery,
  assetsQuery,
  assetUrlQuery,
  compareQuery,
  feedbackQuery,
  overviewQuery,
  peopleQuery,
  pieceQuery,
  productionQuery,
  productionsQuery,
  reviewQuery,
  sessionQuery,
  sourceQuery,
} from './query-specs.ts';

const notice = (overrides: Partial<ChangeNotice> = {}): ChangeNotice => ({ scope: 'productions', productionIds: [], activity: [], ...overrides });

describe('query specs: keys', () => {
  it('are stable for equal arguments and distinct otherwise', () => {
    assert.equal(productionsQuery({ tab: 'in_review', search: 'couro' }).key, productionsQuery({ search: 'couro', tab: 'in_review' }).key);
    assert.equal(productionsQuery().key, productionsQuery({}).key);
    assert.notEqual(productionsQuery({ tab: 'in_review' }).key, productionsQuery({ tab: 'in_review' }, { page: 2 }).key);
    assert.notEqual(productionQuery('prod-1').key, pieceQuery('prod-1').key);
    assert.equal(sourceQuery('src-1').key, sourceQuery('src-1', undefined).key);
    assert.notEqual(sourceQuery('src-1').key, sourceQuery('src-1', 2).key);
  });
});

describe('query specs: invalidation', () => {
  it('a production refetches for any production change (its approvals read other sends), sessions and resets', () => {
    const affects = productionQuery('prod-1').affectedBy;
    assert.equal(affects(notice({ productionIds: ['prod-1'] }), undefined), true);
    assert.equal(affects(notice({ productionIds: ['prod-2'] }), undefined), true);
    assert.equal(affects(notice({ scope: 'runs', productionIds: ['prod-1'] }), undefined), true);
    assert.equal(affects(notice({ scope: 'runs', productionIds: ['prod-2'] }), undefined), false);
    assert.equal(affects(notice({ scope: 'feedback', productionIds: ['prod-2'] }), undefined), false);
    assert.equal(affects(notice(), undefined), true);
    assert.equal(affects(notice({ scope: 'session', productionIds: ['prod-2'] }), undefined), true);
    assert.equal(affects(notice({ scope: 'reset' }), undefined), true);
  });

  it('a draft is scoped to its production once known', () => {
    const affects = pieceQuery('piece-1').affectedBy;
    const draft = { productionId: 'prod-1' } as DraftView;
    assert.equal(affects(notice({ productionIds: ['prod-2'] }), undefined), true, 'unknown production: refetch');
    assert.equal(affects(notice({ productionIds: ['prod-2'] }), draft), false);
    assert.equal(affects(notice({ scope: 'runs', productionIds: ['prod-1'] }), draft), true);
  });

  it('every read that shows approval data refetches on any production change (CONTRACT §2.4)', () => {
    const review = { productionId: 'prod-1' } as ReviewView;
    for (const affects of [approvalsQuery('to_approve').affectedBy, overviewQuery('7d').affectedBy, productionsQuery().affectedBy, productionQuery('prod-1').affectedBy]) {
      assert.equal(affects(notice({ productionIds: ['prod-2'] }), undefined), true);
      assert.equal(affects(notice({ scope: 'session' }), undefined), true);
    }
    assert.equal(reviewQuery('piece-1').affectedBy(notice({ productionIds: ['prod-2'] }), review), true, '"Próxima: …" comes from the queue');
    assert.equal(approvalsQuery('returned').affectedBy(notice({ scope: 'feedback' }), undefined), false);
    assert.notEqual(approvalsQuery('to_approve').key, approvalsQuery('returned').key);
  });

  it('comparisons of immutable versions change only on reset; feedback and session have their own scopes', () => {
    const compare = compareQuery('piece-1', 'ver-1', 'ver-2').affectedBy;
    assert.equal(compare(notice({ productionIds: ['prod-1'] }), { pieceId: 'piece-1' } as never), false);
    assert.equal(compare(notice({ scope: 'reset' }), { pieceId: 'piece-1' } as never), true);
    assert.equal(feedbackQuery().affectedBy(notice({ scope: 'runs' }), undefined), false);
    assert.equal(feedbackQuery().affectedBy(notice({ scope: 'feedback' }), undefined), true);
    assert.equal(sessionQuery().affectedBy(notice({ scope: 'productions' }), undefined), false);
    assert.equal(sessionQuery().affectedBy(notice({ scope: 'session' }), undefined), true);
  });
});

describe('query specs: fetching through the runtime', () => {
  let runtime: Runtime;
  before(() => {
    runtime = createRuntime({ storage: null, latency: false, adoptLiveRuns: false });
  });
  after(() => runtime.dispose());

  it('answers lookups as results and wraps plain reads', async () => {
    const missing = await productionQuery('prod-inexistente').fetch(runtime);
    assert.equal(!missing.ok && missing.refusal.code, 'not_found');
    const found = await productionQuery('prod-aurora').fetch(runtime);
    assert.ok(found.ok && found.value.title.startsWith('Aurora'));
    const session = await sessionQuery().fetch(runtime);
    assert.ok(session.ok);
    assert.equal(session.value.mode, 'simulated');
    assert.ok(session.value.current, 'someone is acting');
    assert.ok(session.value.members.length >= 2, 'editor and approver');
  });
});

describe('query specs: images', () => {
  it('refetch on image changes of their production, workspace-wide image changes and resets only', () => {
    const list = assetsQuery('prod-1').affectedBy;
    assert.equal(list(notice({ scope: 'assets', productionIds: ['prod-1'] }), undefined), true);
    assert.equal(list(notice({ scope: 'assets', productionIds: ['prod-2'] }), undefined), false);
    assert.equal(list(notice({ scope: 'assets' }), undefined), true, 'store opened or reset');
    assert.equal(list(notice({ scope: 'productions', productionIds: ['prod-1'] }), undefined), false);
    assert.equal(list(notice({ scope: 'reset' }), undefined), true);
    assert.equal(assetQuery('img-1').affectedBy(notice({ scope: 'assets', productionIds: ['prod-9'] }), undefined), true);
    assert.equal(assetUrlQuery('img-1').affectedBy(notice({ scope: 'runs' }), undefined), false);
    assert.equal(compareQuery('piece-1', 'v1', 'v2').affectedBy(notice({ scope: 'assets' }), { pieceId: 'piece-1' } as never), true, 'credits show in the diff');
    assert.equal(peopleQuery().affectedBy(notice({ scope: 'assets' }), undefined), false);
    assert.notEqual(assetQuery('img-1').key, assetUrlQuery('img-1').key);
  });

  it('fetch metadata, lists and display URLs through the runtime', async () => {
    const runtime = createRuntime({ storage: null, latency: false, adoptLiveRuns: false });
    try {
      const put = await runtime.assets.put({ type: 'upload', file: pngFile(), fileName: 'capa.png' }, { productionId: 'prod-aurora', authorized: true });
      assert.ok(put.ok);
      const list = await assetsQuery('prod-aurora').fetch(runtime);
      assert.ok(list.ok && list.value.some((asset) => asset.id === put.value.id));
      const one = await assetQuery(put.value.id).fetch(runtime);
      assert.ok(one.ok && one.value.origin.type === 'upload');
      const url = await assetUrlQuery(put.value.id).fetch(runtime);
      assert.ok(url.ok && url.value.startsWith('blob:'));
      const missing = await assetQuery('img-nada').fetch(runtime);
      assert.equal(!missing.ok && missing.refusal.message, 'Imagem não encontrada neste navegador.');
    } finally {
      runtime.dispose();
    }
  });
});
