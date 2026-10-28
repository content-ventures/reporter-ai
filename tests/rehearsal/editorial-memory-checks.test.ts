import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import type { MemoryCheck, MemoryEvidenceView, MemoryMaterial, MemoryPage, MemorySupport } from '../../src/domain/editorial-memory.ts';
import { initialMemoryPolicy, memoryEvidenceRef } from '../../src/domain/editorial-memory.ts';
import { assessMemoryEvidence } from '../../src/domain/editorial-memory-check.ts';
import type { MemoryDetail, MemoryJob } from '../../src/ports/editorial-memory.ts';
import type { MemoryCheckClaim, MemoryChecker } from '../../src/server/editorial-memory-check-worker.ts';

const APP = 'http://127.0.0.1:3993';
const identities = ['editor', 'approver'].map(role => ({ subject: `checks-${role}`, email: `${role}@checks.test`, name: role, emailVerified: true }));
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>;
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function api(path: string, value?: unknown, key: string = randomUUID(), identity: typeof identities[number] | null = identities[0], origin = APP) {
  const { handleReporter } = await import('../../src/server/http.ts'), url = new URL(`${APP}/api/reporter/w/reporter-ai/memory/${path}`);
  return handleReporter(new Request(url, value === undefined ? {} : { method: 'POST', headers: { origin, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(value) }),
    ['w', 'reporter-ai', 'memory', ...url.pathname.split('/').slice(6).filter(Boolean)], { identify: async () => identity });
}
async function json<T>(path: string, value?: unknown, key?: string): Promise<T> {
  const response = await api(path, value, key); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
}
before(async () => {
  db = await startRehearsalDatabase(identities.map((identity, index) => ({ email: identity.email, role: index ? 'approver' : 'editor' })));
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_DEFAULT_PORTAL_ID: '10000000-0000-0000-0000-000000000101', REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP,
    REPORTER_MEMORY_MODE: 'on', REPORTER_WORKER_PASSWORD: db.workerPassword });
}, { timeout: 300000 });
after(async () => {
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop();
});
async function fixture(title: string) {
  const original = `QA SINTÉTICO ${title}: a produção fictícia cresceu em 2025. Sem valor factual real.`;
  const { material } = await json<{ material: MemoryMaterial }>('materials', { title, kind: 'report', text: original, authorized: true, primaryOrigin: title, originalFileId: null,
    metadata: { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null } });
  const { runMemoryJob } = await import('../../src/server/editorial-memory-worker.ts');
  assert.equal(await runMemoryJob('checks-extract-worker', new AbortController().signal, Date.now() + 1000000, async claim => ({ value: { overflow: false,
    evidence: [{ kind: 'citation', excerpt: original, from: 0, kinds: ['fact'] }] }, model: claim.job.model!, provider: 'synthetic', provider_request_id: null, usage_unit: 'tokens', input_units: 0, output_units: 0 })), true);
  const page = await json<MemoryPage<MemoryEvidenceView>>(`?materialId=${material.id}`); assert.equal(page.items.length, 1); return page.items[0].evidence;
}
const worker = async (provider: MemoryChecker) => (await import('../../src/server/editorial-memory-check-worker.ts')).runMemoryCheckJob('checks-actual-worker', new AbortController().signal, Date.now() + 1000000, provider);
function result(claim: MemoryCheckClaim, supports: MemoryCheck['supports'] = []) {
  return assessMemoryEvidence(claim.evidence, claim.material, claim.policy ?? initialMemoryPolicy(claim.job.workspaceId), claim.previous,
    { claims: [{ text: claim.evidence.anchor.excerpt, kind: 'fact', query: 'produção fictícia' }], supports, strength: { score: 4, reason: 'Specific synthetic test.' }, provider: 'synthetic', model: claim.job.model! },
    { actorId: claim.job.createdBy, now: new Date().toISOString(), newId: (prefix: string) => prefix });
}
test('check request is authenticated, idempotent, snapshot-bound and survives reload with an audited actor', async () => {
  const evidence = await fixture('queue'); const expected = memoryEvidenceRef(evidence), key = 'durable-check-request-key';
  const job = await json<MemoryJob>(`${evidence.id}/check`, { expected }, key);
  assert.deepEqual(await json(`${evidence.id}/check`, { expected }, key), job);
  assert.equal((await json<MemoryJob>(`${evidence.id}/check`, { expected })).id, job.id);
  assert.equal((await api(`${evidence.id}/check`, { expected: { ...expected, revision: 9 } })).status, 409);
  assert.equal((await api(`${evidence.id}/check?unknown=1`, { expected })).status, 422);
  assert.equal((await api(`${evidence.id}/check`, { expected, createdBy: randomUUID() })).status, 422);
  assert.equal((await api(`${evidence.id}/check`, { expected }, randomUUID(), identities[1])).status, 403);
  assert.equal((await api(`${evidence.id}/check`, { expected }, randomUUID(), null)).status, 401);
  assert.equal((await api(`${evidence.id}/check`, { expected }, randomUUID(), identities[0], 'https://foreign.invalid')).status, 403);
  const detail = await json<MemoryDetail>(evidence.id); assert.equal(detail.checkJob?.id, job.id); assert.equal('_lease' in detail.checkJob!, false);
  assert.equal(await worker(async claim => result(claim)), true);
  const done = await json<MemoryDetail>(evidence.id); assert.equal(done.checkJob?.status, 'completed'); assert.equal(done.check?.revision, 1);
  assert.equal(done.check?.verdict, 'not_validated'); assert.equal(done.check?.confidence, null); assert.equal(done.eligibility.usable, false);
  const [audit] = await owner("SELECT user_id,after_data FROM public.audit_log WHERE action='memory.check.completed' AND after_data->>'jobId'=$1", [job.id]);
  assert.equal(audit.user_id, job.createdBy); assert.deepEqual(audit.after_data.evidence, expected);
});
test('cancelling during a provider call fences out the late result and a new job may complete', async () => {
  const evidence = await fixture('cancel'); const job = await json<MemoryJob>(`${evidence.id}/check`, { expected: memoryEvidenceRef(evidence) });
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const running = worker(async claim => { started.resolve(); await release.promise; return result(claim); }); await started.promise;
  const current = await json<MemoryJob>(`jobs/${job.id}`); assert.equal(current.status, 'running'); assert.equal('_lease' in current, false);
  await json(`jobs/${job.id}/cancel`, { baseRevision: current.revision });
  const replacement = await json<MemoryJob>(`${evidence.id}/check`, { expected: memoryEvidenceRef(evidence) }); assert.notEqual(replacement.id, job.id);
  release.resolve(); await running;
  assert.equal((await json<MemoryDetail>(evidence.id)).check, null);
  assert.equal((await json<MemoryJob>(`jobs/${job.id}`)).status, 'cancelled');
  await worker(async claim => result(claim)); assert.equal((await json<MemoryDetail>(evidence.id)).check?.revision, 1);
});
test('corrections before and during a check invalidate the old snapshot without saving a check', async () => {
  for (const during of [false, true]) {
    const evidence = await fixture(`stale-${during}`); await json(`${evidence.id}/check`, { expected: memoryEvidenceRef(evidence) });
    const correct = () => json(`${evidence.id}/correction`, { expected: memoryEvidenceRef(evidence), reason: 'Synthetic metadata correction', changes: { kind: 'citation', metadata: { institution: 'Corrected synthetic institution' } } });
    let invoked = false;
    if (!during) await correct();
    await worker(async claim => { invoked = true; await correct(); return result(claim); }); assert.equal(invoked, during);
    const detail = await json<MemoryDetail>(evidence.id); assert.equal(detail.check, null); assert.equal(detail.checkJob?.status, 'failed'); assert.equal(detail.checkJob?.error, 'MEMORY_CHECK_STALE');
    assert.equal((await api(`jobs/${detail.checkJob!.id}/retry`, {})).status, 409);
  }
});
test('bounded provider failures can be explicitly retried without inventing checks or uses', async () => {
  const evidence = await fixture('retry'); const job = await json<MemoryJob>(`${evidence.id}/check`, { expected: memoryEvidenceRef(evidence) });
  let attempts = 0;
  for (let index = 0; index < 3; index++) await worker(async () => { attempts++; throw new Error('MEMORY_CHECK_INVALID'); });
  const failed = await json<MemoryJob>(`jobs/${job.id}`); assert.equal(failed.status, 'failed'); assert.equal(failed.attempts, 3); assert.equal(attempts, 3);
  assert.equal(await worker(async claim => result(claim)), false);
  const resumed = await json<MemoryJob>(`jobs/${job.id}/retry`, {}); assert.equal(resumed.generation, 2); assert.equal(resumed.attempts, 0);
  await worker(async claim => result(claim)); const detail = await json<MemoryDetail>(evidence.id);
  assert.equal(detail.checkJob?.status, 'completed'); assert.equal(detail.check?.revision, 1); assert.equal(detail.uses.inserted, 0); assert.equal(detail.uses.selected, 0);
});
test('internal evidence is collected from authorized current origins and revalidated at commit', async () => {
  const support = await fixture('support'); const evidence = await fixture('supported');
  await json(`${evidence.id}/check`, { expected: memoryEvidenceRef(evidence) });
  await worker(async claim => {
    const { transaction } = await import('../../src/server/database.ts');
    const sources = await transaction('worker', async client => (await client.query('SELECT public.reporter_memory_check_collect($1,$2) AS value', ['support', evidence.id])).rows[0].value as MemorySupport[]);
    const retained = sources.find(item => item.kind === 'internal' && item.evidence.id === support.id)!; assert.ok(retained);
    return result(claim, [{ claim: 0, relation: 'confirms', evidence: retained }]);
  });
  const checked = await json<MemoryDetail>(evidence.id); assert.equal(checked.check?.verdict, 'validated'); assert.equal(checked.check?.supports[0].evidence.kind, 'internal');
  await json(`${evidence.id}/check`, { expected: memoryEvidenceRef(evidence) });
  await worker(async claim => {
    await json(`${support.id}/correction`, { expected: memoryEvidenceRef(support), reason: 'Synthetic support changed while checking', changes: { kind: 'citation', metadata: { company: 'Changed' } } });
    return result(claim, [{ claim: 0, relation: 'confirms', evidence: checked.check!.supports[0].evidence }]);
  });
  const stale = await json<MemoryDetail>(evidence.id); assert.equal(stale.checkJob?.error, 'MEMORY_CHECK_STALE'); assert.equal(stale.checks.total, 1); assert.equal(stale.checkState, 'outdated'); assert.equal(stale.check, null);
  const page = await json<MemoryPage<MemoryEvidenceView>>(`?materialId=${evidence.materialId}`); assert.equal(page.items[0].checkState, 'outdated');
});
