import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import pg, { type Pool } from 'pg';
import { startRehearsalDatabase } from '../support/rehearsal-db.ts';

/**
 * The platform console and the access link, rehearsed: the production SQL (migration 020) in
 * PostgreSQL, the real route handlers, and a stand-in Neon Auth on loopback that keeps users in
 * the same `neon_auth` tables the hosted service writes. Only the session lookup is replaced.
 */
const APP = 'http://127.0.0.1:3998';
const PORTAL = '10000000-0000-0000-0000-000000000101';
const OPERATOR = { subject: 'auth-operator', email: 'operador@rehearsal.test', name: 'Operador', image: undefined, emailVerified: true };
const EDITOR = { subject: 'auth-editor', email: 'editora@rehearsal.test', name: 'Editora', image: undefined, emailVerified: true };

type Database = Awaited<ReturnType<typeof startRehearsalDatabase>>;
type Identity = typeof OPERATOR;
let db: Database, auth: Server, handleReporter: typeof import('../../src/server/http.ts').handleReporter;
const passwords = new Map<string, { id: string; password: string }>();
const authCalls: string[] = [];

async function owner<T extends pg.QueryResultRow>(sql: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: db.owner });
  await client.connect();
  try { return (await client.query<T>(sql, values)).rows; } finally { await client.end(); }
}

async function api<T = Record<string, unknown>>(path: string, body?: unknown, identity: Identity | null = OPERATOR) {
  const request = new Request(`${APP}/api/reporter/${path}`, body === undefined ? undefined : { method: 'POST',
    headers: { origin: APP, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await handleReporter(request, path.split('?')[0].split('/'), { defer: () => {}, identify: async () => identity });
  return { status: response.status, body: await response.json() as T };
}

/** Neon Auth's two endpoints the server calls, over the same tables the hosted service owns. */
function startFakeAuth(): Promise<Server> {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { email: string; password: string; name?: string };
    const email = body.email.toLowerCase();
    authCalls.push(`${request.url} ${request.headers.origin}`);
    const send = (status: number, value: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.headers.origin !== APP) return send(403, { code: 'INVALID_ORIGIN' });
    if (request.url === '/sign-up/email') {
      if (passwords.has(email)) return send(422, { code: 'USER_ALREADY_EXISTS' });
      const [row] = await owner<{ id: string }>('INSERT INTO neon_auth."user"(name,email) VALUES($1,$2) RETURNING id::text', [body.name ?? email, email]);
      passwords.set(email, { id: row.id, password: body.password });
      return send(200, { user: { id: row.id, email } });
    }
    if (request.url === '/sign-in/email') {
      const account = passwords.get(email);
      if (!account || account.password !== body.password) return send(401, { code: 'INVALID_EMAIL_OR_PASSWORD' });
      return send(200, { user: { id: account.id, email } });
    }
    send(404, {});
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

before(async () => {
  db = await startRehearsalDatabase([{ email: OPERATOR.email, role: 'admin' }, { email: EDITOR.email, role: 'editor' }]);
  await owner(`CREATE SCHEMA IF NOT EXISTS neon_auth;
    CREATE TABLE neon_auth."user"(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,email text NOT NULL UNIQUE,
      "emailVerified" boolean NOT NULL DEFAULT false,image text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
    CREATE TABLE neon_auth.session(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),"userId" uuid NOT NULL REFERENCES neon_auth."user"(id),
      "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());`);
  // Both people have signed in once (bound subject); only the operator holds the platform role.
  await owner(`UPDATE core.users SET auth_subject=CASE email WHEN $1 THEN $2 ELSE $4 END,email_verified=true WHERE email IN ($1,$3)`,
    [OPERATOR.email, OPERATOR.subject, EDITOR.email, EDITOR.subject]);
  await owner(`INSERT INTO public.user_roles(user_id,role) SELECT id,'platform_admin' FROM core.users WHERE email=$1`, [OPERATOR.email]);
  auth = await startFakeAuth();
  Object.assign(process.env, {
    REPORTER_DEPLOYMENT_MODE: 'cloud', REPORTER_DATABASE_URL: db.runtime, REPORTER_WORKER_DATABASE_URL: db.worker,
    REPORTER_DEFAULT_PORTAL_ID: PORTAL, REPORTER_APP_ORIGINS: APP, NEON_AUTH_BASE_URL: `http://127.0.0.1:${(auth.address() as AddressInfo).port}`,
  });
  ({ handleReporter } = await import('../../src/server/http.ts'));
}, { timeout: 180_000 });

after(async () => {
  const pools = (globalThis as typeof globalThis & { reporterPools?: Partial<Record<string, Pool>> }).reporterPools ?? {};
  await Promise.all(Object.values(pools).map(pool => pool?.end().catch(() => {})));
  await new Promise(resolve => auth?.close(resolve));
  db?.stop();
});

type Person = { id: string; email: string; status: string; roles: string[]; operator: boolean; inviteExpiresAt?: string };
const directory = async () => (await api<{ people: Person[]; workspaces: { id: string }[] }>('platform/directory')).body;
const find = async (email: string) => (await directory()).people.find(person => person.email === email);

test('migration 020 replays without changing who holds the platform role', async () => {
  const { readFile } = await import('node:fs/promises');
  await owner(await readFile(new URL('../../database/migrations/020-platform-admin.sql', import.meta.url), 'utf8'));
  const holders = await owner<{ email: string }>(`SELECT u.email FROM public.user_roles r JOIN core.users u ON u.id=r.user_id WHERE r.role='platform_admin'`);
  assert.deepEqual(holders.map(row => row.email), [OPERATOR.email]);
});

test('only the platform operator opens the console, without needing anything else', async () => {
  const operator = await api<{ email: string }>('platform/operator');
  assert.equal(operator.status, 200);
  assert.equal(operator.body.email, OPERATOR.email);
  assert.deepEqual((await api('platform/directory', undefined, EDITOR)).body, { error: 'restricted', message: 'Só o operador da plataforma abre este console.' });
  assert.equal((await api('platform/operator', undefined, null)).status, 401);
  const people = await directory();
  assert.ok(people.workspaces.some(workspace => workspace.id === PORTAL));
  assert.equal(people.people.find(person => person.email === OPERATOR.email)?.operator, true);
});

test('a link creates the access; the person defines the password and the e-mail counts as verified', async () => {
  const created = await api<{ token: string; person: Person }>('platform/invites', { name: 'Clara Souto', email: 'Clara@Rehearsal.test', role: 'editor', workspaceId: PORTAL });
  assert.equal(created.status, 200);
  assert.match(created.body.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.body.person.status, 'invited');
  assert.deepEqual(created.body.person.roles, ['editor']);
  const stored = await owner<{ token_hash: string }>('SELECT token_hash FROM core.access_invites');
  assert.ok(stored.every(row => row.token_hash !== created.body.token), 'only the hash is stored');
  assert.equal((await api('platform/invites', { name: 'Clara', email: 'clara@rehearsal.test', role: 'editor', workspaceId: PORTAL })).body.error, 'email_taken');

  const token = created.body.token;
  const preview = await api<{ state: string; email: string; hasAccount: boolean; workspaceName: string }>(`invites/${token}`, undefined, null);
  assert.deepEqual([preview.status, preview.body.state, preview.body.email, preview.body.hasAccount], [200, 'open', 'clara@rehearsal.test', false]);
  assert.equal((await api(`invites/${token}/accept`, { password: 'senha-forte', confirmation: 'outra-senha' }, null)).body.error, 'password_mismatch');
  const accepted = await api(`invites/${token}/accept`, { password: 'senha-forte', confirmation: 'senha-forte' }, null);
  assert.deepEqual([accepted.status, accepted.body], [200, { email: 'clara@rehearsal.test', signIn: true }]);
  assert.ok(authCalls.some(call => call === `/sign-up/email ${APP}`));
  const [account] = await owner<{ verified: boolean; bound: boolean }>(`SELECT a."emailVerified" AS verified,
    EXISTS(SELECT FROM core.users u WHERE u.auth_subject=a.id::text AND u.email_verified) AS bound FROM neon_auth."user" a WHERE a.email='clara@rehearsal.test'`);
  assert.deepEqual(account, { verified: true, bound: true });
  assert.equal((await find('clara@rehearsal.test'))?.status, 'active');
  assert.equal((await api(`invites/${token}/accept`, { password: 'senha-forte', confirmation: 'senha-forte' }, null)).body.error, 'used');
  assert.equal((await api(`invites/${'x'.repeat(43)}`, undefined, null)).body.error, 'invalid_link');

  // The workspace now opens for her through the ordinary session binding.
  const [session] = await owner<{ roles: string[] }>(`SELECT roles FROM public.reporter_session_context($1,$2,'Clara',NULL,true,$3)`,
    [account && passwords.get('clara@rehearsal.test')?.id, 'clara@rehearsal.test', PORTAL]);
  assert.deepEqual(session.roles, ['editor']);
});

test('an e-mail that already has an account signs in with its own password', async () => {
  const [row] = await owner<{ id: string }>(`INSERT INTO neon_auth."user"(name,email) VALUES('Rafael','rafael@rehearsal.test') RETURNING id::text`);
  passwords.set('rafael@rehearsal.test', { id: row.id, password: 'senha-antiga' });
  const created = await api<{ token: string }>('platform/invites', { name: 'Rafael Dias', email: 'rafael@rehearsal.test', role: 'approver', workspaceId: PORTAL });
  const preview = await api<{ hasAccount: boolean }>(`invites/${created.body.token}`, undefined, null);
  assert.equal(preview.body.hasAccount, true);
  const wrong = await api(`invites/${created.body.token}/accept`, { password: 'senha-errada', confirmation: 'senha-errada' }, null);
  assert.deepEqual([wrong.status, wrong.body.error], [401, 'wrong_password']);
  const right = await api(`invites/${created.body.token}/accept`, { password: 'senha-antiga', confirmation: 'senha-antiga' }, null);
  assert.equal(right.status, 200);
  assert.equal((await find('rafael@rehearsal.test'))?.status, 'active');
});

test('a self sign-up waits as pending until the operator releases it', async () => {
  const [row] = await owner<{ id: string }>(`INSERT INTO neon_auth."user"(name,email) VALUES('Beatriz Almeida','beatriz@rehearsal.test') RETURNING id::text`);
  const pending = await find('beatriz@rehearsal.test');
  assert.deepEqual([pending?.id, pending?.status], [`auth:${row.id}`, 'pending']);
  const approved = await api<Person>(`platform/people/auth:${row.id}/approve`, { roles: ['approver', 'editor'] });
  assert.equal(approved.status, 200);
  assert.deepEqual([approved.body.status, approved.body.roles], ['active', ['editor', 'approver']]);
  const [account] = await owner<{ verified: boolean }>(`SELECT "emailVerified" AS verified FROM neon_auth."user" WHERE id=$1`, [row.id]);
  assert.equal(account.verified, true);
  assert.equal((await api(`platform/people/auth:${row.id}/approve`, { roles: ['editor'] })).body.error, 'invalid_state');
});

test('roles change, suspension ends workspace access at once, and the operator never acts on themself', async () => {
  const editor = await find(EDITOR.email);
  assert.ok(editor);
  const changed = await api<Person>(`platform/people/${editor.id}/roles`, { roles: ['admin', 'creative_reviewer'] });
  assert.deepEqual(changed.body.roles, ['creative_reviewer', 'admin']);
  assert.equal((await api(`platform/people/${editor.id}/roles`, { roles: [] })).body.error, 'no_roles');
  assert.equal((await api<Person>(`platform/people/${editor.id}/suspend`, {})).body.status, 'suspended');
  const context = await owner(`SELECT * FROM public.reporter_session_context($1,$2,'Editora',NULL,true,$3)`, [EDITOR.subject, EDITOR.email, PORTAL]);
  assert.equal(context.length, 0, 'a suspended person gets no workspace');
  const restored = await api<{ person: Person; invite?: unknown }>(`platform/people/${editor.id}/restore`, {});
  assert.deepEqual([restored.body.person.status, restored.body.invite], ['active', undefined]);
  const operator = await find(OPERATOR.email);
  assert.equal((await api(`platform/people/${operator?.id}/suspend`, {})).body.error, 'self');
  assert.equal((await api(`platform/people/${operator?.id}/roles`, { roles: ['editor'] })).body.error, 'self');
});

test('suspending an open link closes it; restoring someone who never signed in issues a new one', async () => {
  const created = await api<{ token: string; person: Person }>('platform/invites', { name: 'Tiago Rezende', email: 'tiago@rehearsal.test', role: 'editor', workspaceId: PORTAL });
  await api(`platform/people/${created.body.person.id}/suspend`, {});
  assert.equal((await api<{ state: string }>(`invites/${created.body.token}`, undefined, null)).body.state, 'revoked');
  const restored = await api<{ person: Person; invite: { token: string } }>(`platform/people/${created.body.person.id}/restore`, {});
  assert.equal(restored.body.person.status, 'invited');
  assert.equal((await api<{ state: string }>(`invites/${restored.body.invite.token}`, undefined, null)).body.state, 'open');
  const renewed = await api<{ token: string }>(`platform/people/${created.body.person.id}/renew-invite`, {});
  assert.equal((await api<{ state: string }>(`invites/${restored.body.invite.token}`, undefined, null)).body.state, 'revoked');
  assert.equal((await api<{ state: string }>(`invites/${renewed.body.token}`, undefined, null)).body.state, 'open');
  await owner(`UPDATE core.access_invites SET expires_at=now()-interval '1 minute' WHERE state='open'`);
  assert.equal((await api(`invites/${renewed.body.token}/accept`, { password: 'senha-forte', confirmation: 'senha-forte' }, null)).body.error, 'expired');
});

test('usage reads runs, productions and decisions per person, and the log lists every console write', async () => {
  const editor = await find(EDITOR.email);
  const at = new Date().toISOString();
  await owner(`INSERT INTO public.reporter_ed_productions(portal_id,production_id,doc,seq) VALUES($1,'prod-1',$2,1)`,
    [PORTAL, JSON.stringify({ id: 'prod-1', title: 'Pauta', createdAt: at, createdBy: editor?.id })]);
  await owner(`INSERT INTO public.reporter_ed_runs(portal_id,run_id,production_id,status,fold,seq,created_at) VALUES($1,'run-1','prod-1','completed',$2,1,now())`,
    [PORTAL, JSON.stringify({ run: { createdBy: editor?.id, model: { alias: 'openai/gpt-oss-120b' }, usage: { inputTokens: 1000000, outputTokens: 1000000 } } })]);
  await owner(`INSERT INTO public.reporter_ed_parts(portal_id,kind,part_id,production_id,doc,seq) VALUES($1,'decision','dec-1','prod-1',$2,1)`,
    [PORTAL, JSON.stringify({ decision: 'approved', by: editor?.id, at })]);
  const usage = await api<{ days: unknown[]; totals: { generations: number; productions: number; approvals: number; inputTokens: number; costUsd: number }; people: { personId: string; generations: number }[]; models: { model: string }[] }>('platform/usage?period=7');
  assert.equal(usage.status, 200);
  assert.equal(usage.body.days.length, 7);
  assert.deepEqual([usage.body.totals.generations, usage.body.totals.productions, usage.body.totals.approvals, usage.body.totals.inputTokens],
    [1, 1, 1, 1000000]);
  assert.ok(Math.abs(usage.body.totals.costUsd - 0.75) < 1e-9);
  assert.deepEqual(usage.body.people.map(person => [person.personId, person.generations]), [[editor?.id, 1]]);
  assert.deepEqual(usage.body.models.map(model => model.model), ['openai/gpt-oss-120b']);
  assert.equal((await api('platform/usage?period=7', undefined, EDITOR)).status, 403);

  const log = await api<{ items: { action: string; actor: { name: string } | null }[]; total: number }>('platform/log?limit=100');
  const actions = new Set(log.body.items.map(item => item.action));
  for (const action of ['invite.created', 'invite.accepted', 'access.approved', 'roles.changed', 'access.suspended', 'access.restored', 'invite.renewed']) {
    assert.ok(actions.has(action), `logged ${action}`);
  }
  assert.equal(log.body.items.find(item => item.action === 'invite.accepted')?.actor, undefined, 'the person defined the password themself');
});
