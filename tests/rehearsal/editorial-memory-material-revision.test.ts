import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { memoryEvidenceRef, type MemoryEvidence } from '../../src/domain/editorial-memory.ts';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import type { MemoryMaterial, MemoryPage, MemoryBlock } from '../../src/domain/editorial-memory.ts';
import type { MemoryJob } from '../../src/ports/editorial-memory.ts';
import type { Source } from '../../src/domain/source.ts';

const APP = 'http://127.0.0.1:3991';
const identities = ['editor', 'approver', 'other-editor'].map(role => ({ subject: `revision-${role}`, email: `${role}@revision.test`, name: role, emailVerified: true }));
const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
const text = '  Relato sintético com 240 pessoas.\r\nUma fala preservada com 🐟 e é. ';
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>;
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function api(path: string, input?: unknown, key: string = randomUUID(), actor = 0) {
  const { handleReporter } = await import('../../src/server/http.ts'), url = new URL(`${APP}/api/reporter/w/reporter-ai/memory/${path}`);
  return handleReporter(new Request(url, input === undefined ? {} : { method: 'POST', headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) }),
    ['w', 'reporter-ai', 'memory', ...url.pathname.split('/').slice(6).filter(Boolean)], { identify: async () => identities[actor], defer: () => {} });
}
async function json<T>(path: string, input?: unknown, key?: string) {
  const response = await api(path, input, key);
  assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
}
const imported = (original = text) => json<{ material: MemoryMaterial; job: MemoryJob }>('materials', { title: 'Synthetic revision', kind: 'report', text: original, metadata, authorized: true, primaryOrigin: 'same-original', originalFileId: null });
const revision = (material: MemoryMaterial) => ({ baseRevision: material.revision, source: material.source, text: text.replace('240', '241'), reason: 'Corrected the original count.' });
before(async () => {
  db = await startRehearsalDatabase(identities.map((identity, i) => ({ email: identity.email, role: i === 1 ? 'approver' : 'editor' })));
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_DEFAULT_PORTAL_ID: '10000000-0000-0000-0000-000000000101', REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP,
    REPORTER_MEMORY_MODE: 'on', REPORTER_WORKER_PASSWORD: db.workerPassword });
}, { timeout: 180000 });
after(async () => {
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop();
});

test('original revision is audited, literal, replayable and cancels the old extraction generation', async () => {
  const first = await imported(), key = randomUUID(), input = revision(first.material);
  const before = (await owner('SELECT doc FROM reporter_ed_sources WHERE source_id=$1', [first.material.source.sourceId]))[0].doc as Source;
  const { runMemoryJob } = await import('../../src/server/editorial-memory-worker.ts');
  let entered!: () => void, release!: () => void;
  const claimed = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
  const worker = runMemoryJob('revision-inflight', new AbortController().signal, undefined, async claim => {
    assert.equal(claim.job.id, first.job.id); entered(); await pending;
    return { value: { overflow: false, evidence: [{ kind: 'citation', excerpt: text, from: 0, kinds: ['opinion'] }] }, model: claim.job.model!,
      provider: 'synthetic', provider_request_id: null, usage_unit: 'tokens', input_units: 0, output_units: 0 };
  });
  await claimed;
  let changed: { material: MemoryMaterial; job: MemoryJob; affectedEvidence: number };
  try { changed = await json(`materials/${first.material.id}/revision`, input, key); }
  finally { release(); await worker; }
  assert.equal((await json<MemoryPage<unknown>>(`?materialId=${first.material.id}`)).items.length, 0, 'the obsolete provider output cannot commit');
  assert.deepEqual(await json(`materials/${first.material.id}/revision`, input, key), changed);
  assert.equal(changed.material.revision, 2); assert.equal(changed.material.source.sourceVersion, 2); assert.equal(changed.affectedEvidence, 0);
  const source = (await owner('SELECT doc FROM reporter_ed_sources WHERE source_id=$1', [first.material.source.sourceId]))[0].doc as Source;
  assert.equal(source.versions.length, 2); assert.deepEqual(source.versions[0], before.versions[0]); assert.deepEqual(source.rights, before.rights);
  assert.equal(source.versions[1].content.segments[0].text, input.text); assert.equal(source.versions[1].note, input.reason);
  const historical = await json<{ material: MemoryMaterial; source: Source }>(`materials/${first.material.id}?revision=1`);
  assert.deepEqual(historical.material, first.material); assert.equal(historical.source.versions.length, 1); assert.deepEqual(historical.source.versions[0], before.versions[0]);
  assert.equal((await api(`materials/${first.material.id}?revision=3`)).status, 404);
  for (const query of ['revision=0', 'revision=1&revision=2', 'revision=1&unknown=1']) assert.equal((await api(`materials/${first.material.id}?${query}`)).status, 422);
  assert.deepEqual(changed.material.metadata, metadata); assert.equal(changed.material.primaryOrigin, first.material.primaryOrigin);
  const oldJob = await json<MemoryJob>(`jobs/${first.job.id}`); assert.equal(oldJob.status, 'cancelled'); assert.equal(oldJob.error, 'MEMORY_SOURCE_CHANGED'); assert.equal(oldJob.generation, 2);
  const blocks = await json<MemoryPage<MemoryBlock>>(`jobs/${changed.job.id}/blocks`); assert.equal(blocks.items.map(block => block.anchor.excerpt).join(''), input.text);
  assert.equal(blocks.items[0].anchor.source.sourceVersion, 2);
  const audits = await owner("SELECT user_id,after_data FROM audit_log WHERE action='memory.material.revise' AND after_data->'material'->>'id'=$1", [first.material.id]);
  assert.equal(audits.length, 1); assert.equal(audits[0].user_id, source.versions[1].createdBy);
  assert.equal(changed.material.revisionInfo!.personId, audits[0].user_id); assert.deepEqual(changed.material.revisionInfo!.previous, first.material.source);
  assert.equal((await api(`materials/${first.material.id}/revision`, { ...input, reason: 'Different action.' }, key)).status, 409);
  const revoked = await json<MemoryMaterial>(`materials/${first.material.id}/authorization`, { baseRevision: changed.material.revision, authorized: false, reason: 'Synthetic rights withdrawn.' });
  const historicalAfterRevocation = await json<{ source: Source }>(`materials/${first.material.id}?revision=1`); assert.equal(historicalAfterRevocation.source.rights.authorized, false);
  const unauthorizedRevision = await json<{ job: MemoryJob }>(`materials/${first.material.id}/revision`, { baseRevision: revoked.revision, source: revoked.source,
    text: input.text.replace('241', '242'), reason: 'Correct the text without granting rights.' });
  let calls = 0;
  assert.equal(await runMemoryJob('revision-no-rights', new AbortController().signal, undefined, async () => { calls++; throw new Error('unexpected paid extraction'); }), true);
  assert.equal(calls, 0); assert.equal((await json<MemoryJob>(`jobs/${unauthorizedRevision.job.id}`)).status, 'failed');
});
test('revision guards exact context, roles, strict input and concurrent alternatives', async () => {
  const first = await imported(), path = `materials/${first.material.id}/revision`, input = revision(first.material);
  for (const bad of [{ ...input, text }, { ...input, reason: '' }, { ...input, text: 'tiny' }, { ...input, actorId: 'forged' }]) assert.equal((await api(path, bad)).status, 422);
  assert.equal((await api(path, { ...input, source: { ...input.source, sourceVersion: 2 } })).status, 409);
  assert.equal((await api(path, input, randomUUID(), 1)).status, 403);
  const both = await Promise.all([api(path, input), api(path, { ...input, text: input.text + ' Outro contexto.' })]);
  assert.deepEqual(both.map(response => response.status).sort(), [200, 409]);
  assert.equal((await owner('SELECT jsonb_array_length(doc->\'versions\') AS n FROM reporter_ed_sources WHERE source_id=$1', [first.material.source.sourceId]))[0].n, 2);
});
test('an audit failure rolls source, material, jobs and revision receipt back together', async () => {
  const first = await imported(), key = randomUUID(), path = `materials/${first.material.id}/revision`, input = revision(first.material);
  await owner("CREATE FUNCTION public.reject_revision_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='memory.material.revise' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_revision_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION public.reject_revision_audit()");
  try { assert.equal((await api(path, input, key)).status, 500); }
  finally { await owner('DROP TRIGGER reject_revision_audit ON audit_log; DROP FUNCTION public.reject_revision_audit()'); }
  const detail = await json<{ material: MemoryMaterial; source: Source; job: MemoryJob }>(`materials/${first.material.id}`);
  assert.equal(detail.material.revision, 1); assert.equal(detail.source.versions.length, 1); assert.equal(detail.job.status, 'queued');
  const retried = await json<{ material: MemoryMaterial }>(path, input, key); assert.equal(retried.material.revision, 2);
});
test('historical originals and revision receipts keep current private source visibility', async () => {
  const first = await imported(), key = randomUUID(), input = revision(first.material), path = `materials/${first.material.id}`;
  const [actor] = await owner('SELECT id FROM core.users WHERE email=$1', [identities[0].email]);
  const portal = first.material.workspaceId, production = `private-${randomUUID()}`;
  await owner('INSERT INTO reporter_ed_productions(portal_id,production_id,doc,source_ids,archived,seq) VALUES($1,$2,$3,$4,false,1)',
    [portal, production, JSON.stringify({ id: production, workspaceId: portal, ownerId: actor.id, restrictedTo: [actor.id], title: 'Private synthetic original', sourceIds: [first.material.source.sourceId] }), [first.material.source.sourceId]]);
  for (const table of ['reporter_memory_heads', 'reporter_memory_history']) await owner(`UPDATE ${table} SET origin_production_id=$1 WHERE id=$2 OR parent_id=$2`, [production, first.material.id]);
  const changed = await json<{ material: MemoryMaterial }>(`${path}/revision`, input, key); assert.equal(changed.material.revision, 2);
  for (const query of [path, `${path}?revision=1`, `${path}?revision=2`]) assert.equal((await api(query, undefined, randomUUID(), 2)).status, 404);
  assert.equal((await api(`${path}/revision`, input, key, 2)).status, 404, 'cached receipts cannot reveal an inaccessible original');
});
test('bulk context invalidation retains a thousand exact historical observations and semantic hashes', async () => {
  const lines = Array.from({ length: 1000 }, (_, index) => `Observação sintética ${index}: contexto original preservado.`), original = lines.join('\n');
  const first = await imported(original); let from = 0;
  const docs = lines.map((excerpt, index) => {
    const doc: MemoryEvidence = { id: `bulk-context-${index}`, workspaceId: first.material.workspaceId, materialId: first.material.id, kind: 'citation',
      revision: 0, text: excerpt, personId: null, authorConfirmed: false, legacyCitationId: null, metadata, kinds: ['opinion'], status: 'active', supersedes: null,
      createdAt: first.material.importedAt, updatedAt: first.material.importedAt,
      anchor: { source: first.material.source, excerpt, spans: [{ segmentId: 'original', from, to: from + excerpt.length }] } };
    from += excerpt.length + 1; return { doc, hash: memoryEvidenceRef(doc).hash };
  });
  const [clock] = await owner('UPDATE reporter_memory_clock SET seq=seq+1000 WHERE portal_id=$1 RETURNING seq-1000 AS start', [first.material.workspaceId]);
  await owner(`WITH inserted AS (INSERT INTO reporter_memory_heads(portal_id,kind,id,storage_revision,doc,fingerprint,parent_kind,parent_id,source_id,seq)
    SELECT $1,'evidence',value->'doc'->>'id',0,value->'doc',value->>'hash','material',$2,$3,$4::bigint+n
      FROM jsonb_array_elements($5::jsonb) WITH ORDINALITY a(value,n) RETURNING *) INSERT INTO reporter_memory_history SELECT * FROM inserted`,
    [first.material.workspaceId, first.material.id, first.material.source.sourceId, clock.start, JSON.stringify(docs)]);
  const changed = await json<{ affectedEvidence: number }>(`materials/${first.material.id}/revision`, { baseRevision: 1, source: first.material.source,
    text: original + '\nContexto adicional sintético informado pelo editor.', reason: 'Review the revised context without deleting old observations.' });
  assert.equal(changed.affectedEvidence, 1000);
  const [counts] = await owner(`SELECT count(*)::integer AS amount,bool_and((h.doc->>'revision')::integer=1 AND h.fingerprint=v.fingerprint AND h.doc->'anchor'=v.doc->'anchor') AS preserved
    FROM reporter_memory_heads h JOIN reporter_memory_history v ON v.portal_id=h.portal_id AND v.kind=h.kind AND v.id=h.id AND v.storage_revision=0
    WHERE h.kind='evidence' AND h.parent_id=$1`, [first.material.id]);
  assert.equal(counts.amount, 1000); assert.equal(counts.preserved, true);
});
