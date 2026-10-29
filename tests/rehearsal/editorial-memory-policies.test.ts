import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Client, type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { createMemoryMaterial } from '../../src/domain/editorial-memory-import.ts';
import { assessMemoryEvidence } from '../../src/domain/editorial-memory-check.ts';
import { initialMemoryPolicy, memoryEvidenceRef, type MemoryCheck, type MemoryPage, type MemoryPolicy, type MemorySelection, type MemoryStatistic } from '../../src/domain/editorial-memory.ts';
import type { MemoryPolicyReassessmentInput } from '../../src/domain/editorial-memory-reassessment.ts';
import type { MemoryCalibrationCase } from '../../src/domain/editorial-memory-calibration.ts';
import type { MemoryPolicyProposal, MemoryPolicyProposalInput } from '../../src/domain/editorial-memory-policy.ts';
import type { MemoryDetail, MemoryJob, MemoryWritingResult } from '../../src/ports/editorial-memory.ts';
import type { ReporterRequestContext } from '../../src/server/request-context.ts';
const PORTAL = '10000000-0000-0000-0000-000000000101', APP = 'http://127.0.0.1:3996';
const identities = ['admin', 'editor', 'approver'].map(role => ({ subject: `policy-${role}`, email: `${role}@policy.test`, name: role, emailVerified: true }));
identities.push({ subject: 'policy-other-editor', email: 'other-editor@policy.test', name: 'editor', emailVerified: true });
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, contexts: ReporterRequestContext[];
async function owner(sql: string, values: unknown[] = []) { const client = new pg.Client({ connectionString: db.owner }); await client.connect(); try { return (await client.query(sql, values)).rows; } finally { await client.end(); } }
async function session<T>(run: (client: Client) => Promise<T>, actor = 0, context = contexts[actor]) {
  const client = new pg.Client({ connectionString: db.runtime }); await client.connect();
  try { await client.query('BEGIN'); await client.query("SELECT set_config('app.module_key','reporter_ai',true),set_config('app.access_mode',$5,true),set_config('app.tenant_id',$1,true),set_config('app.portal_id',$2,true),set_config('app.user_id',$3,true),set_config('app.request_id',$4,true)", [context.tenant, context.portal, context.actor, randomUUID(), context.administrative ? 'platform_workspace' : 'user']); const value = await run(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
}
async function api(path: string, input?: unknown, actor: number | null = 0, key: string = randomUUID(), slug = 'reporter-ai') {
  const { handleReporter } = await import('../../src/server/http.ts'), url = new URL(`${APP}/api/reporter/w/${slug}/${path}`);
  return handleReporter(new Request(url, input === undefined ? {} : { method: 'POST', headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) }),
    ['w', slug, ...url.pathname.split('/').slice(5)], { identify: async () => actor === null ? null : identities[actor], defer: () => {} });
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
  const existing = await fixture(false, 999), active = await activate(measured); assert.equal(active.calibration!.bins[0].confidence, 91);
  const evaluated = await json<MemoryCheck>(`memory/${existing.evidence.id}/reassess-policy`, reassessmentInput((await json<MemoryDetail>(`memory/${existing.evidence.id}`))), 1);
  assert.equal(evaluated.confidence, 91); assert.equal(evaluated.checkedAt, existing.check.checkedAt); assert.deepEqual(evaluated.supports, existing.check.supports);
  const publicPolicy = await json<MemoryPolicy>('memory/policy', undefined, 1); assert.equal(publicPolicy.calibration, undefined);
  const fresh = await fixture(), detail = await json<MemoryDetail>(`memory/${fresh.evidence.id}`, undefined, 1);
  assert.equal(detail.check!.confidence, 91); assert.equal(detail.eligibility.usable, true); assert.equal(detail.policy.calibration, undefined);
  await json(`memory/${fresh.evidence.id}/check`, { expected: memoryEvidenceRef(fresh.evidence) });
  const { runMemoryCheckJob } = await import('../../src/server/editorial-memory-check-worker.ts');
  assert.equal(await runMemoryCheckJob('calibrated-policy-check', new AbortController().signal, undefined, async claim => assessMemoryEvidence(claim.evidence, claim.material, claim.policy!, claim.previous,
    { claims: [{ text: claim.evidence.anchor.excerpt, kind: 'declared' }], supports: fresh.check.supports, strength: null, provider: 'synthetic', model: claim.job.model! },
    { actorId: claim.job.createdBy, now: new Date().toISOString(), newId: () => claim.evidence.id })), true);
  const persisted = await json<MemoryDetail>(`memory/${fresh.evidence.id}`); assert.equal(persisted.check!.confidence, 91); assert.equal(persisted.check!.revision, fresh.check.revision + 1);
  const invalidJob = await json<MemoryJob>(`memory/${fresh.evidence.id}/check`, { expected: memoryEvidenceRef(fresh.evidence) });
  await assert.rejects(runMemoryCheckJob('invented-policy-score', new AbortController().signal, undefined, async claim => ({ ...assessMemoryEvidence(claim.evidence, claim.material, claim.policy!, claim.previous,
    { claims: [{ text: claim.evidence.anchor.excerpt, kind: 'declared' }], supports: fresh.check.supports, strength: null, provider: 'synthetic', model: claim.job.model! },
    { actorId: claim.job.createdBy, now: new Date().toISOString(), newId: () => claim.evidence.id }), confidence: 100 })), /MEMORY_CONFLICT/);
  const invalid = await json<MemoryJob>(`memory/jobs/${invalidJob.id}`); await json(`memory/jobs/${invalid.id}/cancel`, { baseRevision: invalid.revision });
  assert.deepEqual((await json<MemoryDetail>(`memory/${fresh.evidence.id}`)).check, persisted.check);
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
function reassessmentInput(detail: MemoryDetail): MemoryPolicyReassessmentInput {
  const proof = detail.policyReassessment; assert.ok(proof);
  return { evidence: proof.evidence, check: proof.check, policyRevision: proof.policyRevision, reason: 'Explicit synthetic reevaluation of the saved proof.' };
}
test('reapplying a policy preserves saved factual proof/date and decisions, audits the real editor and makes no provider call', async () => {
  const item = await fixture(), policy = await current();
  await json(`memory/${item.evidence.id}/review`, { evidence: memoryEvidenceRef(item.evidence), check: { id: item.check.id, revision: 1 }, policyRevision: policy.revision, previousSequence: 0, action: 'accept', reason: 'Synthetic original review.', supports: [] }, 2);
  await activate(await manual());
  const detail = await json<MemoryDetail>(`memory/${item.evidence.id}`), input = reassessmentInput(detail), key = randomUUID(); assert.equal(detail.checkState, 'outdated');
  const before = await owner('SELECT (SELECT seq FROM reporter_memory_clock WHERE portal_id=$1) AS clock,(SELECT count(*) FROM audit_log WHERE portal_id=$1) AS audits,(SELECT count(*) FROM reporter_memory_receipts WHERE portal_id=$1) AS receipts', [PORTAL]);
  await json(`memory/${item.evidence.id}`);
  assert.deepEqual(await owner('SELECT (SELECT seq FROM reporter_memory_clock WHERE portal_id=$1) AS clock,(SELECT count(*) FROM audit_log WHERE portal_id=$1) AS audits,(SELECT count(*) FROM reporter_memory_receipts WHERE portal_id=$1) AS receipts', [PORTAL]), before);
  const fetch = globalThis.fetch; let calls = 0, result: MemoryCheck;
  globalThis.fetch = async () => { calls++; throw new Error('Reassessment must not call any provider.'); };
  try { result = await json<MemoryCheck>(`memory/${item.evidence.id}/reassess-policy`, input, 1, key); assert.deepEqual(await json(`memory/${item.evidence.id}/reassess-policy`, input, 1, key), result); }
  finally { globalThis.fetch = fetch; }
  assert.equal(calls, 0); assert.equal(result.policyEvaluation!.personId, contexts[1].actor); assert.equal(result.checkedAt, item.check.checkedAt); assert.equal(result.confidence, null);
  assert.deepEqual(result.claims, item.check.claims); assert.deepEqual(result.supports, item.check.supports); assert.equal(result.provider, item.check.provider);
  const after = await json<MemoryDetail>(`memory/${item.evidence.id}`); assert.equal(after.checkState, 'current'); assert.equal(after.policyReassessment, null); assert.equal(after.eligibility.usable, false);
  assert.deepEqual(after.decision, detail.decision); assert.deepEqual(after.evidence, detail.evidence); assert.deepEqual(after.uses, detail.uses); assert.equal(after.checks.total, 2);
  const audit = await owner("SELECT user_id,after_data FROM audit_log WHERE portal_id=$1 AND action='memory.check.reassess' AND after_data->>'id'=$2", [PORTAL, item.evidence.id]);
  assert.equal(audit.length, 1); assert.equal(audit[0].user_id, contexts[1].actor);
  assert.equal((await api(`memory/${item.evidence.id}/review`, { evidence: input.evidence, check: input.check, policyRevision: input.policyRevision, previousSequence: 1, action: 'accept', reason: 'Old check cannot authorize a new review.', supports: [] }, 2)).status, 409);
  assert.equal((await api(`memory/${item.evidence.id}/reassess-policy`, { ...input, confidence: 100 })).status, 422);
  assert.equal((await api(`memory/${item.evidence.id}/reassess-policy`, input, 2)).status, 403);
});
test('concurrent reevaluations settle one revision; a fresh check job and a newer policy refuse the captured proof', async () => {
  const item = await fixture(); await activate(await manual()); const input = reassessmentInput(await json<MemoryDetail>(`memory/${item.evidence.id}`));
  const replies = await Promise.all([api(`memory/${item.evidence.id}/reassess-policy`, input, 1), api(`memory/${item.evidence.id}/reassess-policy`, input)]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
  const another = await fixture(); await activate(await manual()); const proof = reassessmentInput(await json<MemoryDetail>(`memory/${another.evidence.id}`));
  const job = await json<MemoryJob>(`memory/${another.evidence.id}/check`, { expected: memoryEvidenceRef(another.evidence) });
  assert.equal((await json<MemoryDetail>(`memory/${another.evidence.id}`)).policyReassessment, null);
  assert.equal((await api(`memory/${another.evidence.id}/reassess-policy`, proof)).status, 409); assert.equal((await json<MemoryJob>(`memory/jobs/${job.id}`)).status, 'queued');
  await json(`memory/jobs/${job.id}/cancel`, { baseRevision: job.revision }); await activate(await manual());
  assert.equal((await api(`memory/${another.evidence.id}/reassess-policy`, proof)).status, 409);
});
test('changed original/evidence/support and withdrawn authorization never become reusable through policy reevaluation', async () => {
  const items = await Promise.all([fixture(false, 301), fixture(false, 302), fixture(false, 303), fixture(false, 304)]), supporting = await fixture(false, 305), target = items[3];
  const check = assessMemoryEvidence(target.evidence, target.material, await current(), target.check, { claims: [{ text: target.evidence.anchor.excerpt, kind: 'declared' }], supports: [{ claim: 0, relation: 'confirms', evidence: { kind: 'internal', evidence: memoryEvidenceRef(supporting.evidence), primaryOrigin: supporting.material.primaryOrigin, excerpt: supporting.evidence.anchor.excerpt } }], strength: null, provider: 'synthetic', model: 'synthetic' }, { actorId: contexts[0].actor, now: new Date().toISOString(), newId: () => target.check.id });
  await session(client => client.query('SELECT public.reporter_memory_put($1::jsonb)', [JSON.stringify({ kind: 'check', id: target.check.id, expected: 0, parentKind: 'evidence', parentId: target.evidence.id, doc: check })]));
  await activate(await manual()); const inputs = await Promise.all(items.map(async item => reassessmentInput(await json<MemoryDetail>(`memory/${item.evidence.id}`))));
  await json(`memory/${items[0].evidence.id}/correction`, { expected: inputs[0].evidence, reason: 'Synthetic changed context.', changes: { kind: 'statistic', metadata: { event: 'Changed context' } } });
  await json(`memory/materials/${items[1].material.id}/revision`, { baseRevision: 1, source: items[1].material.source, text: items[1].evidence.anchor.excerpt + '\nSynthetic corrected original.', reason: 'Changed original.' });
  await json(`memory/materials/${items[2].material.id}/authorization`, { baseRevision: 1, authorized: false, reason: 'Withdrawn source.' });
  await json(`memory/${supporting.evidence.id}/correction`, { expected: memoryEvidenceRef(supporting.evidence), reason: 'Changed supporting context.', changes: { kind: 'statistic', metadata: { event: 'Support changed' } } });
  for (const [index, item] of items.entries()) { assert.equal((await json<MemoryDetail>(`memory/${item.evidence.id}`)).policyReassessment, null); assert.equal((await api(`memory/${item.evidence.id}/reassess-policy`, inputs[index])).status, index === 2 ? 404 : 409); }
});
test('private-proof receipt replay is denied after access is removed, and reassessment audit failure rolls everything back', async () => {
  const item = await fixture(true); await owner("UPDATE reporter_ed_productions SET doc=doc||jsonb_build_object('restrictedTo',jsonb_build_array($2::text)) WHERE production_id=$1", [item.productionId, contexts[3].actor]);
  await activate(await manual()); const input = reassessmentInput(await json<MemoryDetail>(`memory/${item.evidence.id}`)), key = randomUUID();
  await json(`memory/${item.evidence.id}/reassess-policy`, input, 3, key);
  await owner("UPDATE reporter_ed_productions SET doc=doc||jsonb_build_object('restrictedTo','[]'::jsonb) WHERE production_id=$1", [item.productionId]);
  assert.equal((await api(`memory/${item.evidence.id}/reassess-policy`, input, 3, key)).status, 404);
  const another = await fixture(); await activate(await manual()); const proof = reassessmentInput(await json<MemoryDetail>(`memory/${another.evidence.id}`)), retryKey = randomUUID();
  const before = await json<MemoryDetail>(`memory/${another.evidence.id}`), clock = (await owner('SELECT seq FROM reporter_memory_clock WHERE portal_id=$1', [PORTAL]))[0].seq;
  await owner("CREATE FUNCTION public.fail_reassessment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.check.reassess' THEN RAISE EXCEPTION 'SYNTHETIC_REASSESSMENT_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_reassessment_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.fail_reassessment_audit()");
  try { assert.equal((await api(`memory/${another.evidence.id}/reassess-policy`, proof, 1, retryKey)).status, 500); }
  finally { await owner('DROP TRIGGER fail_reassessment_audit ON audit_log; DROP FUNCTION public.fail_reassessment_audit()'); }
  assert.deepEqual((await json<MemoryDetail>(`memory/${another.evidence.id}`)).checks, before.checks); assert.equal((await owner('SELECT seq FROM reporter_memory_clock WHERE portal_id=$1', [PORTAL]))[0].seq, clock);
  assert.equal((await owner('SELECT count(*)::int AS n FROM reporter_memory_receipts WHERE request_id=$1', [retryKey]))[0].n, 0);
  assert.equal((await json<MemoryCheck>(`memory/${another.evidence.id}/reassess-policy`, proof, 1, retryKey)).revision, another.check.revision + 1);
});
test('matching record IDs and request keys in another workspace never mix proofs; member inspection remains read-only in PostgreSQL', async () => {
  const item = await fixture(); await activate(await manual()); const input = reassessmentInput(await json<MemoryDetail>(`memory/${item.evidence.id}`));
  await assert.rejects(session(async client => { await client.query("SELECT set_config('app.member_view',$1,true)", [randomUUID()]); await client.query('SELECT public.reporter_memory_reassess($1,$2::jsonb,$3::jsonb,$4,$5::jsonb,$6)', [item.evidence.id, JSON.stringify(input.evidence), JSON.stringify(input.check), input.policyRevision, JSON.stringify(item.check), input.reason]); }), error => (error as { code: string }).code === '42501');
  await owner("INSERT INTO public.user_roles(user_id,role) VALUES($1,'platform_admin') ON CONFLICT DO NOTHING", [contexts[0].actor]);
  const { handleReporter } = await import('../../src/server/http.ts'), { resolveReporterContext } = await import('../../src/server/database.ts');
  const created = await handleReporter(new Request(`${APP}/api/reporter/platform/workspaces`, { method: 'POST', headers: { origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Synthetic policy isolation', slug: 'policy-isolation' }) }), ['platform', 'workspaces'], { identify: async () => identities[0] });
  assert.equal(created.status, 201, await created.clone().text()); const other = (await resolveReporterContext(identities[0], 'policy-isolation'))!; assert.ok(other);
  await owner("INSERT INTO core.tenant_members(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active') ON CONFLICT(tenant_id,user_id) DO NOTHING", [other.tenant, contexts[0].actor]);
  await owner("INSERT INTO public.portal_members(tenant_id,portal_id,user_id,status) VALUES($1,$2,$3,'active') ON CONFLICT(portal_id,user_id) DO NOTHING", [other.tenant, other.portal, contexts[0].actor]);
  await owner("SELECT core.platform_set_roles($1,$2,$3,ARRAY['admin'])", [contexts[0].actor, other.tenant, other.portal]);
  const evidence = { ...item.evidence, workspaceId: other.portal, metadata: { ...item.evidence.metadata, event: 'Different workspace context' } }, check = { ...item.check, workspaceId: other.portal, evidence: memoryEvidenceRef(evidence) };
  await owner('INSERT INTO reporter_ed_sources(portal_id,source_id,doc,seq) VALUES($1,$2,$3,1)', [other.portal, item.source.id, { ...item.source, workspaceId: other.portal }]);
  await session(async client => {
    for (const value of [{ kind: 'material', id: item.material.id, expected: null, sourceId: item.source.id, doc: { ...item.material, workspaceId: other.portal } },
      { kind: 'evidence', id: evidence.id, expected: null, parentKind: 'material', parentId: item.material.id, fingerprint: memoryEvidenceRef(evidence).hash, doc: evidence },
      { kind: 'check', id: check.id, expected: null, parentKind: 'evidence', parentId: evidence.id, doc: check },
      { kind: 'policy', id: 'editorial-memory', expected: null, doc: { ...initialMemoryPolicy(other.portal), revision: check.policyRevision + 1 } }]) await client.query('SELECT public.reporter_memory_put($1::jsonb)', [JSON.stringify(value)]);
  }, 0, other);
  const path = `memory/${evidence.id}/reassess-policy`, key = randomUUID();
  assert.equal((await api(path, input, 0, key, 'policy-isolation')).status, 404);
  const response = await api(`memory/${evidence.id}`, undefined, 0, randomUUID(), 'policy-isolation'); assert.equal(response.status, 200); const detail = await response.json() as MemoryDetail;
  assert.equal(detail.evidence.metadata.event, 'Different workspace context'); assert.notEqual(detail.policyReassessment!.evidence.hash, input.evidence.hash);
  const saved = await api(path, reassessmentInput(detail), 0, key, 'policy-isolation'); assert.equal(saved.status, 200, await saved.clone().text());
  const original = await json<MemoryDetail>(`memory/${item.evidence.id}`); assert.equal(original.checks.total, 1); assert.ok(original.policyReassessment);
  assert.equal((await json<MemoryCheck>(path, input, 0, key)).workspaceId, PORTAL);
});
