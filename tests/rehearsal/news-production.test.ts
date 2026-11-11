import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { defaultPipelineDefinition, type PipelineView } from '../../src/domain/pipeline.ts';
import { defaultWritingOrchestration } from '../../src/domain/writing-orchestration.ts';
import { defaultWritingResearch } from '../../src/domain/writing-research.ts';
import type { CreatedProduction } from '../../src/ports/production-commands.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';

const APP = 'http://127.0.0.1:3996', PORTAL = '10000000-0000-0000-0000-000000000101';
const identity = { subject: 'news-production-rehearsal', email: 'news-production@rehearsal.test', name: 'Editor', emailVerified: true };
let db: Awaited<ReturnType<typeof startRehearsalDatabase>>, owner: pg.Client;
let handle: typeof import('../../src/server/http.ts').handleReporter;

async function api<T>(path: string, body?: unknown) {
  const response = await handle(new Request(`${APP}/api/reporter/${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { origin: APP, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), path.split('/'), { identify: async () => identity, defer: () => {} });
  assert.equal(response.status, 200, await response.clone().text());
  return await response.json() as T;
}
type Answer<T> = { ok: true; value: T } | { ok: false; refusal: { code: string; message: string } };
const rpc = <T>(method: string, args: unknown[]) => api<Answer<T>>('workspace', { method, args, requestId: randomUUID() });

async function configure(researchEnabled = true) {
  const current = await api<PipelineView>('pipeline');
  const definition = defaultPipelineDefinition('openai/gpt-4.1');
  definition.writing = { ...defaultWritingOrchestration('openai/gpt-4.1'), enabled: true,
    research: { ...defaultWritingResearch(), enabled: researchEnabled } };
  const saved = await rpc<PipelineView>('pipeline.save', [definition, current.active.revision]);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  return saved.ok ? saved.value.active : current.active;
}

async function selectedNews() {
  const id = randomUUID(), url = `https://publisher.example.test/${id}`;
  const title = 'SalmonChile sobre greve dos caminhoneiros';
  const text = 'A associação manifestou preocupação com os efeitos da paralisação dos transportadores.';
  await owner.query(`INSERT INTO public.reporter_news_items
    (id,portal_id,via,guid,url,canonical_url,title,outlet,excerpt,body,status,published_at)
    VALUES($1::uuid,$2,'url',$1::text,$3,$3,$4,'Publisher',$5,ARRAY[$5],'selected',clock_timestamp())`, [id, PORTAL, url, title, text]);
  return { id, material: { title, text, origin: 'other', sourceUrl: url, authorized: true } };
}

before(async () => {
  db = await startRehearsalDatabase([{ email: identity.email, role: 'admin' }]);
  owner = new pg.Client({ connectionString: db.owner });
  await owner.connect();
  Object.assign(process.env, { REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime,
    REPORTER_WORKER_DATABASE_URL: db.worker, REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_APP_ORIGINS: APP,
    OPENAI_API_KEY: 'synthetic-provider-key', TAVILY_API_KEY: 'synthetic-research-key' });
  ({ handleReporter: handle } = await import('../../src/server/http.ts'));
}, { timeout: 180_000 });

after(async () => {
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end()));
  await owner?.end();
  db?.stop();
});

test('a selected story uses the saved research pipeline, links once and queues its article', async () => {
  const pipeline = await configure();
  const news = await selectedNews();
  const input = { newsItemId: news.id, title: news.material.title, material: news.material,
    brief: { size: 'standard', sections: 3 }, plan: ['article'] };
  const created = await rpc<CreatedProduction>('createFromSource', [input]);
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  const linked = (await owner.query('SELECT status,production_id FROM public.reporter_news_items WHERE id=$1', [news.id])).rows[0];
  assert.deepEqual(linked, { status: 'covered', production_id: created.value.productionId });
  const reused = await rpc<CreatedProduction>('createFromSource', [input]);
  assert.equal(reused.ok, true, JSON.stringify(reused));
  if (reused.ok) {
    assert.equal(reused.value.productionId, created.value.productionId);
    assert.equal(reused.value.reusedNewsLink, true);
  }
  const started = await rpc<{ runId: string }>('generation.start', ['article.draft', {
    productionId: created.value.productionId, pieceId: created.value.pieces[0].pieceId,
  }]);
  assert.equal(started.ok, true, JSON.stringify(started));
  if (started.ok) {
    const run = (await owner.query('SELECT status,job FROM public.reporter_ed_runs WHERE run_id=$1', [started.value.runId])).rows[0];
    assert.equal(run.status, 'running');
    assert.equal(run.job.pipelineHash, pipeline.hash);
  }
});

test('a bundle reads the same saved pipeline and links both stories to one article', async () => {
  await configure();
  const items = await Promise.all([selectedNews(), selectedNews()]);
  const created = await rpc<CreatedProduction>('createFromSource', [{ newsItemIds: items.map(item => item.id),
    title: 'Síntese das fontes', material: { ...items[0].material, kind: 'news' },
    additionalMaterials: [{ ...items[1].material, kind: 'news' }],
    brief: { size: 'standard', sections: 3 }, plan: ['article'] }]);
  assert.equal(created.ok, true, JSON.stringify(created));
  if (!created.ok) return;
  const links = (await owner.query('SELECT status,production_id FROM public.reporter_news_items WHERE id=ANY($1::uuid[])', [items.map(item => item.id)])).rows;
  assert.equal(links.length, 2);
  for (const link of links) assert.deepEqual(link, { status: 'covered', production_id: created.value.productionId });
});

test('disabled saved research still refuses creation and preserves the selected story', async () => {
  await configure(false);
  const news = await selectedNews();
  const result = await rpc<CreatedProduction>('createFromSource', [{ newsItemId: news.id,
    title: news.material.title, material: news.material, brief: { size: 'standard', sections: 3 }, plan: ['article'] }]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.code, 'hard_news_research_not_ready');
  const item = (await owner.query('SELECT status,production_id FROM public.reporter_news_items WHERE id=$1', [news.id])).rows[0];
  assert.deepEqual(item, { status: 'selected', production_id: null });
});
