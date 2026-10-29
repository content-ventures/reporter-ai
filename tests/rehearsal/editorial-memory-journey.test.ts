import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg, { type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { MEMORY_JOURNEY_PASSAGES as passages } from '../fixtures/editorial-memory-journey.ts';
import { createMemoryJourneyBrowser } from '../support/editorial-memory-browser.ts';
import { articleStats, blockText, markTextReviewed, type ArticleBody } from '../../src/domain/article.ts';
import { initialMemoryPolicy, memoryEvidenceRef, type MemoryEvidenceView, type MemoryMaterial, type MemoryPage, type MemorySelection } from '../../src/domain/editorial-memory.ts';
import { assessMemoryEvidence } from '../../src/domain/editorial-memory-check.ts';
import { captureMemoryChoice } from '../../src/domain/editorial-memory-discovery.ts';
import { memoryWritingProvenance } from '../../src/domain/editorial-memory-writing.ts';
import { R1_ARTICLE_LIMITS, r1ArticleIssue } from '../../src/domain/article-policy.ts';
import { defaultPipelineDefinition } from '../../src/domain/pipeline.ts';
import { defaultWritingOrchestration, WRITING_EDITORIAL_CHECK_KEYS, type WritingArticle, type WritingPlan, type WritingReview } from '../../src/domain/writing-orchestration.ts';
import { toVersionRef } from '../../src/domain/piece.ts';
import { createEditorialEngine } from '../../src/runtime/editorial-engine.ts';
import { writingSourceCandidates } from '../../src/domain/writing-source.ts';
import { createLocalExportService } from '../../src/adapters/local/export/local-export.ts';
import { createLocalRenderService } from '../../src/adapters/local/render/local-render.ts';
import type { ConnectedWorkspace } from '../../src/ports/connected-workspace.ts';
import type { MemoryDetail, MemoryJob, MemoryMaterialRevisionResult, MemorySelectedContext, MemoryWritingResult } from '../../src/ports/editorial-memory.ts';
import type { RequestedReview } from '../../src/ports/production-commands.ts';
import type { BuiltFile, ExportPackage } from '../../src/ports/export.ts';
import type { WritingRunDetails } from '../../src/ports/pipeline-settings.ts';

const browserBase = process.env.REPORTER_MEMORY_JOURNEY_UI_BASE;
const APP = browserBase ?? 'http://127.0.0.1:3990', PORTAL = '10000000-0000-0000-0000-000000000101';
const identities = ['editor', 'approver', 'admin'].map(role => ({ subject: `memory-journey-${role}`, email: `${role}@memory-journey.test`, name: role, emailVerified: true }));
const metadata = { publishedOn: null, recordedOn: null, institution: null, company: null, event: null, edition: null, topics: ['synthetic-journey'], originalUrl: null };
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, handle: typeof import('../../src/server/http.ts').handleReporter, outputDirectory: string;
let ui: Awaited<ReturnType<typeof createMemoryJourneyBrowser>> | undefined;
const originalFetch = globalThis.fetch, runIds: string[] = [];
async function owner(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner }); await client.connect();
  try { return (await client.query(sql, values)).rows; } finally { await client.end(); }
}
async function request(path: string, input?: unknown, actor = 0, key: string = randomUUID()) {
  const url = new URL(`${APP}/api/reporter/w/reporter-ai/${path}`);
  return handle(new Request(url, input === undefined ? {} : { method: 'POST', headers: { origin: APP, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(input) }),
    ['w', 'reporter-ai', ...url.pathname.split('/').slice(5)], { identify: async () => identities[actor], defer: () => {} });
}
async function api<T>(path: string, input?: unknown, actor = 0, key?: string): Promise<T> {
  const response = await request(path, input, actor, key); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
}
async function rpc<T>(method: string, args: unknown[], actor = 0, requestId = randomUUID()): Promise<T> {
  const result = await api<{ ok: boolean; value: T; refusal?: unknown }>('workspace', { method, args, requestId }, actor);
  assert.ok(result.ok, JSON.stringify(result)); return result.value;
}
const snapshot = () => api<ConnectedWorkspace>('workspace');
async function record(id: string) {
  const state = await snapshot(), engine = createEditorialEngine(state, { next: () => randomUUID() }); return engine.records.record(id)!;
}
before(async () => {
  db = await startRehearsalDatabase(identities.map((identity, index) => ({ email: identity.email, role: ['editor', 'approver', 'admin'][index] })));
  for (const identity of identities) await owner('UPDATE core.users SET auth_subject=$2,email_verified=true WHERE email=$1', [identity.email, identity.subject]);
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_WORKER_PASSWORD: db.workerPassword, REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_WORKSPACES_MODE: 'all', REPORTER_APP_ORIGINS: APP,
    REPORTER_MEMORY_MODE: 'on', GROQ_API_KEY: 'synthetic-no-network' });
  ({ handleReporter: handle } = await import('../../src/server/http.ts'));
  outputDirectory = await mkdtemp(join(tmpdir(), 'reporter-memory-journey-files-'));
  if (browserBase) {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(browserBase).hostname), 'the UI rehearsal only targets loopback');
    ui = await createMemoryJourneyBrowser(browserBase, Number(process.env.REPORTER_MEMORY_JOURNEY_UI_WIDTH ?? 1440), async (request, actor) =>
      handle(request, new URL(request.url).pathname.split('/').slice(3), { identify: async () => identities[actor], defer: () => {} }));
  }
}, { timeout: 180000 });
after(async () => {
  try { await ui?.close(); }
  finally {
    globalThis.fetch = originalFetch;
    const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
    await Promise.all(Object.values(pools).map(pool => pool?.end())); db?.stop();
    if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
    for (const id of runIds) await rm(join(process.cwd(), '.reporter-local', `${PORTAL}-${id}.work`), { recursive: true, force: true });
  }
});

test('two imported materials reach orchestrated writing, separate approval and actual files with stable evidence/query receipts', async () => {
  const { runMemoryJob } = await import('../../src/server/editorial-memory-worker.ts');
  const { runMemoryCheckJob } = await import('../../src/server/editorial-memory-check-worker.ts');
  const { runEditorialJob } = await import('../../src/server/editorial-worker.ts');
  const definition = defaultPipelineDefinition(); definition.writing = defaultWritingOrchestration(definition.steps.article.model);
  definition.writing.enabled = true; definition.writing.minimumQuotes = 2;
  const view = await api<{ active: { revision: number } }>('pipeline'); await rpc('pipeline.save', [definition, view.active.revision], 2);
  const actor = (await snapshot()).state.sessionPersonId;
  const materials: { material: MemoryMaterial; job: MemoryJob; text: string; kind: 'statistic' | 'citation' }[] = [];
  for (const kind of ['statistic', 'citation'] as const) {
    const text = passages.filter(passage => passage.kind === kind).map(passage => passage.text).join('\n\n') + '\n\nPRIVATE_UNSELECTED_ARCHIVE_SENTINEL';
    const input = { title: `Synthetic ${kind} journalistic journey`, kind: kind === 'citation' ? 'transcript' as const : 'report' as const,
      text, metadata, authorized: true, primaryOrigin: `synthetic-journey:${kind}`, originalFileId: null };
    const imported = ui ? await ui.import(input) : await api<{ material: MemoryMaterial; job: MemoryJob }>('memory/materials', input); materials.push({ ...imported, text, kind });
  }
  let extractionCalls = 0;
  for (let turn = 0; turn < 12; turn++) {
    const jobs = await Promise.all(materials.map(material => api<MemoryJob>(`memory/jobs/${material.job.id}`)));
    if (jobs.every(job => job.status === 'completed')) break;
    assert.equal(await runMemoryJob('journey-extract', new AbortController().signal, undefined, async claim => {
      extractionCalls++; const material = materials.find(material => material.material.id === claim.material.id)!;
      const block = claim.block!.anchor.spans[0];
      const evidence = passages.filter(passage => passage.kind === material.kind).flatMap(passage => {
        const at = material.text.indexOf(passage.text); if (at < block.from || at >= block.to) return [];
        return [{ kind: passage.kind, excerpt: passage.text, from: at - claim.context.from, kinds: [passage.kind === 'citation' ? 'opinion' : 'declared'],
          ...(passage.kind === 'statistic' ? { indicator: 'Observação sintética', raw: passage.raw, unit: passage.unit, period: passage.period, geography: 'Brasil', population: null, qualifier: passage.qualifier, issuingInstitution: null } : {}) }];
      });
      return { value: { overflow: false, evidence }, model: claim.job.model!, provider: 'synthetic', provider_request_id: null, usage_unit: 'tokens', input_units: 0, output_units: 0 };
    }), true);
  }
  assert.ok(extractionCalls >= 4);
  let evidence = (await api<MemoryPage<MemoryEvidenceView>>('memory?limit=100')).items;
  assert.equal(evidence.length, 4); assert.equal((await snapshot()).state.productions.length, 0, 'intake/extraction needs no article');
  for (const row of evidence) {
    if (row.evidence.kind === 'citation') await api(`memory/${row.evidence.id}/correction`, { expected: memoryEvidenceRef(row.evidence), reason: 'Synthetic document author explicitly confirmed.', changes: { kind: 'citation', personId: actor, authorConfirmed: true } });
    const detail = await api<MemoryDetail>(`memory/${row.evidence.id}`);
    await api(`memory/${row.evidence.id}/check`, { expected: memoryEvidenceRef(detail.evidence) });
    assert.equal(await runMemoryCheckJob('journey-check', new AbortController().signal, undefined, async claim => assessMemoryEvidence(claim.evidence, claim.material,
      claim.policy ?? initialMemoryPolicy(PORTAL), claim.previous, { claims: [{ text: claim.evidence.anchor.excerpt, kind: claim.evidence.kind === 'statistic' ? 'declared' : 'opinion' }],
        supports: [], strength: null, provider: 'synthetic', model: claim.job.model! }, { actorId: claim.job.createdBy, now: new Date().toISOString(), newId: () => randomUUID() })), true);
    const checked = await api<MemoryDetail>(`memory/${row.evidence.id}`); assert.ok(checked.check); assert.equal(checked.check.confidence, null);
    await api(`memory/${row.evidence.id}/review`, { evidence: memoryEvidenceRef(checked.evidence), check: { id: checked.check.id, revision: checked.check.revision }, policyRevision: checked.policy.revision,
      previousSequence: 0, action: 'accept', reason: 'Synthetic contract acceptance only; not independent factual validation.', supports: [] }, 1);
  }
  evidence = (await api<MemoryPage<MemoryEvidenceView>>('memory?limit=100')).items; assert.ok(evidence.every(row => row.eligibility.usable));
  const orderedPassages = [passages[0], passages[2], passages[1], passages[3]], choices = [];
  for (const passage of orderedPassages) {
    const material = materials.find(material => material.kind === passage.kind)!, query = { kind: passage.kind, materialId: material.material.id, query: passage.kind === 'statistic' ? 'contagem' : 'quero' };
    const page = await api<MemoryPage<MemoryEvidenceView>>(`memory?kind=${query.kind}&materialId=${query.materialId}&q=${query.query}`), row = page.items.find(row => row.evidence.anchor.excerpt === passage.text); assert.ok(row);
    choices.push(captureMemoryChoice(row.evidence, query, page.snapshot));
  }
  const selected = ui ? await ui.select(orderedPassages) : await api<MemorySelection>('memory/selections', { productionId: null, baseRevision: 0, evidence: choices });
  const made = ui ? await ui.write('Synthetic complete writing journey') : await api<MemoryWritingResult>(`memory/selections/${selected.id}/write`, { baseRevision: selected.revision, title: 'Synthetic complete writing journey', brief: { size: 'standard', sections: 2 } });
  const initial = await record(made.productionId), initialProof = structuredClone(initial.sources[0].memory![0]);
  assert.ok(selected.items.every(item => item.check && item.decisionId && item.discovery));
  const candidates = writingSourceCandidates(initial.sources), byText = new Map(candidates.map(candidate => [candidate.text, candidate]));
  assert.equal(candidates.length, 4);
  const plan: WritingPlan = { decision: 'ready', angle: 'Contexto e origem no ensaio sintético', outline: ['O que os lotes registram', 'Como a fonte descreve o teste'], issues: [],
    facts: orderedPassages.map((passage, index) => ({ id: `fact-${index}`, text: passage.text, kind: passage.kind === 'citation' ? 'quote' : 'reported_fact', evidenceIds: [byText.get(passage.text)!.key] })), essentialFactIds: orderedPassages.map((_, index) => `fact-${index}`) };
  let round = 0; const prompts: string[] = [], outputs = (title: string) => {
    const article: WritingArticle = { title, dek: '', titleEvidenceIds: [byText.get(passages[2].text)!.key], dekEvidenceIds: [],
      blocks: orderedPassages.map((passage, index) => ({ id: `body-${index}`, type: passage.kind === 'citation' ? 'quote' : 'paragraph', level: 2, text: passage.text, items: [], evidenceIds: [byText.get(passage.text)!.key] })) };
    const review: WritingReview = { decision: 'ready_for_human', summary: 'Synthetic schema audit, pending separate human approval.', issues: [], audit: {
      factualSummary: 'Exact selected examples preserved.', editorialSummary: 'Synthetic contract, not a real editorial-quality evaluation.',
      editorialChecks: WRITING_EDITORIAL_CHECK_KEYS.map(criterion => ({ criterion, status: 'pass', articlePassages: [], issueIds: [], reason: 'Synthetic contract check.' })),
      factChecks: plan.facts.map((fact, index) => ({ factId: fact.id, status: 'preserved', articlePassages: [{ blockId: `body-${index}`, text: fact.text }], evidenceIds: fact.evidenceIds, reason: 'Exact literal test passage retained.' })), issueChecks: [] } };
    return [plan, article, review];
  };
  let modelOutputs = outputs('Texto de teste preserva origem e contexto');
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.groq.com/openai/v1/chat/completions', 'all external requests stay intercepted');
    const payload = JSON.parse(String(init?.body)), prompt = payload.messages.at(-1).content as string; prompts.push(prompt);
    assert.ok(!prompt.includes('PRIVATE_UNSELECTED_ARCHIVE_SENTINEL')); const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    assert.deepEqual(data.source.map((source: { memory: { selected: unknown } }) => source.memory.selected), selected.items);
    assert.ok(round < modelOutputs.length, 'no hidden calls or an unplanned correction cycle');
    return Response.json({ usage: { prompt_tokens: 10, completion_tokens: 20 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(modelOutputs[round++]) } }] });
  };
  const run = ui ? await ui.start(made.productionId) : await rpc<{ runId: string }>('generation.start', ['article.draft', { productionId: made.productionId, pieceId: made.pieceId }]); runIds.push(run.runId);
  assert.equal(await runEditorialJob('journey-writing', new AbortController().signal), true);
  let current = await record(made.productionId); const finished = await snapshot();
  assert.equal(finished.state.runFolds[run.runId].run.status, 'completed', JSON.stringify(finished.state.runFolds[run.runId].run.error));
  assert.equal(round, 3); assert.equal(prompts.length, 3); assert.equal(current.versions.length, 2);
  assert.equal(current.versions[0].origin, 'edit'); assert.deepEqual(current.versions[0].body, initial.pieces[0].draft.body, 'the selected draft is frozen before generation');
  assert.equal(current.versions[1].origin, 'generation'); assert.equal(current.versions[1].runId, run.runId);
  const selectedDraftVersion = structuredClone(current.versions[0]);
  const generatedVersion = structuredClone(current.versions[1]), body = generatedVersion.body as ArticleBody, stats = articleStats(body);
  assert.ok(stats.characters >= R1_ARTICLE_LIMITS.minChars && stats.words >= R1_ARTICLE_LIMITS.minWords); assert.equal(r1ArticleIssue(body, current.sources), undefined);
  assert.deepEqual(body.blocks.map(blockText), orderedPassages.map(passage => passage.text)); assert.deepEqual(current.sources[0].memory![0], initialProof);
  assert.deepEqual(memoryWritingProvenance(body, current.sources).map(proof => proof.selected), selected.items);
  const execution = await api<WritingRunDetails>(`pipeline/runs/${run.runId}`, undefined, 2);
  assert.equal(execution.traces.filter(trace => trace.status === 'completed').length, 3);
  for (const trace of execution.traces) assert.ok(trace.prompt.user.includes('discovery'));
  const notReviewed = await api<{ ok: boolean; refusal: { code: string } }>('workspace', { method: 'requestReview', args: [made.pieceId], requestId: randomUUID() });
  assert.equal(notReviewed.ok, false); assert.equal(notReviewed.refusal.code, 'send_blocked');
  if (!ui) await rpc('saveDraft', [made.pieceId, markTextReviewed(body), current.pieces[0].draft.revision]);
  const review = ui ? await ui.send(made.productionId) : await rpc<RequestedReview>('requestReview', [made.pieceId]);
  current = await record(made.productionId); assert.equal(current.versions.length, 3);
  assert.deepEqual(current.versions[1], generatedVersion, 'human review never changes the frozen AI version');
  const approvedVersion = structuredClone(current.versions[2]); assert.equal(approvedVersion.hash, generatedVersion.hash); assert.deepEqual(review.version.ref, toVersionRef(approvedVersion));
  const approval = ui ? await ui.approve(made.productionId, body) : await rpc<{ id: string; by: string }>('decide', [{ pieceId: made.pieceId, subject: review.version.ref, displayedHash: review.version.ref.hash, decision: 'approved' }], 1);
  assert.notEqual(approval.by, actor);
  const render = createLocalRenderService({ templates: [], renders: {}, createSurface: () => undefined, fontsReady: async () => {} });
  const exporter = createLocalExportService({ clock: { now: () => new Date().toISOString() }, getRecord: () => current, render });
  async function exportApproved(label: string): Promise<ExportPackage> {
    current = await record(made.productionId); const input = { productionId: made.productionId, selection: [toVersionRef(approvedVersion)] };
    const ready = await api<{ ok: boolean }>('exports/prepare', input); assert.ok(ready.ok);
    const built = await exporter.build(input); assert.ok(built.ok); assert.equal(built.value.status, 'completed');
    assert.equal(built.value.manifest.items[0].approvedBy, approval.by); assert.deepEqual(built.value.manifest.items[0].memory!.map(proof => proof.selected), selected.items);
    for (const format of ['md', 'html']) {
      const file: BuiltFile | undefined = built.value.files.find(file => file.format === format); assert.ok(file); assert.equal(file.status, 'ready'); assert.ok(file.text);
      const proof = /<!-- reporter\.memory\/v1\n([\s\S]*?)\n-->/.exec(file.text); assert.ok(proof);
      const parsed = JSON.parse(proof[1]); assert.equal(parsed.article.hash, approvedVersion.hash); assert.deepEqual(parsed.occurrences, built.value.manifest.items[0].memory);
      const path = join(outputDirectory, `${label}.${format}`); await writeFile(path, file.text); assert.equal(await readFile(path, 'utf8'), file.text);
      assert.ok(file.text.includes(approvedVersion.body.type === 'article' ? approvedVersion.body.title : '')); assert.ok(!file.text.includes('PRIVATE_UNSELECTED_ARCHIVE_SENTINEL'));
    }
    const manifest = built.value.files.find(file => file.fileName === 'manifesto.json')!; assert.equal(manifest.status, 'ready'); assert.ok(manifest.text);
    assert.equal(JSON.parse(manifest.text).items[0].hash, approvedVersion.hash);
    const manifestPath = join(outputDirectory, `${label}-manifesto.json`); await writeFile(manifestPath, manifest.text);
    assert.equal(await readFile(manifestPath, 'utf8'), manifest.text);
    await rpc('recordDelivery', [{ ...input, mode: 'download', files: built.value.outcomes }]);
    return built.value;
  }
  const first = await exportApproved('first'), second = await exportApproved('repeat'); assert.equal(first.plan.idempotencyKey, second.plan.idempotencyKey);
  async function browserDownload() {
    if (!ui) return;
    const files = await ui.download(made.productionId); assert.equal(files.length, 3);
    for (const file of files) {
      assert.ok(!file.text.includes('PRIVATE_UNSELECTED_ARCHIVE_SENTINEL'));
      if (file.name.endsWith('.json')) assert.deepEqual(JSON.parse(file.text).items[0], first.manifest.items[0]);
      else { const proof = /<!-- reporter\.memory\/v1\n([\s\S]*?)\n-->/.exec(file.text); assert.ok(proof); assert.equal(JSON.parse(proof[1]).article.hash, approvedVersion.hash); }
    }
  }
  await browserDownload();
  round = 0; modelOutputs = outputs('Origem e contexto no texto do ensaio');
  const again = ui ? await ui.start(made.productionId) : await rpc<{ runId: string }>('generation.start', ['article.draft', { productionId: made.productionId, pieceId: made.pieceId }]); runIds.push(again.runId);
  assert.equal(await runEditorialJob('journey-writing-again', new AbortController().signal), true);
  current = await record(made.productionId); const replayed = await snapshot(); assert.equal(replayed.state.runFolds[again.runId].run.status, 'completed', JSON.stringify(replayed.state.runFolds[again.runId].run.error));
  assert.equal(round, 3); assert.equal(current.versions.length, 4); assert.deepEqual(current.versions[0], selectedDraftVersion);
  assert.deepEqual(current.versions[1], generatedVersion); assert.deepEqual(current.versions[2], approvedVersion);
  assert.equal(current.versions[3].runId, again.runId); assert.notEqual(current.versions[3].hash, approvedVersion.hash);
  assert.equal((await api<{ ok: boolean }>('exports/prepare', { productionId: made.productionId, selection: [toVersionRef(current.versions[3])] })).ok, false);
  await exportApproved('after-new-draft');
  await browserDownload();
  if (ui) {
    const beforeReading = structuredClone((await record(made.productionId)).pieces[0].draft);
    await ui.used(orderedPassages, approvedVersion.number, (approvedVersion.body as ArticleBody).title);
    assert.deepEqual((await record(made.productionId)).pieces[0].draft, beforeReading, 'reading frozen occurrences never edits the current draft');
  }
  for (const item of selected.items) {
    const detail = await api<MemoryDetail>(`memory/${item.evidence.id}`); assert.deepEqual(detail.uses, { selected: 1, inserted: 1, approved: 1, published: 0 });
    const approved = detail.occurrences.items.filter(use => use.stage === 'approved'); assert.equal(approved.length, 1);
    assert.equal(approved[0].personId, approval.by); assert.equal(approved[0].stage, 'approved'); if (approved[0].stage === 'approved') assert.deepEqual(approved[0].proof!.selected, item);
  }
  const original = materials.find(material => material.kind === 'statistic')!, beforeRevision = await record(made.productionId);
  const frozen = structuredClone(beforeRevision.versions), draftBeforeRevision = structuredClone(beforeRevision.pieces[0].draft);
  const correctedText = original.text.replace('240', '241');
  const revisionReason = 'Synthetic correction of the original count after approval.';
  const revised = ui ? await ui.reviseOriginal(original.material, original.text, correctedText, revisionReason) : await api<MemoryMaterialRevisionResult>(`memory/materials/${original.material.id}/revision`, {
    baseRevision: original.material.revision, source: original.material.source, text: correctedText, reason: revisionReason,
  });
  assert.equal(revised.material.source.sourceVersion, 2); assert.equal(revised.affectedEvidence, 2);
  assert.deepEqual((await record(made.productionId)).versions, frozen, 'original corrections never rewrite frozen approved/generated articles');
  assert.deepEqual((await record(made.productionId)).pieces[0].draft, draftBeforeRevision);
  const originalContext = await api<MemorySelectedContext>(`memory/productions/${made.productionId}/sources/${made.sourceId}/context?sourceVersion=1&segmentId=${encodeURIComponent(initialProof.items[0].segmentId)}`);
  assert.deepEqual(originalContext.binding.selected, selected.items[0]); assert.equal(originalContext.current.matchesSelection, false);
  assert.equal(originalContext.original.ref.sourceVersion, 1); assert.ok(originalContext.original.excerpt.includes('240'));
  for (const item of selected.items.filter(item => evidence.find(row => row.evidence.id === item.evidence.id)?.evidence.kind === 'statistic')) {
    const detail = await api<MemoryDetail>(`memory/${item.evidence.id}`);
    assert.equal(detail.evidence.revision, item.evidence.revision + 1); assert.equal(memoryEvidenceRef(detail.evidence).hash, item.evidence.hash);
    assert.equal(detail.evidence.anchor.source.sourceVersion, 1); assert.equal(detail.evidence.correction!.materialRevision, revised.material.revision);
    assert.equal(detail.eligibility.usable, false); assert.equal(detail.checkState, 'outdated');
    assert.deepEqual(detail.uses, { selected: 1, inserted: 1, approved: 1, published: 0 });
  }
  assert.equal((await api<{ ok: boolean }>('exports/prepare', { productionId: made.productionId, selection: [toVersionRef(approvedVersion)] })).ok, false);
  const blocked = await api<{ ok: boolean; refusal: { code: string } }>('workspace', { method: 'generation.start', args: ['article.draft', { productionId: made.productionId, pieceId: made.pieceId }], requestId: randomUUID() });
  assert.equal(blocked.ok, false); assert.equal(blocked.refusal.code, 'memory_not_ready');
  const newPassages = passages.filter(passage => passage.kind === 'statistic').map(passage => ({ ...passage, text: passage.text.replace('240', '241'), raw: passage.raw === '240' ? '241' : passage.raw }));
  for (let turn = 0; turn < 4; turn++) {
    if ((await api<MemoryJob>(`memory/jobs/${revised.job.id}`)).status === 'completed') break;
    assert.equal(await runMemoryJob('journey-reextract', new AbortController().signal, undefined, async claim => ({
      value: { overflow: false, evidence: newPassages.flatMap(passage => {
        const at = correctedText.indexOf(passage.text), block = claim.block!.anchor.spans[0];
        return at < block.from || at >= block.to ? [] : [{ kind: 'statistic', excerpt: passage.text, from: at - claim.context.from, kinds: ['declared'],
          indicator: 'Observação sintética', raw: passage.raw, unit: passage.unit, period: passage.period, geography: 'Brasil', population: null, qualifier: passage.qualifier, issuingInstitution: null }];
      }) }, model: claim.job.model!, provider: 'synthetic', provider_request_id: null, usage_unit: 'tokens', input_units: 0, output_units: 0,
    })), true);
  }
  assert.equal((await api<MemoryJob>(`memory/jobs/${revised.job.id}`)).status, 'completed');
  const observations = (await api<MemoryPage<MemoryEvidenceView>>(`memory?materialId=${original.material.id}&limit=100`)).items;
  assert.equal(observations.length, 4); assert.equal(observations.filter(row => row.evidence.anchor.source.sourceVersion === 2).length, 2);
  assert.ok(observations.every(row => !row.eligibility.usable), 'corrected observations never inherit old acceptance');
  assert.deepEqual((await record(made.productionId)).versions, frozen);
  assert.deepEqual((await record(made.productionId)).pieces[0].draft, draftBeforeRevision);
  if (ui) {
    const quotation = materials.find(material => material.kind === 'citation')!;
    const competitor = quotation.text + '\n\nSynthetic concurrent clarification.';
    const finalText = quotation.text + '\n\nSynthetic final editorial clarification.';
    const resolved = await ui.reviseOriginal(quotation.material, quotation.text, finalText, 'Synthetic conflict resolved after comparing both originals.', {
      text: competitor,
      run: () => api<MemoryMaterialRevisionResult>(`memory/materials/${quotation.material.id}/revision`, {
        baseRevision: quotation.material.revision, source: quotation.material.source, text: competitor, reason: 'Synthetic competing edit by another workspace editor.',
      }, 2),
    });
    assert.equal(resolved.material.source.sourceVersion, 3); assert.equal(resolved.affectedEvidence, 2);
    assert.deepEqual((await record(made.productionId)).versions, frozen); assert.deepEqual((await record(made.productionId)).pieces[0].draft, draftBeforeRevision);
    const competingVersion = await api<{ source: { versions: { createdBy: string }[] } }>(`memory/materials/${quotation.material.id}?revision=2`);
    assert.equal(competingVersion.source.versions[0].createdBy, (await api<ConnectedWorkspace>('workspace', undefined, 2)).state.sessionPersonId);
  }
});
