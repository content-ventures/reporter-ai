import { after, before, mock } from 'node:test';
import pg, { type Pool } from 'pg';
import { resetEditorialRows } from '../../scripts/lib/editorial-rows.mjs';
import { createIdGenerator, systemClock } from '../../src/adapters/local/store/system.ts';
import { allPortContracts } from '../../src/ports/contracts/ports.contract.ts';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';
import { rowsPortsUnderTest, type RowsWorld } from '../support/rows-ports.ts';

/**
 * Every port contract the local simulation passes, run against the production path instead:
 * the HTTP handler, scoped row transactions in PostgreSQL with the cloud schema, and a browser
 * mirror fed by deltas. Only the Neon Auth session lookup is replaced.
 */
const APP = 'http://127.0.0.1:3998';
const PORTAL = '10000000-0000-0000-0000-000000000101';
const USERS = [
  { key: 'editor', name: 'Editora do contrato', role: 'admin', also: 'editor' },
  { key: 'approver', name: 'Aprovador do contrato', role: 'approver' },
  { key: 'editorOnly', name: 'Redatora do contrato', role: 'editor' },
  { key: 'creativeReviewer', name: 'Revisora criativa do contrato', role: 'creative_reviewer', also: 'editor' },
] as const;
const email = (key: string) => `${key.toLowerCase()}@contracts.test`;

let db: Awaited<ReturnType<typeof startRehearsalDatabase>> | undefined, owner: pg.Client | undefined;
const world = { origin: APP, advance: (ms: number) => mock.timers.tick(ms),
  reset: async () => { await resetEditorialRows(owner!, PORTAL); } } as RowsWorld;

before(async () => {
  db = await startRehearsalDatabase(USERS.map(user => ({ email: email(user.key), role: user.role })));
  owner = new pg.Client({ connectionString: db.owner });
  await owner.connect();
  // The grant script gives one role; the contract's editor also administers, its creative reviewer also writes.
  for (const user of USERS) if ('also' in user) await owner.query(`INSERT INTO public.portal_user_roles(portal_id,user_id,portal_role_id)
    SELECT $1,u.id,r.id FROM core.users u JOIN public.portal_roles r ON r.portal_id=$1 AND r.name=$3 WHERE u.email=$2 ON CONFLICT DO NOTHING`,
    [PORTAL, email(user.key), user.also]);
  const ids = new Map((await owner.query<{ id: string; email: string }>('SELECT id,email FROM core.users WHERE email=ANY($1)',
    [USERS.map(user => email(user.key))])).rows.map(row => [row.email, row.id]));
  world.people = Object.fromEntries(USERS.map(user => [user.key, { id: ids.get(email(user.key))!, identity: {
    subject: `contracts-${user.key}`, email: email(user.key), name: user.name, image: undefined, emailVerified: true as const } }])) as RowsWorld['people'];
  Object.assign(process.env, {
    REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_WORKER_PASSWORD: db.workerPassword, REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_APP_ORIGINS: APP, GROQ_API_KEY: 'contracts-placeholder',
  });
  world.handle = (await import('../../src/server/http.ts')).handleReporter;
  world.templateId = (await import('../../src/fixtures/templates/catalog.ts')).CAROUSEL_TEMPLATES[0].id;
  // Contracts move time explicitly; the browser mirror and the server share this clock.
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-15T12:00:00.000Z') });
}, { timeout: 180_000 });

after(async () => {
  mock.timers.reset();
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end().catch(() => {})));
  await owner?.end().catch(() => {});
  db?.stop();
});

allPortContracts('editorial rows over HTTP', () => rowsPortsUnderTest(world), () => ({ clock: systemClock(), ids: createIdGenerator() }));
