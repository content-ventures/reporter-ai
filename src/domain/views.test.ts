import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ArticleBody } from './article.ts';
import { deliveryIdempotencyKey, exportFileName } from './delivery.ts';
import { buildManifest, plannedExportFiles } from './manifest.ts';
import { buildOverview, DAY_MS } from './overview.ts';
import { canExport, defaultExportSelection } from './rules/export.ts';
import { toVersionRef } from './piece.ts';
import {
  addCarouselPiece,
  approvedPackage,
  baseRecord,
  commitVersion,
  createKit,
  JOAO,
  MEMBERS,
  PEDRO,
  recordDecision,
  requestReview,
  sampleArticle,
  sampleCarousel,
  TEMPLATE,
} from './testing/scenario.ts';
import { buildProductionView, toSourceSummary } from './views.ts';
import { sendChecklist } from './approval.ts';
import { writingResearchEvidence } from './writing-research-evidence.ts';

describe('ProductionView', () => {
  test('real provider productions expose mandatory R1 checks and their next corrective actions', () => {
    const kit = createKit(), record = baseRecord(kit);
    commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    record.runs.push({ id: 'real-outline', kind: 'article.outline', productionId: record.production.id,
      prompt: { key: 'pipeline', version: '23', hash: 'hash' }, model: { engine: 'provider', alias: 'openai/gpt-6-astra', label: 'OpenAI' },
      inputs: [], status: 'completed', steps: [], createdBy: JOAO, createdAt: kit.now() });
    const piece = buildProductionView(record, { now: kit.now(), templates: [TEMPLATE] }).pieces[0];
    assert.equal(piece.checks.find(check => check.id === 'article.length')?.status, 'fail');
    assert.equal(piece.checks.find(check => check.id === 'article.length')?.blocking, true);
    assert.equal(piece.checks.find(check => check.id === 'article.quotes')?.blocking, true);
    assert.equal(piece.readiness.ready, false);
    const checklist = sendChecklist({ kind: 'article', checks: piece.checks, openSuggestionIds: [], running: false, empty: false });
    assert.equal(checklist.find(item => item.id === 'size')?.level, 'missing');
    assert.match(checklist.find(item => item.id === 'size')?.text ?? '', /2.500/);
    assert.ok(checklist.find(item => item.id === 'size')?.action);
  });
  test('assembles stages, pieces, versions, checks and the next action', () => {
    const kit = createKit();
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    requestReview(record, kit, v1);
    const view = buildProductionView(record, { now: kit.now(), templates: [TEMPLATE] });
    assert.equal(view.status, 'in_review');
    assert.equal(view.statusLabel, 'Aguardando aprovação');
    assert.equal(view.currentStageId, 'approval', 'sent: Artigo is done, Aprovação is where it stands');
    assert.deepEqual(view.nextAction, { kind: 'review', label: 'Aprovar artigo', stageId: 'article', pieceKind: 'article' });
    const [article] = view.pieces;
    assert.equal(article.status, 'in_review');
    assert.equal(article.latestVersion?.label, 'v1 · IA');
    assert.equal(article.latestVersion?.words, 33);
    assert.equal(article.draft.dirty, false);
    assert.equal(article.draft.unreviewedAiBlocks, 4);
    assert.equal(article.pendingReview?.subject.versionId, v1.id);
    assert.equal(article.readiness.ready, true);
    assert.equal(view.pieces.length, 1, 'carousel piece not created yet');
    assert.equal(view.sources[0].speakers.find((speaker) => speaker.label === 'Marina Lopes')?.personId, 'person-marina');
  });

  test('marks the current approved version and stale derivatives', () => {
    const kit = createKit();
    const { record, article } = approvedPackage(kit);
    const v2 = commitVersion(record, kit, 'article', { ...(article.body as ArticleBody), title: 'Revisto' });
    recordDecision(record, kit, v2, 'approved');
    const view = buildProductionView(record, { now: kit.now(), templates: [TEMPLATE] });
    const [articleView, carouselView] = view.pieces;
    assert.equal(articleView.approvedVersion?.number, 2);
    assert.deepEqual(articleView.versions.map((version) => version.isCurrentApproved), [false, true]);
    assert.equal(articleView.versions[0].decision?.kind, 'approved');
    assert.equal(carouselView.status, 'stale');
    assert.equal(carouselView.staleMessage, 'O artigo aprovado mudou.');
    assert.deepEqual(view.nextAction, { kind: 'update', label: 'Atualizar carrossel', stageId: 'carousel', pieceKind: 'carousel' });
    const versionCheck = carouselView.checks.find((check) => check.id === 'carousel.article-version');
    assert.equal(versionCheck?.status, 'warn');
  });

  test('next action walks the flow: authorise → generate → derive → export', () => {
    const kit = createKit();
    assert.equal(buildProductionView(baseRecord(kit, { authorized: false }), { now: kit.now() }).nextAction.kind, 'authorize');
    assert.equal(buildProductionView(baseRecord(kit), { now: kit.now() }).nextAction.label, 'Gerar artigo');
    const record = baseRecord(kit);
    const v1 = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]));
    recordDecision(record, kit, v1, 'approved');
    assert.deepEqual(buildProductionView(record, { now: kit.now() }).nextAction, { kind: 'derive', label: 'Gerar carrossel', stageId: 'carousel', pieceKind: 'carousel' });
    addCarouselPiece(record, kit);
    const c1 = commitVersion(record, kit, 'carousel', sampleCarousel(), { inputs: [toVersionRef(v1)] });
    recordDecision(record, kit, c1, 'approved');
    assert.equal(buildProductionView(record, { now: kit.now() }).nextAction.kind, 'export');
  });

  test('source summary reports words, speakers, short hash and authorisation', () => {
    const record = baseRecord(createKit());
    const summary = toSourceSummary(record.sources[0]);
    assert.equal(summary.segments, 6);
    assert.equal(summary.shortHash.length, 7);
    assert.equal(summary.authorized, true);
    assert.equal(summary.hasTimestamps, false);
    assert.equal(summary.durationMs, undefined, 'never invents a duration');
  });
});

describe('OverviewView', () => {
  test('counts work in progress, approvals in range vs previous range, and who is waiting', () => {
    const kit = createKit();
    const inReview = baseRecord(kit);
    const v1 = commitVersion(inReview, kit, 'article', sampleArticle(inReview.sources[0]), { origin: 'generation' });
    requestReview(inReview, kit, v1);
    const done = approvedPackage(kit).record;
    done.production = { ...done.production, id: 'prod-2', title: 'Podcast Calçados' };
    const now = kit.now();
    const history = [
      { productionId: 'old-1', approvedAt: new Date(Date.parse(now) - 2 * DAY_MS).toISOString(), timeToApprovalMs: 4 * 3_600_000, aiRetention: 0.8 },
      { productionId: 'old-2', approvedAt: new Date(Date.parse(now) - 9 * DAY_MS).toISOString(), timeToApprovalMs: 6 * 3_600_000, aiRetention: 0.6 },
    ];
    const pedro = buildOverview({ records: [inReview, done], history, now, rangeDays: 7, viewer: MEMBERS[PEDRO] });
    assert.equal(pedro.metrics.inProduction, 2);
    assert.equal(pedro.metrics.awaitingApproval, 1);
    assert.equal(pedro.metrics.generatingNow, 0);
    assert.deepEqual(pedro.metrics.approved, { value: 2, previous: 1 });
    assert.equal(pedro.metrics.timeToApprovalMs.previous, 6 * 3_600_000);
    assert.equal(pedro.metrics.aiRetention.previous, 0.6);
    assert.deepEqual(pedro.awaitingYou.map((view) => view.id), ['prod-1']);
    assert.equal(pedro.rhythm.length, 7);
    assert.equal(pedro.rhythm.reduce((total, day) => total + day.current, 0), 2);
    assert.equal(pedro.rhythm.reduce((total, day) => total + day.previous, 0), 1);
    assert.equal(pedro.continueWith, undefined, 'Pedro owns no production');

    const joao = buildOverview({ records: [inReview, done], history, now, rangeDays: 7, viewer: MEMBERS[JOAO] });
    assert.equal(joao.continueWith?.id, 'prod-2', 'most recently active production of the viewer');
    assert.deepEqual(joao.awaitingYou.map((view) => view.id), ['prod-1'], 'admins can self-approve');
  });
});

describe('delivery package', () => {
  test('plans the final file set and a manifest linking source, versions, approvals and runs', () => {
    const kit = createKit();
    const { record, article, carousel } = approvedPackage(kit);
    const items = canExport(record, defaultExportSelection(record));
    assert.ok(items.ok);
    const files = plannedExportFiles(record, items.value);
    assert.deepEqual(
      files.map((file) => file.fileName),
      [
        'artigo-v1.md',
        'artigo-v1.html',
        'carrossel-v1-slide-01.png',
        'carrossel-v1-slide-02.png',
        'carrossel-v1-slide-03.png',
        'carrossel-v1-slide-04.png',
        'carrossel-v1.pdf',
        'manifesto.json',
      ],
    );
    const limited = plannedExportFiles(record, items.value, { md: true, html: true, json: true, png: 'Render indisponível nesta prévia.' });
    const png = limited.find((file) => file.format === 'png');
    assert.equal(png?.available, false);
    assert.equal(png?.unavailableReason, 'Render indisponível nesta prévia.');
    assert.equal(limited.find((file) => file.format === 'pdf')?.unavailableReason, 'Formato ainda não disponível.');

    const manifest = buildManifest(record, items.value, files, kit.now());
    assert.equal(manifest.schema, 'reporter.delivery/v1');
    assert.equal(manifest.workspaceId,record.production.workspaceId);
    assert.equal(manifest.items[1].template?.id,carousel.body.type==='carousel'?carousel.body.templateId:undefined);
    assert.equal(manifest.sources[0].hash, record.sources[0].versions[0].hash);
    assert.deepEqual(manifest.items[1].derivedFrom, [{ pieceId: article.pieceId, version: 1, hash: article.hash }]);
    assert.equal(manifest.items[0].approvedBy, PEDRO);
    assert.equal(manifest.items[1].versionId, carousel.id);
    assert.deepEqual(manifest.items[0].files, ['artigo-v1.md', 'artigo-v1.html']);
    assert.equal(manifest.items[0].sourceVersions[0].version, 1);
    // The size travels with the package: the brief's size and the article's lauda count.
    assert.equal(manifest.production.size, record.production.brief.size);
    assert.equal(manifest.items[0].characters, 192);
    assert.equal(manifest.items[0].laudas, 0.1);
    assert.equal(manifest.items[1].characters, undefined, 'carousels are not measured in laudas');
  });

  test('file names and idempotency keys are deterministic', () => {
    assert.equal(exportFileName('article', { number: 4 }, 'md'), 'artigo-v4.md');
    assert.equal(exportFileName('carousel', { number: 2 }, 'png', 2), 'carrossel-v2-slide-03.png');
    const a = { kind: 'version' as const, pieceId: 'pa', versionId: 'va', number: 1, hash: 'ha' };
    const b = { kind: 'version' as const, pieceId: 'pb', versionId: 'vb', number: 1, hash: 'hb' };
    assert.equal(deliveryIdempotencyKey('prod', 'export', [a, b]), deliveryIdempotencyKey('prod', 'export', [b, a]));
    assert.notEqual(deliveryIdempotencyKey('prod', 'export', [a]), deliveryIdempotencyKey('prod', 'export', [b]));
  });

  test('manifest keeps captured configuration references without exporting private provider properties',()=>{
    const kit=createKit(),{record}=approvedPackage(kit),selection=canExport(record,defaultExportSelection(record));assert.ok(selection.ok);if(!selection.ok)return;
    const version=record.versions.find(item=>item.id===selection.value[0].version.versionId)!;version.runId='captured-run';
    const configuration={workspaceId:record.production.workspaceId,pipeline:{hash:'pipeline-v7',revision:7},editorial:{mapVersion:3,guideVersion:4}};
    record.runs.push({id:'captured-run',kind:'article.generate',productionId:record.production.id,prompt:{key:'pipeline',hash:'pipeline-v7',version:'7'},
      model:{alias:'configured',label:'Configured model',engine:'provider'},configuration:Object.assign(structuredClone(configuration),{providerSecret:'private-test-value'}),
      inputs:[],steps:[],status:'completed',createdBy:JOAO,createdAt:kit.now()});
    const manifest=buildManifest(record,selection.value,[],kit.now());
    assert.deepEqual(manifest.runs[0].configuration,configuration);assert.ok(!JSON.stringify(manifest).includes('private-test-value'));
  });

  test('manifest carries web provenance without exporting source contents or private provider fields', () => {
    const kit = createKit(), { record } = approvedPackage(kit);
    const research = writingResearchEvidence([{ id: 'web-context', kind: 'external', provider: 'tavily',
      title: 'Technical context', query: 'ISKNV technical context', url: 'https://example.org/technical-context',
      site: 'example.org', excerpt: 'Private retained excerpt, not exported in the manifest.',
      retrievedAt: '2026-10-21T12:00:00Z', publishedOn: null }],
    { runId: 'writing-run', workspaceId: record.production.workspaceId, actorId: JOAO });
    const web = research.sources[0];
    Object.assign(web.research!, { apiKey: 'fake-private-provider-field' });
    record.sources.push(web);
    const manifest = buildManifest(record, [], [], kit.now());
    const original = record.sources[0];
    assert.deepEqual(manifest.sources[0], { id: original.id, title: original.title, version: 1,
      hash: original.versions[0].hash, authorized: original.rights.authorized });
    assert.deepEqual(manifest.sources[1], { id: web.id, title: web.title, version: 1,
      hash: web.versions[0].hash, authorized: true, sourceUrl: 'https://example.org/technical-context',
      research: { provider: 'tavily', runId: 'writing-run', query: 'ISKNV technical context',
        retrievedAt: '2026-10-21T12:00:00Z', publishedOn: null } });
    const serialized = JSON.stringify(manifest);
    assert.ok(!serialized.includes('fake-private-provider-field'));
    assert.ok(!serialized.includes(web.versions[0].content.segments[0].text));
    assert.ok(!serialized.includes(original.versions[0].content.segments[0].text));
  });
});
