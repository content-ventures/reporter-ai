import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { paragraphBlock, type ArticleBody } from '../../src/domain/article.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';

/**
 * What Neon bills: bytes PostgreSQL sends to the app, protocol included, read from the socket.
 * Each command must cost the same with 5, 40 or 1000 productions in the workspace.
 */
const APP = 'http://127.0.0.1:3997';
const PORTAL = '10000000-0000-0000-0000-000000000101';
const EDITOR = { subject: 'budget-editor', email: 'editor@budget.test', name: 'Editora do orçamento', image: undefined, emailVerified: true as const };
const KIB = 1024;
const BUDGET = { idlePoll: 1 * KIB, rename: 16 * KIB, saveDraft: 24 * KIB, preview: 24 * KIB };
// A long interview: the transcript is the largest row a command could read by mistake.
const TRANSCRIPT = Array.from({ length: 400 }, (_, index) => `${index % 2 ? 'Helena Duarte' : 'Repórter'}: Fala ${index} sobre a cooperativa, `
  + 'a torrefação, o frete e os planos da comunidade para o próximo ano.').join('\n');
const article = (label: string, paragraphs: number): ArticleBody => ({ type: 'article', title: `Artigo ${label}`,
  blocks: Array.from({ length: paragraphs }, (_, index) => paragraphBlock(`budget-${index}`, `Parágrafo ${index} da versão ${label}: `
    + 'a cooperativa organiza a colheita, a secagem e a torra em pequenos lotes para manter a qualidade constante.'.repeat(3))) });

type Server = typeof import('../../src/server/http.ts') & typeof import('../../src/server/editorial.ts')
  & typeof import('../../src/server/editorial-worker.ts') & typeof import('../../src/server/database.ts')
  & typeof import('../../src/runtime/editorial-engine.ts');
let db: Awaited<ReturnType<typeof startRehearsalDatabase>> | undefined, owner: pg.Client | undefined, server: Server;
const globals = globalThis as typeof globalThis & { reporterPools?: Partial<Record<'runtime' | 'worker', Pool>> };

async function call<T = Record<string, unknown>>(path: string, body?: unknown): Promise<T> {
  const request = new Request(`${APP}/api/reporter/${path}`, body === undefined ? undefined : { method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json', 'x-reporter-client': 'local' }, body: JSON.stringify(body) });
  const response = await server.handleReporter(request, path.split('?')[0].split('/'), { defer: () => {}, identify: async () => EDITOR });
  const value = await response.json() as T;
  if (response.status !== 200) throw new Error(`${path} answered ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
async function rpc<T>(method: string, args: unknown[]) {
  const result = await call<{ ok: boolean; value: T; refusal?: unknown }>('workspace', { method, args, requestId: randomUUID() });
  assert.equal(result.ok, true, `${method}: ${JSON.stringify(result.refusal)}`);
  return result.value;
}

type Statement = { sql: string; values?: unknown[] };
/** Bytes read from every database socket while `work` ran, and the statements it sent. */
async function measure(work: () => Promise<unknown>) {
  let bytes = 0;
  const statements: Statement[] = [], restore: (() => void)[] = [];
  for (const pool of Object.values(globals.reporterPools ?? {})) {
    if (!pool) continue;
    const connect = pool.connect.bind(pool) as (callback?: (error: Error | undefined, client?: pg.PoolClient, done?: () => void) => void) => unknown;
    const track = (client: pg.PoolClient) => {
      const socket = (client as unknown as { connection: { stream: { bytesRead: number } } }).connection.stream;
      const start = socket.bytesRead, release = client.release, query = client.query;
      client.query = ((sql: string | { text: string }, values?: unknown, ...rest: unknown[]) => {
        statements.push({ sql: typeof sql === 'string' ? sql : sql.text, ...(Array.isArray(values) ? { values } : {}) });
        return (query as (...args: unknown[]) => unknown).call(client, sql, values, ...rest);
      }) as typeof client.query;
      client.release = ((...args: unknown[]) => {
        bytes += socket.bytesRead - start;
        client.release = release; client.query = query;
        return (release as (...input: unknown[]) => void).apply(client, args);
      }) as typeof client.release;
      return client;
    };
    (pool as { connect: unknown }).connect = (callback?: (error: Error | undefined, client?: pg.PoolClient, done?: () => void) => void) =>
      callback ? connect((error, client, done) => callback(error, client && track(client), done)) : (connect() as Promise<pg.PoolClient>).then(track);
    restore.push(() => { (pool as { connect: unknown }).connect = connect; });
  }
  try { await work(); } finally { restore.forEach(undo => undo()); }
  return { bytes, statements };
}
const loadScopes = (statements: Statement[]) => statements.filter(entry => entry.sql.includes('reporter_ed_load'))
  .map(entry => JSON.parse(String(entry.values?.[0])) as Record<string, unknown>);

async function createProduction(index: number) {
  return rpc<{ productionId: string; sourceId: string; pieces: { pieceId: string; kind: string }[] }>('createFromSource', [{
    title: `Produção ${index}`, plan: ['article'], brief: { sections: 3, size: 'standard' },
    material: { text: TRANSCRIPT, origin: 'interview', authorized: true } }]);
}

before(async () => {
  db = await startRehearsalDatabase([{ email: EDITOR.email, role: 'admin' }]);
  owner = new pg.Client({ connectionString: db.owner });
  await owner.connect();
  await owner.query(`INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id) SELECT $1,u.id,r.id FROM core.users u
    JOIN public.portal_roles r ON r.portal_id=$1 AND r.name='editor' WHERE u.email=$2 ON CONFLICT DO NOTHING`, [PORTAL, EDITOR.email]);
  Object.assign(process.env, {
    REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_WORKER_PASSWORD: db.workerPassword, REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_APP_ORIGINS: APP,
    GROQ_API_KEY: 'budget-placeholder', OPENAI_API_KEY: 'budget-placeholder', ANTHROPIC_API_KEY: 'budget-placeholder',
  });
  server = { ...await import('../../src/server/http.ts'), ...await import('../../src/server/editorial.ts'),
    ...await import('../../src/server/editorial-worker.ts'), ...await import('../../src/server/database.ts'),
    ...await import('../../src/runtime/editorial-engine.ts') } as Server;
}, { timeout: 180_000 });

after(async () => {
  await Promise.all(Object.values(globals.reporterPools ?? {}).map(pool => pool?.end().catch(() => {})));
  await owner?.end().catch(() => {});
  db?.stop();
});

const costs = new Map<number, Record<keyof typeof BUDGET, number>>();
let target: Awaited<ReturnType<typeof createProduction>> & { articleId: string } | undefined, created = 0;

for (const size of [5, 40]) test(`each command costs the same with ${size} productions`, { timeout: 120_000 }, async () => {
  if (!target) {
    const first = await createProduction(created++);
    target = { ...first, articleId: first.pieces.find(piece => piece.kind === 'article')!.pieceId };
    // Versions of a long article: the autosave must never read them.
    for (const label of ['v1', 'v2', 'v3']) {
      const revision = (await rpc<{ revision: number }>('saveDraft', [target.articleId, article(label, 12), await draftRevision()])).revision;
      assert.ok(revision > 0);
      await rpc('createVersion', [target.articleId]);
    }
  }
  while (created < size) await createProduction(created++);
  const token = (await call<{ syncToken: string }>('workspace')).syncToken;
  const idle = await measure(() => call(`workspace?since=${encodeURIComponent(token)}`));
  const rename = await measure(() => rpc('rename', [target!.productionId, `Título com ${size} produções`]));
  const revision = await draftRevision();
  const saveDraft = await measure(() => rpc('saveDraft', [target!.articleId, article(`rascunho ${size}`, 12), revision]));
  const [draftScope] = loadScopes(saveDraft.statements);
  assert.equal(draftScope.sources, 'none', 'the autosave never reads a transcript');
  assert.ok(!(draftScope.parts as string[]).includes('version'), 'the autosave never reads versions');

  // One worker progress event, as the claimed run's preview loop writes it.
  const run = await rpc<{ runId: string }>('generation.start', ['article.outline', { productionId: target!.productionId, pieceId: target!.articleId }]);
  const claim = await server.transaction('worker', async client => (await client.query('SELECT public.reporter_ed_claim($1,$2) AS claim',
    [`budget-worker-${size}`, 60000])).rows[0].claim as { runId: string; productionId: string });
  assert.equal(claim.runId, run.runId);
  const { progress } = server.editorialWorkerScopes(claim.runId, claim.productionId);
  const appendPreview = (label: string) => server.editorialTransaction('worker', async (checkpoint, engine) => {
    server.appendEditorialEvent(engine, checkpoint.jobs[claim.runId], { type: 'article.preview', body: article(label, 8) });
  }, true, 'reporter.edit', progress);
  await appendPreview('primeira prévia');
  const preview = await measure(() => appendPreview('segunda prévia'));
  await rpc('generation.cancel', [run.runId]);

  const cost = { idlePoll: idle.bytes, rename: rename.bytes, saveDraft: saveDraft.bytes, preview: preview.bytes };
  console.log(`[budget] ${size} productions: ${JSON.stringify(cost)}`);
  for (const [name, bytes] of Object.entries(cost)) assert.ok(bytes <= BUDGET[name as keyof typeof BUDGET], `${name}: ${bytes} B`);
  costs.set(size, cost);
  const smaller = costs.get(5);
  if (size !== 5 && smaller) for (const name of Object.keys(cost) as (keyof typeof cost)[]) {
    assert.ok(cost[name] - smaller[name] < 2 * KIB, `${name} grew with the workspace: ${smaller[name]} → ${cost[name]} B`);
  }
});

test('a thousand productions: no document holds the workspace, and commands stay within budget', { timeout: 180_000 }, async () => {
  assert.ok(target, 'the smaller workspaces ran first');
  // Clones of the long production, sharing its transcript, with every id of theirs renamed.
  await owner!.query(`CREATE FUNCTION pg_temp.cloned(value text,ids text[],suffix text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
    DECLARE id text; BEGIN FOREACH id IN ARRAY ids LOOP value:=replace(value,id,id||suffix); END LOOP; RETURN value; END $$`);
  await owner!.query(`WITH template AS (SELECT production_id,array_agg(part_id) AS ids FROM public.reporter_ed_parts WHERE portal_id=$1 AND production_id=$2 GROUP BY 1),
      clones AS (SELECT '-c'||n AS suffix FROM generate_series(1,1000) n),
      productions AS (INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,source_ids,archived,seq)
        SELECT p.portal_id,p.production_id||c.suffix,pg_temp.cloned(p.doc::text,t.ids||p.production_id,c.suffix)::jsonb,p.source_ids,p.archived,p.seq
        FROM public.reporter_ed_productions p JOIN template t USING(production_id) CROSS JOIN clones c WHERE p.portal_id=$1 RETURNING 1)
    INSERT INTO public.reporter_ed_parts(portal_id,kind,part_id,production_id,doc,deleted,seq)
      SELECT p.portal_id,p.kind,p.part_id||c.suffix,p.production_id||c.suffix,pg_temp.cloned(p.doc::text,t.ids||p.production_id,c.suffix)::jsonb,p.deleted,p.seq
      FROM public.reporter_ed_parts p JOIN template t USING(production_id) CROSS JOIN clones c
      WHERE p.portal_id=$1 AND p.kind<>'run' AND (SELECT count(*) FROM productions)>0`, [PORTAL, target!.productionId]);
  const sizes = (await owner!.query(`SELECT max(octet_length(doc::text)) AS largest,sum(octet_length(doc::text)) AS total
    FROM (SELECT doc FROM public.reporter_ed_productions UNION ALL SELECT doc FROM public.reporter_ed_parts WHERE doc IS NOT NULL) rows`)).rows[0];
  assert.ok(Number(sizes.total) > 20 * Number(sizes.largest), `rows stay small while the workspace grows: ${JSON.stringify(sizes)}`);
  const snapshot = await measure(() => call<{ state: { productions: unknown[] }; syncToken: string }>('workspace'));
  const { state, syncToken } = await call<{ state: { productions: unknown[] }; syncToken: string }>('workspace');
  assert.ok(state.productions.length > 1000, 'the whole workspace loads without a size cap');
  const idle = await measure(() => call(`workspace?since=${encodeURIComponent(syncToken)}`));
  const rename = await measure(() => rpc('rename', [`${target!.productionId}-c500`, 'Clone renomeado']));
  console.log(`[budget] 1000 productions: ${JSON.stringify({ snapshot: snapshot.bytes, idlePoll: idle.bytes, rename: rename.bytes, ...sizes })}`);
  assert.ok(idle.bytes <= BUDGET.idlePoll && rename.bytes <= BUDGET.rename, `idle ${idle.bytes} B, rename ${rename.bytes} B`);
});

async function draftRevision() {
  const workspace = await call<{ state: { productions: { production: { id: string }; pieces: { id: string; draft: { revision: number } }[] }[] } }>('workspace');
  return workspace.state.productions.find(entry => entry.production.id === target!.productionId)!
    .pieces.find(piece => piece.id === target!.articleId)!.draft.revision;
}
