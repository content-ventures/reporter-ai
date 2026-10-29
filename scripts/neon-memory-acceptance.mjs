import assert from 'node:assert/strict';
import { memoryEvidenceRef } from '../src/domain/editorial-memory.ts';

/** Exercise the actual staging HTTP/storage/database path without starting an AI job. */
export async function acceptMemoryFlow({ ok, call, owner, editor, reviewer, other, client, environment = process.env }) {
  // The deployed worker must not claim the synthetic import and call a paid provider.
  if (environment.REPORTER_MEMORY_MODE === 'on') throw new Error('Memory staging acceptance requires the worker ceiling off.');
  const previous = process.env.REPORTER_MEMORY_MODE;
  process.env.REPORTER_MEMORY_MODE = 'on';
  const base = `w/${client.slug}/memory`, bytes = Buffer.from('instituição;indicador;valor;unidade;período\nInstituto sintético;Visitantes;240;pessoas;2025\n');
  let job;
  try {
    const file = await ok(editor, `${base}/originals`, { name: 'mercado-sintetico.csv', bytes: bytes.toString('base64'), delimiter: ';' });
    const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: [], originalUrl: null };
    const imported = await ok(editor, `${base}/materials/from-file`, { title: 'Mercado sintético de staging', kind: 'market_data',
      originalFileId: file.id, authorized: true, primaryOrigin: null, metadata });
    job = imported.job;
    assert.equal(job.status, 'queued');
    await ok(editor, `${base}/jobs/${job.id}/cancel`, { baseRevision: job.revision });
    job = undefined;
    const mapping = { institution: { record: 'row', column: 0 }, indicator: { record: 'row', column: 1 }, value: { record: 'row', column: 2 },
      unit: { record: 'row', column: 3 }, period: { record: 'row', column: 4 } };
    const root = `${base}/materials/${imported.material.id}`, preview = await ok(editor, `${root}/market-preview`, { mapping });
    assert.equal(preview.preview.rows[0].fields.value.value, '240');
    const input = { mapping, revision: 0, materialRevision: imported.material.revision, source: imported.material.source,
      originalFileId: file.id, checksum: file.checksum };
    const plan = await ok(editor, `${root}/market-mapping`, input);
    const result = await ok(editor, `${root}/market-import`, { revision: plan.revision, materialRevision: imported.material.revision,
      source: imported.material.source, originalFileId: file.id, checksum: file.checksum, start: 1 });
    assert.equal(result.rows[0].status, 'created');
    const detail = await ok(reviewer, `${base}/${result.rows[0].id}`), proof = memoryEvidenceRef(detail.evidence);
    assert.equal(detail.eligibility.reason, 'review_required');
    const decision = await ok(reviewer, `${base}/${proof.id}/review`, { evidence: proof, check: null, policyRevision: 1, previousSequence: 0,
      action: 'accept', reason: 'Conferido no arquivo sintético de staging.', supports: [] });
    assert.equal(decision.personId, reviewer.id);
    const selection = await ok(editor, `${base}/selections`, { baseRevision: 0, productionId: null, evidence: [proof] });
    const draft = await ok(editor, `${base}/selections/${selection.id}/write`, { baseRevision: 1, title: 'Rascunho sintético de staging', brief: { size: 'standard', sections: 3 } });
    const source = (await owner.query('SELECT doc FROM public.reporter_ed_sources WHERE portal_id=$1 AND source_id=$2', [client.id, draft.sourceId])).rows[0];
    assert.deepEqual(source.doc.memory[0].items[0].market, detail.evidence.market);
    const original = await call(reviewer, `${base}/originals/${file.id}/file`);
    assert.equal(original.status, 200); assert.deepEqual(original.value, bytes);
    assert.equal((await call(other, `${base}/${proof.id}`)).status, 404);
    const audit = (await owner.query("SELECT user_id FROM public.audit_log WHERE portal_id=$1 AND action='memory.evidence.accept' AND after_data->'evidence'->>'id'=$2", [client.id, proof.id])).rows;
    assert.ok(audit.some(entry => entry.user_id === reviewer.id));
    console.log('PASS staging memory: original, market import, reviewer audit, writing and foreign-workspace refusal; zero AI calls.');
  } finally {
    try { if (job) await ok(editor, `${base}/jobs/${job.id}/cancel`, { baseRevision: job.revision }); }
    finally {
      if (previous === undefined) delete process.env.REPORTER_MEMORY_MODE;
      else process.env.REPORTER_MEMORY_MODE = previous;
    }
  }
}
