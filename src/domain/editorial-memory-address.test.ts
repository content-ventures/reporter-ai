import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryAddressParams, readMemoryAddress, type MemoryAddress } from './editorial-memory-address.ts';

test('library links recover combined filters, dates, observation meaning, ordering and an opaque page cursor', () => {
  const state: MemoryAddress = { tab: 'statistic', query: { query: 'mercado & pesca', topics: ['produção', 'mercado'], personId: 'actual-person',
    institution: 'Instituto Sintético', company: 'Empresa', event: 'Feira', edition: '2026', materialId: 'original', materialKind: 'market_data',
    status: 'withdrawn', dateField: 'observation', from: '2025-01-01', to: '2025-12-31', verdict: 'disputed', minConfidence: 0,
    unused: false, useStage: 'approved', sort: 'relevance', cursor: 'opaque+/=cursor' } };
  const params = memoryAddressParams(new URLSearchParams('view=actual-context&reset=1&q=old&topic=old&cursor=old'), state);
  const read = readMemoryAddress(params); assert.ok(read.ok);
  assert.deepEqual(read.value, { ...state, query: { ...state.query, topics: ['mercado', 'produção'] } });
  assert.equal(params.get('view'), 'actual-context'); assert.equal(params.get('bankView'), 'statistic'); assert.equal(params.get('reset'), '1');
  const typing = readMemoryAddress(new URLSearchParams('q=peixe+')); assert.ok(typing.ok); assert.equal(typing.value.query.query, 'peixe ');
  assert.equal(params.get('cursor'), 'opaque+/=cursor'); assert.equal(params.getAll('q').length, 1);
  const clear = memoryAddressParams(params, { tab: 'all', query: { sort: 'newest', status: 'active', useStage: 'inserted' } });
  assert.equal(clear.toString(), 'view=actual-context&reset=1');
});

test('malformed, repeated or contradictory library selectors produce an explicit invalid-address state', () => {
  for (const value of ['bankView=unknown', 'kind=citation&bankView=statistic', 'bankView=all&bankView=statistic', 'q=one&q=two', 'sort=unknown', 'minConfidence=101', 'minConfidence=NaN',
    'unused=maybe', 'topic=', 'from=2025-01-01', 'dateField=observation&from=2025-02-30', 'dateField=published&from=2026-01-01&to=2025-01-01', 'cursor=',
    `q=${'x'.repeat(201)}`, `cursor=${'x'.repeat(4097)}`, new URLSearchParams(Array.from({ length: 21 }, (_, i) => ['topic', String(i)])).toString()]) {
    const result = readMemoryAddress(new URLSearchParams(value)); assert.equal(result.ok, false, value.slice(0, 120));
  }
  assert.deepEqual(readMemoryAddress(new URLSearchParams('kind=citation')), { ok: true, value: { tab: 'citation', query: {} } });
  assert.equal(readMemoryAddress(new URLSearchParams('dateField=observation&from=2024-02-29')).ok, true);
});

test('bank tab changes never create, replace or remove the actual member-inspection selector', () => {
  for (const view of ['', 'view=inspection-session']) {
    let params = new URLSearchParams(view);
    for (const tab of ['statistic', 'materials', 'selections', 'feedback', 'policy', 'citation', 'all'] as const) {
      params = memoryAddressParams(params, { tab, query: {} });
      assert.equal(params.get('view'), view ? 'inspection-session' : null);
      assert.deepEqual(readMemoryAddress(params), { ok: true, value: { tab, query: {} } });
    }
  }
});

test('feedback deep links preserve their own kind, target and signed page cursor without changing member inspection', () => {
  const state: MemoryAddress = { tab: 'feedback', query: {}, feedback: { kind: 'relevance', evidenceId: 'evidence', materialId: 'material', cursor: 'opaque+/=feedback' } };
  const params = memoryAddressParams(new URLSearchParams('view=actual-inspection&bankView=statistic&q=old'), state);
  assert.equal(params.get('view'), 'actual-inspection'); assert.deepEqual(readMemoryAddress(params), { ok: true, value: state });
  for (const query of ['bankView=feedback&feedbackKind=truth', 'feedbackKind=relevance', 'bankView=feedback&feedbackEvidence=%20', 'bankView=feedback&feedbackKind=relevance&feedbackKind=correction', `bankView=feedback&feedbackCursor=${'x'.repeat(4097)}`])
    assert.equal(readMemoryAddress(new URLSearchParams(query)).ok, false);
  const cleared = memoryAddressParams(params, { tab: 'all', query: {} }); assert.equal(cleared.toString(), 'view=actual-inspection');
});
