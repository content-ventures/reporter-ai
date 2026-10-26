import assert from 'node:assert/strict';
import { withPilotWorker } from '../support/pilot-worker.ts';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { articlePlainText } from '../../src/domain/article.ts';
import type { ArticleBody } from '../../src/domain/article.ts';
import { defaultPipelineDefinition, pipelineRevision } from '../../src/domain/pipeline.ts';
import type { ConnectedWorkspace } from '../../src/ports/connected-workspace.ts';
import { editorialCandidates } from '../../src/runtime/editorial-engine.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';

const APP = 'http://127.0.0.1:3997', PORTAL = '10000000-0000-0000-0000-000000000101';
const identity = { subject: 'image-rehearsal',email: 'images@rehearsal.test',name: 'Editora',image: undefined,emailVerified: true };
const quoteA = 'A previsão depende de testes reais.',quoteB = 'Ainda não temos um calendário definido.';
const filler = 'A equipe avalia os dados da fonte e mantém o plano em teste. ';
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>,admin: pg.Client;
let apiHandler: typeof import('../../src/server/http.ts').handleReporter;
let textWorker: typeof import('../../src/server/editorial-worker.ts').runEditorialJob;
let imageWorker: typeof import('../../src/server/article-image-worker.ts').runArticleImageJob;
let editorial: typeof import('../../src/server/editorial.ts').editorialTransaction;
let illustrate: typeof import('../../src/server/article-illustration.ts').illustrateArticle;
const originalFetch = globalThis.fetch;
let output: unknown;
const signal = () => new AbortController().signal;
function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise,release }; }

async function api<T>(body?: unknown) {
  const request = new Request(`${APP}/api/reporter/workspace`,body === undefined ? undefined : { method: 'POST',
    headers: { origin: APP,'content-type': 'application/json','x-reporter-client': 'local' },body: JSON.stringify(body) });
  const response = await apiHandler(request,['workspace'],{ defer: () => {},identify: async () => identity });
  assert.equal(response.status,200,await response.clone().text());
  return await response.json() as T;
}
async function rpc(method: string,args: unknown[]) {
  const result = await api<{ ok: boolean; value: Record<string,string> }>({ method,args,requestId: randomUUID() });
  assert.equal(result.ok,true,JSON.stringify(result)); return result.value;
}
const workspace = () => api<ConnectedWorkspace>();
async function fixture() {
  const created = await rpc('createFromSource',[{ title: 'Teste de imagens',plan: ['article'],brief: { sections: 2,size: 'standard' },
    material: { text: quoteA+'\n\n'+quoteB,origin: 'event',authorized: true } }]);
  await withPilotWorker(()=>editorial('worker',async checkpoint => {
    const definition = defaultPipelineDefinition(); definition.articleMode = 'single';
    checkpoint.pipeline = pipelineRevision(definition);
  }));
  const snapshot = await workspace(),record = snapshot.state.productions.find(p => p.production.id === created.productionId)!;
  const piece = record.pieces[0];
  const candidates = editorialCandidates({ ...record,sources: snapshot.state.sources.filter(source => record.production.sourceIds.includes(source.id)) });
  const first = candidates.find(candidate => candidate.text.includes(quoteA))!,second = candidates.find(candidate => candidate.text.includes(quoteB))!;
  output = { title: 'Teste de imagens',intro: [{ text: filler.repeat(8).trim(),evidenceIds: [first.key] }],
    sections: [{ title: 'Dados da fonte',paragraphs: [{ text: filler.repeat(21)+`A fonte diz: “${quoteA}”`,evidenceIds: [first.key] }] },
      { title: 'Próximos testes',paragraphs: [{ text: filler.repeat(21)+`A fonte explica: “${quoteB}”`,evidenceIds: [second.key] }] }] };
  const started = await rpc('generation.start',['article.draft',{ productionId: created.productionId,pieceId: piece.id,
    outline: { title: 'Teste de imagens',intro: { quotes: [] },sections: [{ blockId: 'section-a',title: 'Dados da fonte',quotes: [first.ref] },
      { blockId: 'section-b',title: 'Próximos testes',quotes: [second.ref] }] } }]);
  const ran=await textWorker('rehearsal-text',signal());
  const scheduling=ran?undefined:(await admin.query(`SELECT r.status,r.available_at,clock_timestamp() AS database_now,
    r.lease_until,d.lease_owner AS dispatch_owner,d.lease_until AS dispatch_until
    FROM public.reporter_ed_runs r LEFT JOIN public.reporter_worker_dispatches d USING(portal_id) WHERE r.run_id=$1`,[started.runId])).rows[0];
  assert.equal(ran,true,JSON.stringify(scheduling));
  const done = await workspace(),production = done.state.productions.find(p => p.production.id === created.productionId)!;
  assert.equal(done.state.runFolds[started.runId].run.status,'completed',JSON.stringify(done.state.runFolds[started.runId].run.error));
  assert.equal(production.versions.length,1,'validated text is an immutable version before any image work');
  const draft = production.pieces[0].draft;
  return { runId: started.runId,productionId: created.productionId,pieceId: piece.id,draft,body: draft.body as ArticleBody,
    usage: done.state.runFolds[started.runId].run.usage!,version: production.versions[0] };
}
const suggestion = (body: ArticleBody) => ({ cover: { subject: 'Ilustração de pescado',suggestedAlt: 'Pescado',suggestedCaption: 'Ilustração de teste',
  orientation: 'landscape',sourceBlockIds: [body.blocks.find(block => block.type === 'paragraph')!.id] },figures: [] });
const plan = (body: ArticleBody): NonNullable<Parameters<typeof imageWorker>[2]>['plan'] => async () => ({ value: suggestion(body),
  needsRevision: false,provider: 'groq',model: 'synthetic',provider_request_id: null,usage_unit: 'tokens',input_units: 3,output_units: 5 });
const fakeIllustration: typeof illustrate = (body,productionId,abort,_deps,actor) => illustrate(body,productionId,abort,{
  generate: async () => ({ bytes: Buffer.from('synthetic JPEG'),width: 1536,height: 1024 }),store: async () => {},
},actor);
const state = async (productionId: string) => (await workspace()).state.productions.find(p => p.production.id === productionId)!;

before(async () => {
  db = await startRehearsalDatabase([{ email: identity.email,role: 'editor' }]);
  admin = new pg.Client({ connectionString: db.owner }); await admin.connect();
  Object.assign(process.env,{ REPORTER_DEPLOYMENT_MODE: 'cloud',REPORTER_DATABASE_URL: db.runtime,REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_WORKER_PASSWORD: db.workerPassword,REPORTER_DEFAULT_PORTAL_ID: PORTAL,REPORTER_APP_ORIGINS: APP,GROQ_API_KEY: 'synthetic-placeholder' });
  ({ handleReporter: apiHandler } = await import('../../src/server/http.ts'));
  ({ runEditorialJob: textWorker } = await import('../../src/server/editorial-worker.ts'));
  ({ runArticleImageJob: imageWorker } = await import('../../src/server/article-image-worker.ts'));
  ({ editorialTransaction: editorial } = await import('../../src/server/editorial.ts'));
  ({ illustrateArticle: illustrate } = await import('../../src/server/article-illustration.ts'));
  await workspace();
  globalThis.fetch = async input => {
    assert.equal(String(input),'https://api.groq.com/openai/v1/chat/completions','no external service is contacted');
    return Response.json({ usage: { prompt_tokens: 10,completion_tokens: 10 },choices: [{ finish_reason: 'stop',message: { content: JSON.stringify(output) } }] });
  };
},{ timeout: 180000 });
after(async () => {
  globalThis.fetch = originalFetch;
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string,Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end().catch(() => {})));
  await admin?.end(); db?.stop();
});

test('text completes before images; the durable image job later adds a version with identical prose',async () => {
  const f = await fixture(),entered = latch(),release = latch();
  const { drainServices } = await import('../../src/server/worker-drain.ts');
  assert.equal(await drainServices.pending(),true,'the normal drain discovers images after text completion');
  const task = imageWorker('rehearsal-images',signal(),{ plan: plan(f.body),illustrate: async (...args) => {
    entered.release(); await release.promise; return fakeIllustration(...args);
  } });
  await entered.promise;
  try {
    assert.equal((await state(f.productionId)).versions.length,1);
    assert.equal(await imageWorker('rehearsal-other',signal()),false,'another worker cannot claim the live image lease');
    assert.equal(await textWorker('rehearsal-other',signal()),false,'completed text is never regenerated by the text worker');
  } finally { release.release(); await task; }
  const production = await state(f.productionId),body = production.pieces[0].draft.body as ArticleBody;
  assert.ok(body.cover); assert.equal(articlePlainText(body),articlePlainText(f.body));
  assert.equal(production.versions.length,2);
  assert.deepEqual(production.versions[0],f.version,'the original text version is immutable');
  const usage = (await workspace()).state.runFolds[f.runId].run.usage!;
  assert.equal(usage.inputTokens,f.usage.inputTokens!+3); assert.equal(usage.outputTokens,f.usage.outputTokens!+5);
  assert.equal(await imageWorker('rehearsal-images',signal()),false,'completion is idempotent');
  assert.equal(await drainServices.pending(),false,'finished images do not keep the drain alive');
});

test('an edit while images are generated is preserved; completed assets remain available for selection',async () => {
  const f = await fixture(),entered = latch(),release = latch();
  const task = imageWorker('rehearsal-images',signal(),{ plan: plan(f.body),illustrate: async (...args) => {
    entered.release(); await release.promise; return fakeIllustration(...args);
  } });
  await entered.promise;
  const edited = { ...f.body,title: 'Título da editora' };
  try { await rpc('saveDraft',[f.pieceId,edited,f.draft.revision]); }
  finally { release.release(); await task; }
  const snapshot = await workspace(),production = snapshot.state.productions.find(p => p.production.id === f.productionId)!;
  assert.deepEqual(production.pieces[0].draft.body,edited);
  assert.equal(production.versions.length,1);
  assert.equal(snapshot.imageAssets?.filter(asset => asset.productionId === f.productionId).length,1);
});

test('a changed or unauthorized source prevents optional image calls without failing the article',async () => {
  const f = await fixture();
  const snapshot = await workspace(),production = snapshot.state.productions.find(p => p.production.id === f.productionId)!;
  await rpc('setMaterialAuthorization',[production.production.sourceIds[0],false]);
  let calls = 0;
  await imageWorker('rehearsal-images',signal(),{ plan: (async () => { calls++; throw new Error('unexpected'); }) as ReturnType<typeof plan>,illustrate: fakeIllustration });
  assert.equal(calls,0);
  const done = await workspace();
  assert.equal(done.state.runFolds[f.runId].run.status,'completed');
  assert.deepEqual((await state(f.productionId)).pieces[0].draft.body,f.body);
});

test('expired image leases can be reclaimed; their old fence cannot renew or commit',async () => {
  const f = await fixture();
  const { transaction } = await import('../../src/server/database.ts');
  const claim = async (owner: string) => withPilotWorker(()=>transaction('worker',async client =>
    (await client.query('SELECT public.reporter_ed_image_claim($1,60000) AS value',[owner])).rows[0].value as { fence: string }));
  const first = await claim('rehearsal-first');
  await admin.query("UPDATE public.reporter_ed_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[f.runId]);
  const second = await claim('rehearsal-second');
  assert.notEqual(first.fence,second.fence);
  const renewed = await withPilotWorker(()=>transaction('worker',async client => (await client.query('SELECT public.reporter_ed_image_renew($1,$2,$3,60000) AS value',
    [f.runId,'rehearsal-first',first.fence])).rows[0].value));
  assert.equal(renewed,false);
  await admin.query("UPDATE public.reporter_ed_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[f.runId]);
  await imageWorker('rehearsal-final',signal(),{ plan: plan(f.body),illustrate: fakeIllustration });
  assert.ok(((await state(f.productionId)).pieces[0].draft.body as ArticleBody).cover);
});

test('a stale image worker cannot attach its late result after another worker settles the same job',async () => {
  const f = await fixture(),entered = latch(),release = latch();
  const stale = imageWorker('rehearsal-stale',signal(),{ plan: plan(f.body),illustrate: async (...args) => {
    entered.release(); await release.promise; return fakeIllustration(...args);
  } });
  await entered.promise;
  try {
    await admin.query("UPDATE public.reporter_ed_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[f.runId]);
    await admin.query("UPDATE public.reporter_worker_dispatches SET lease_until=clock_timestamp()-interval '1 second' WHERE portal_id=$1",[PORTAL]);
    await imageWorker('rehearsal-current',signal(),{ plan: plan(f.body),illustrate: fakeIllustration });
    const current = await state(f.productionId);
    release.release(); await stale;
    assert.deepEqual(await state(f.productionId),current);
    assert.equal((await workspace()).imageAssets?.filter(asset => asset.productionId === f.productionId).length,1);
  } finally { release.release(); await stale; }
});

test('optional image-provider failure preserves the completed text and does not consume a text attempt',async () => {
  const f = await fixture();
  const { FlowError } = await import('../../src/server/errors.ts');
  await imageWorker('rehearsal-images',signal(),{ plan: async () => { throw new FlowError('OPENAI_QUOTA_EXHAUSTED',429); },illustrate: fakeIllustration });
  const snapshot = await workspace();
  assert.equal(snapshot.state.runFolds[f.runId].run.status,'completed');
  assert.deepEqual((await state(f.productionId)).pieces[0].draft.body,f.body);
  const row = (await admin.query('SELECT attempts,job->\'images\' AS images FROM public.reporter_ed_runs WHERE run_id=$1',[f.runId])).rows[0];
  assert.equal(row.attempts,1); assert.equal(row.images.status,'failed');
  assert.equal(row.images.attempts,1);
});
