import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Client, type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { createMemoryMaterial } from '../../src/domain/editorial-memory-import.ts';
import { assessMemoryEvidence } from '../../src/domain/editorial-memory-check.ts';
import { initialMemoryPolicy, memoryEvidenceRef, type MemoryPage, type MemoryPolicy, type MemorySelection, type MemoryStatistic } from '../../src/domain/editorial-memory.ts';
import type { MemoryCalibrationCase } from '../../src/domain/editorial-memory-calibration.ts';
import type { MemoryPolicyProposal, MemoryPolicyProposalInput } from '../../src/domain/editorial-memory-policy.ts';
import type { MemoryDetail, MemoryJob, MemoryWritingResult } from '../../src/ports/editorial-memory.ts';
import type { ReporterRequestContext } from '../../src/server/request-context.ts';
const PORTAL = '10000000-0000-0000-0000-000000000101', APP = 'http://127.0.0.1:3996';
const identities = ['admin', 'editor', 'approver'].map(role => ({ subject: `policy-${role}`, email: `${role}@policy.test`, name: role, emailVerified: true }));
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, contexts: ReporterRequestContext[];
async function owner(sql: string, values: unknown[] = []) { const client = new pg.Client({ connectionString: db.owner }); await client.connect(); try { return (await client.query(sql, values)).rows; } finally { await client.end(); } }
async function session<T>(run: (client: Client) => Promise<T>, actor = 0) {
  const client = new pg.Client({ connectionString: db.runtime }), context = contexts[actor]; await client.connect();
  try { await client.query('BEGIN'); await client.query("SELECT set_config('app.module_key','reporter_ai',true),set_config('app.access_mode','user',true),set_config('app.tenant_id',$1,true),set_config('app.portal_id',$2,true),set_config('app.user_id',$3,true),set_config('app.request_id',$4,true)", [context.tenant, context.portal, context.actor, randomUUID()]); const value = await run(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
}
async function api(path: string, input?: unknown, actor: number | null = 0, key: string = randomUUID()) {
  const { handleReporter } = await import('../../src/server/http.ts'), url = new URL(`${APP}/api/reporter/w/reporter-ai/${path}`);
  return handleReporter(new Request(url, input === undefined ? {} : { method: 'POST', headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) }),
    ['w', 'reporter-ai', ...url.pathname.split('/').slice(5)], { identify: async () => actor === null ? null : identities[actor], defer: () => {} });
}
async function json<T>(path: string, input?: unknown, actor = 0, key?: string): Promise<T> { const result = await api(path, input, actor, key); assert.equal(result.status, 200, await result.clone().text()); return result.json() as Promise<T>; }
const current = () => json<MemoryPolicy>('memory/policy');
async function manual(reason = 'Synthetic manual-policy proposal.') { const policy = await current(); return json<MemoryPolicyProposal>('memory/policy/proposals', { baseRevision: policy.revision, settings: { mode: 'review_required', thresholds: initialMemoryPolicy(PORTAL).thresholds }, criteria: null, cases: [], reason }); }
const activate = (proposal: MemoryPolicyProposal, key?: string) => json<MemoryPolicy>(`memory/policy/proposals/${proposal.id}/activate`, { baseRevision: proposal.baseRevision, reason: 'Explicit synthetic policy activation.' }, 0, key);
before(async () => {
  db = await startRehearsalDatabase(identities.map(identity => ({ email: identity.email, role: identity.name })));
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker, REPORTER_WORKER_PASSWORD: db.workerPassword,
    REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP, REPORTER_MEMORY_MODE: 'on' });
  const { resolveReporterContext } = await import('../../src/server/database.ts'); contexts = await Promise.all(identities.map(async identity => (await resolveReporterContext(identity, 'reporter-ai'))!));
}, { timeout: 300000 });
after(async () => { const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {}; await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop(); });
async function fixture(privateSource = false, count = 240) {
  const id = randomUUID(), text = `Cerca de ${count} pessoas foram atendidas em 2025.`, ctx = { actorId: contexts[1].actor, now: new Date().toISOString(), newId: (prefix: string) => `${prefix}-${id}` };
  const { material, source } = createMemoryMaterial({ title: 'Synthetic policy original', kind: 'report', text: text + '\n\nPRIVATE_UNSELECTED_POLICY_SENTINEL', authorized: true, primaryOrigin: `original-${id}`, originalFileId: null,
    metadata: { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null } }, PORTAL, ctx);
  await owner('INSERT INTO reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)', [PORTAL, source.id, source]);
  let productionId: string | null = null;
  if (privateSource) {
    const made = await json<{ ok: true; value: { productionId: string } }>('workspace', { method: 'createBlank', args: [{ title: 'Private calibration original', brief: { size: 'standard', sections: 2 } }], requestId: randomUUID() }, 1); productionId = made.value.productionId;
    await owner("UPDATE reporter_ed_productions SET doc=doc||jsonb_build_object('sourceIds',$2::jsonb,'restrictedTo',jsonb_build_array($3::text)),source_ids=$4 WHERE production_id=$1", [productionId, JSON.stringify([source.id]), contexts[2].actor, [source.id]]);
  }
  const evidence: MemoryStatistic = { id, workspaceId: PORTAL, materialId: material.id, revision: 0, kind: 'statistic', kinds: ['declared'], anchor: { source: material.source, excerpt: text, spans: [{ segmentId: 'original', from: 0, to: text.length }] },
    metadata: material.metadata, status: 'active', createdAt: ctx.now, updatedAt: ctx.now, supersedes: null, indicator: 'Atendimento sintético', value: { raw: String(count), decimal: String(count), lower: null, upper: null, scale: null },
    unit: 'pessoas', period: { label: '2025', from: null, to: null }, qualifier: 'Cerca de', geography: null, population: null, issuingInstitution: null, declaringPersonId: null };
  const policy = await session(async client => (await client.query("SELECT public.reporter_memory_get('policy','editorial-memory') AS value")).rows[0].value?.doc as MemoryPolicy | undefined) ?? initialMemoryPolicy(PORTAL);
  const check = assessMemoryEvidence(evidence, material, policy, null, { claims: [{ text, kind: 'declared' }], supports: [{ claim: 0, relation: 'confirms', evidence: { kind: 'external',
    url: `https://independent.test/report/${id}`, title: 'Synthetic independent source', excerpt: `Um levantamento independente confirmou o atendimento de ${count} pessoas no período.`, primaryOrigin: 'publisher:independent.test', retrievedAt: ctx.now, publishedOn: null } }], strength: null, provider: 'synthetic', model: 'synthetic' }, ctx);
  await session(async client => { for (const value of [{ kind: 'material', id: material.id, expected: null, doc: material, sourceId: source.id, productionId },
    { kind: 'evidence', id, expected: null, doc: evidence, fingerprint: memoryEvidenceRef(evidence).hash, parentKind: 'material', parentId: material.id },
    { kind: 'check', id: check.id, expected: null, doc: check, parentKind: 'evidence', parentId: id }]) await client.query('SELECT public.reporter_memory_put($1::jsonb)', [JSON.stringify(value)]); });
  return { evidence, check, material, source, productionId };
}
const annotate = (item: Awaited<ReturnType<typeof fixture>>, purpose: 'technical' | 'editorial' = 'technical', key?: string) => json<MemoryCalibrationCase>('memory/policy/cases', {
  evidence: memoryEvidenceRef(item.evidence), check: { id: item.check.id, revision: item.check.revision }, purpose, outcome: 'confirmed', reason: 'Synthetic schema/evaluator fixture; not real corpus acceptance.' }, 2, key);

test('factual annotations preserve exact originals, check and actual reviewer without changing the evidence or factual decision', async () => {
  const item = await fixture(), key = randomUUID(), before = await json<MemoryDetail>(`memory/${item.evidence.id}`), saved = await annotate(item, 'technical', key);
  assert.deepEqual(await annotate(item, 'technical', key), saved); assert.equal(saved.personId, contexts[2].actor); assert.equal(saved.bin, 'one_origin'); assert.equal(saved.structurallyUsable, true);
  assert.deepEqual(saved.source, item.material.source); assert.deepEqual(saved.evidence, memoryEvidenceRef(item.evidence)); assert.equal(saved.policyRevision, item.check.policyRevision);
  assert.equal(saved.excerpt, item.evidence.anchor.excerpt); assert.equal(saved.materialTitle, item.material.title);
  const after = await json<MemoryDetail>(`memory/${item.evidence.id}`); assert.deepEqual(after.evidence, before.evidence); assert.deepEqual(after.check, before.check); assert.deepEqual(after.decision, before.decision); assert.deepEqual(after.uses, before.uses);
  const payload = { evidence: saved.evidence, check: saved.check, purpose: 'technical', outcome: 'confirmed', reason: 'Synthetic annotation.' };
  for (const bad of [{ ...payload, confidence: 100 }, { ...payload, personId: contexts[0].actor }, { ...payload, reason: '' }]) assert.equal((await api('memory/policy/cases', bad)).status, 422);
  assert.equal((await api('memory/policy/cases', payload, null)).status, 401);
  await assert.rejects(session(client => client.query('SELECT * FROM reporter_memory_policy_records')), error => (error as { code: string }).code === '42501');
});
test('only admins propose and activate; competing proposals settle one audited revision and idempotent replay creates no extra version', async () => {
  const base = await current(), first = await manual(), second = await manual('A distinct concurrent alternative.'), key = randomUUID();
  for (const actor of [1, 2]) { assert.equal((await api('memory/policy/proposals', { ...first, actorId: contexts[0].actor }, actor)).status, 422); assert.equal((await api('memory/policy/proposals', { baseRevision: base.revision, settings: first.settings, criteria: null, cases: [], reason: 'Denied proposal.' }, actor)).status, 403);
    assert.equal((await api(`memory/policy/proposals/${first.id}`, undefined, actor)).status, 403); assert.equal((await api('memory/policy/versions', undefined, actor)).status, 403); }
  const payload = { baseRevision: base.revision, reason: 'Choose one reviewed policy.' };
  const replies = await Promise.all([api(`memory/policy/proposals/${first.id}/activate`, payload, 0, key), api(`memory/policy/proposals/${second.id}/activate`, payload)]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]); const winner = await replies.find(reply => reply.status === 200)!.json() as MemoryPolicy;
  assert.equal(winner.revision, base.revision + 1); assert.equal(winner.activatedBy, contexts[0].actor);
  if (replies[0].status === 200) assert.deepEqual(await json(`memory/policy/proposals/${first.id}/activate`, payload, 0, key), winner);
  const versions = await json<MemoryPage<MemoryPolicy>>('memory/policy/versions'); assert.equal(versions.items.filter(policy => policy.revision === winner.revision).length, 1);
  assert.equal((await api('memory/policy?unexpected=1')).status, 422);
});
test('policy changes fence valid in-flight checks, invalidate old review proofs and preserve frozen drafts, versions and use counts', async () => {
  const item = await fixture(), base = await current();
  await json(`memory/${item.evidence.id}/review`, { evidence: memoryEvidenceRef(item.evidence), check: { id: item.check.id, revision: 1 }, policyRevision: base.revision, previousSequence: 0, action: 'accept', reason: 'Synthetic original accepted.', supports: [] }, 2);
  const selected = await json<MemorySelection>('memory/selections', { baseRevision: 0, productionId: null, evidence: [memoryEvidenceRef(item.evidence)] });
  const made = await json<MemoryWritingResult>(`memory/selections/${selected.id}/write`, { baseRevision: selected.revision, title: 'Frozen policy fixture', brief: { size: 'standard', sections: 2 } });
  const frozen = await json<{ ok: true }>('workspace', { method: 'createVersion', args: [made.pieceId], requestId: randomUUID() }); assert.equal(frozen.ok, true);
  const contents = () => owner('SELECT kind,part_id,doc FROM reporter_ed_parts WHERE production_id=$1 ORDER BY kind,part_id', [made.productionId]);
  const before = await contents(), uses = (await json<MemoryDetail>(`memory/${item.evidence.id}`)).uses;
  const job = await json<MemoryJob>(`memory/${item.evidence.id}/check`, { expected: memoryEvidenceRef(item.evidence) }), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(); let produced = false;
  const { runMemoryCheckJob } = await import('../../src/server/editorial-memory-check-worker.ts');
  const worker = runMemoryCheckJob('policy-fence', new AbortController().signal, undefined, async claim => { entered.resolve(); await release.promise;
    const result = { ...item.check, revision: claim.previous!.revision + 1 }; produced = true; return result; });
  await Promise.race([entered.promise, worker.then(() => { throw new Error('Check ended before claiming.'); })]);
  let next: MemoryPolicy; try { next = await activate(await manual()); } finally { release.resolve(); assert.equal(await worker, true); assert.equal(produced, true); }
  assert.equal(next.revision, base.revision + 1); assert.equal((await json<MemoryJob>(`memory/jobs/${job.id}`)).status, 'cancelled');
  const after = await json<MemoryDetail>(`memory/${item.evidence.id}`); assert.equal(after.checkState, 'outdated'); assert.equal(after.eligibility.usable, false);
  assert.deepEqual(after.uses, uses); assert.deepEqual(after.evidence, item.evidence); assert.deepEqual(await contents(), before);
});
test('restoring an older policy creates another proposal/revision and never erases evidence added after that older version', async () => {
  await activate(await manual()); const added = await fixture(), base = await current(), before = await json<MemoryDetail>(`memory/${added.evidence.id}`);
  const proposed = await json<MemoryPolicyProposal>('memory/policy/restore', { baseRevision: base.revision, targetRevision: 1, reason: 'Restore baseline while keeping new records.' });
  assert.equal((await current()).revision, base.revision); assert.equal(proposed.restoredFrom, 1); const restored = await activate(proposed);
  assert.equal(restored.revision, base.revision + 1); assert.equal(restored.change!.restoredFrom, 1); assert.equal(restored.mode, 'review_required');
  assert.deepEqual((await json<MemoryDetail>(`memory/${added.evidence.id}`)).evidence, before.evidence);
  const versions = await json<MemoryPage<MemoryPolicy>>('memory/policy/versions'); assert.ok(versions.items.some(version => version.revision === 1 && version.activatedAt === null));
  const rows = await owner('SELECT doc FROM reporter_ed_sources WHERE source_id=$1', [added.source.id]); assert.deepEqual(rows[0].doc, added.source);
});
test('calibrated activation requires a passed editorial-purpose report and current source rights; public readers never receive private training counts', async () => {
  const items = [], refs: MemoryPolicyProposalInput['cases'] = [];
  for (let index = 0; index < 80; index++) { const item = await fixture(false, 1000 + index); items.push(item); const saved = await annotate(item, 'editorial'); refs.push({ id: saved.id, split: index < 40 ? 'training' : 'validation' }); }
  const base = await current(), input: MemoryPolicyProposalInput = { baseRevision: base.revision, settings: { mode: 'calibrated', thresholds: { fact: null, declared: 80, opinion: null, forecast: null } },
    criteria: { minTraining: 30, minValidation: 30, minOrigins: 10, minReleased: 30, minPrecision: 80, maxErrors: 0 }, cases: refs, reason: 'Synthetic editorial-purpose fixtures exercise the contract only; not real quality acceptance.' };
  const technical = await annotate(items[0], 'technical'), blocked = await json<MemoryPolicyProposal>('memory/policy/proposals', { ...input, cases: [{ id: technical.id, split: 'training' }, ...refs.slice(1)] });
  assert.equal(blocked.evaluation.activatable, false); assert.ok(blocked.evaluation.blockers.includes('EDITORIAL_CORPUS_REQUIRED'));
  assert.equal((await api(`memory/policy/proposals/${blocked.id}/activate`, { baseRevision: base.revision, reason: 'Cannot activate technical corpus.' })).status, 422);
  const measured = await json<MemoryPolicyProposal>('memory/policy/proposals', input); assert.equal(measured.evaluation.activatable, true); assert.equal(measured.evaluation.calibration.bins[0].confidence, 91);
  await json(`memory/materials/${items[0].material.id}/authorization`, { baseRevision: 1, authorized: false, reason: 'Withdraw an evaluated original.' });
  assert.equal((await api(`memory/policy/proposals/${measured.id}/activate`, { baseRevision: base.revision, reason: 'Withdrawn corpus refused.' })).status, 403);
  await json(`memory/materials/${items[0].material.id}/authorization`, { baseRevision: 2, authorized: true, reason: 'Restore original rights.' });
  const active = await activate(measured); assert.equal(active.calibration!.bins[0].confidence, 91);
  const publicPolicy = await json<MemoryPolicy>('memory/policy', undefined, 1); assert.equal(publicPolicy.calibration, undefined);
  const fresh = await fixture(), detail = await json<MemoryDetail>(`memory/${fresh.evidence.id}`, undefined, 1);
  assert.equal(detail.check!.confidence, 91); assert.equal(detail.eligibility.usable, true); assert.equal(detail.policy.calibration, undefined);
  await activate(await json<MemoryPolicyProposal>('memory/policy/restore', { baseRevision: active.revision, targetRevision: 1, reason: 'Return rehearsal to manual review.' }));
});
test('annotation replay and case pages hide private originals after current access is removed', async () => {
  const item = await fixture(true), key = randomUUID(), saved = await annotate(item, 'technical', key);
  assert.ok((await json<MemoryPage<MemoryCalibrationCase>>('memory/policy/cases?limit=100', undefined, 2)).items.some(row => row.id === saved.id));
  await owner("UPDATE reporter_ed_productions SET doc=doc||jsonb_build_object('restrictedTo','[]'::jsonb) WHERE production_id=$1", [item.productionId]);
  const page = await json<MemoryPage<MemoryCalibrationCase>>('memory/policy/cases?limit=100', undefined, 2); assert.ok(!page.items.some(row => row.id === saved.id));
  const input = { evidence: saved.evidence, check: saved.check, purpose: saved.purpose, outcome: saved.outcome, reason: saved.reason };
  assert.equal((await api('memory/policy/cases', input, 2, key)).status, 404);
});
test('policy audit failure rolls the activation, history and job fences back without storing a success receipt', async () => {
  const item = await fixture(), job = await json<MemoryJob>(`memory/${item.evidence.id}/check`, { expected: memoryEvidenceRef(item.evidence) }), proposal = await manual(), base = await current(), key = randomUUID();
  const before = (await owner('SELECT seq FROM reporter_memory_clock WHERE portal_id=$1', [PORTAL]))[0].seq;
  await owner("CREATE FUNCTION public.fail_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.policy.activate' THEN RAISE EXCEPTION 'SYNTHETIC_POLICY_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_policy_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_policy_audit()");
  const input = { baseRevision: base.revision, reason: 'Atomic policy activation.' };
  try { assert.equal((await api(`memory/policy/proposals/${proposal.id}/activate`, input, 0, key)).status, 500); }
  finally { await owner('DROP TRIGGER fail_policy_audit ON audit_log; DROP FUNCTION public.fail_policy_audit()'); }
  assert.deepEqual(await current(), base); assert.equal((await json<MemoryJob>(`memory/jobs/${job.id}`)).status, 'queued');
  assert.equal((await owner('SELECT seq FROM reporter_memory_clock WHERE portal_id=$1', [PORTAL]))[0].seq, before);
  assert.equal((await owner('SELECT count(*)::int AS n FROM reporter_memory_receipts WHERE request_id=$1', [key]))[0].n, 0);
  assert.equal((await json<MemoryPolicy>(`memory/policy/proposals/${proposal.id}/activate`, input, 0, key)).revision, base.revision + 1);
});
test('policy pages bind their resource, actor, size and snapshot; reads create no receipt, audit or use event', async () => {
  const counts = () => owner('SELECT (SELECT seq FROM reporter_memory_clock WHERE portal_id=$1) AS clock,(SELECT count(*) FROM reporter_memory_receipts WHERE portal_id=$1) AS receipts,(SELECT count(*) FROM audit_log WHERE portal_id=$1) AS audits', [PORTAL]);
  const before = await counts();
  for (const kind of ['cases', 'proposals', 'versions']) {
    const first = await json<MemoryPage<{ id: string; revision?: number }>>(`memory/policy/${kind}?limit=1`); assert.equal(first.items.length, 1); assert.ok(first.nextCursor);
    const cursor = encodeURIComponent(first.nextCursor), second = await json<MemoryPage<{ id: string; revision?: number }>>(`memory/policy/${kind}?limit=1&cursor=${cursor}`);
    assert.notDeepEqual(second.items[0], first.items[0]); assert.equal(second.total, first.total);
    assert.equal((await api(`memory/policy/${kind}?limit=2&cursor=${cursor}`)).status, 409);
    assert.equal((await api(`memory/policy/${kind === 'cases' ? 'proposals' : 'cases'}?limit=1&cursor=${cursor}`)).status, 409);
    if (kind === 'cases') assert.equal((await api(`memory/policy/cases?limit=1&cursor=${cursor}`, undefined, 2)).status, 409);
  }
  assert.deepEqual(await counts(), before);
  const first = await json<MemoryPage<MemoryCalibrationCase>>('memory/policy/cases?limit=1'); await annotate(await fixture());
  assert.equal((await api(`memory/policy/cases?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`)).status, 409);
});
