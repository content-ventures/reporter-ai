import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHttpExportService } from './export.ts';
import { createReporterTransport } from './reporter-client.ts';
import { createLocalExportService } from '../local/export/local-export.ts';
import { createLocalRenderService } from '../local/render/local-render.ts';
import { baseRecord, commitVersion, createKit, recordDecision, sampleArticle } from '../../domain/testing/scenario.ts';
import { toVersionRef } from '../../domain/piece.ts';

function fixture() {
  const kit = createKit(), record = baseRecord(kit, { plan: ['article'] });
  const version = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
  recordDecision(record, kit, version, 'approved');
  const local = createLocalExportService({ clock: { now: kit.now }, getRecord: () => record,
    render: createLocalRenderService({ templates: [], renders: {} }) });
  const transport = createReporterTransport('actual-client', { requireAccount: true }); transport.bindAccount('actual-editor');
  return { kit, record, version, local, transport };
}

test('a current bank refusal prevents package and individual file preparation, including a previously prepared file', async () => {
  const previous = globalThis.fetch, { record, version, local, transport } = fixture(), ref = toVersionRef(version);
  const seen: { url: string; input: unknown; actor: string | null }[] = [];
  let builds = 0;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), input: JSON.parse(String(init.body)), actor: new Headers(init.headers).get('x-reporter-account') });
    return Response.json({ ok: false, refusal: { code: 'memory_not_ready', message: 'A revisão da evidência mudou.' } });
  };
  const service = createHttpExportService({ ...local,
    build: request => { builds++; return local.build(request); },
    buildFile: request => { builds++; return local.buildFile(request); },
  }, transport);
  try {
    const request = { productionId: record.production.id };
    const prepared = await local.build(request); assert.ok(prepared.ok);
    for (const result of [await service.plan(request), await service.build(request),
      await service.buildFile({ ...request, fileName: prepared.value.files[0].fileName, prepared: prepared.value.files })]) {
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.refusal.code, 'memory_not_ready');
    }
    assert.equal(builds, 0);
    assert.equal(seen.length, 3);
    for (const call of seen) {
      assert.equal(call.url, '/api/reporter/w/actual-client/exports/prepare'); assert.equal(call.actor, 'actual-editor');
      assert.deepEqual(call.input, { productionId: record.production.id, selection: [ref] });
    }
    globalThis.fetch = async () => { throw new Error('Synthetic network outage'); };
    await assert.rejects(service.build(request), /Synthetic network outage/); assert.equal(builds, 0);
  } finally { globalThis.fetch = previous; transport.dispose(); }
});

test('a later client refresh cannot replace the exact server-validated article while preparing its files', async () => {
  const previous = globalThis.fetch, { kit, record, version, local, transport } = fixture(), ref = toVersionRef(version);
  globalThis.fetch = async (_url, init = {}) => {
    assert.deepEqual(JSON.parse(String(init.body)).selection, [ref]);
    const newer = commitVersion(record, kit, 'article', { ...sampleArticle(record.sources[0]), title: 'A newer approved article' });
    recordDecision(record, kit, newer, 'approved');
    return Response.json({ ok: true, value: [ref] });
  };
  try {
    const result = await createHttpExportService(local, transport).build({ productionId: record.production.id });
    assert.ok(result.ok); assert.equal(result.value.manifest.items[0].versionId, ref.versionId);
    assert.equal(result.value.manifest.items[0].hash, ref.hash); assert.equal(result.value.files.some(file => file.versionId && file.versionId !== ref.versionId), false);
    assert.equal(record.versions.length, 2);
  } finally { globalThis.fetch = previous; transport.dispose(); }
});
