import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { AUDIT_ACTION_IDS, auditTypeOf } from '../../../domain/audit.ts';
import type { AuditResult } from '../../../domain/audit.ts';
import type { ActivityEvent } from '../../../domain/activity.ts';
import { PEOPLE } from '../../../fixtures/people.ts';
import type { AuditPage } from '../../../ports/audit.ts';
import type { ChangeNotice } from '../../../ports/common.ts';
import { createRuntime } from '../../../runtime/create-runtime.ts';
import type { Runtime } from '../../../runtime/runtime.ts';
import { manualClock, memoryStorage } from '../store/index.ts';
import { AUDIT_STORAGE_KEY, auditFromActivity } from './index.ts';

const NOW = '2026-10-07T15:00:00.000Z';

const opened: Runtime[] = [];

function open(options: Parameters<typeof createRuntime>[0] = {}): Runtime {
  const runtime = createRuntime({ storage: null, latency: false, adoptLiveRuns: false, clock: manualClock(NOW), ...options });
  opened.push(runtime);
  return runtime;
}

afterEach(() => {
  for (const runtime of opened.splice(0)) runtime.dispose();
});

async function page(runtime: Runtime, ...args: Parameters<Runtime['audit']['list']>): Promise<AuditPage> {
  const result = await runtime.audit.list(...args);
  assert.ok(result.ok, result.ok ? '' : result.refusal.message);
  return result.value;
}

describe('local audit: the trail', () => {
  it('merges the activity feed and about 60 seeded events, newest first, admins only', async () => {
    const runtime = open();
    const all = await page(runtime, {}, { size: 100 });
    const seeded = (await page(runtime, {}, { size: 100, page: 1 })).total;
    assert.ok(seeded > 100, `feed + seed (${seeded})`);
    const ids = new Set<string>();
    let previous = Infinity;
    for (const entry of all.items) {
      assert.ok(!ids.has(entry.id), `unique id ${entry.id}`);
      ids.add(entry.id);
      assert.ok(Date.parse(entry.at) <= previous, 'newest first');
      previous = Date.parse(entry.at);
      assert.ok(entry.title.length > 0);
      assert.equal(entry.type, auditTypeOf(entry.action));
    }
    const fromSeed = (await page(runtime, { search: 'aud-s-' }, { size: 100 })).total;
    assert.ok(fromSeed >= 50 && fromSeed <= 70, `about 60 seeded events (${fromSeed})`);
  });

  it('covers sign-ins, access denials and updates with their result', async () => {
    const runtime = open();
    const { items } = await page(runtime, {}, { size: 100, page: 1 });
    const everything = [...items, ...(await page(runtime, {}, { size: 100, page: 2 })).items];
    const actions = new Set(everything.map((entry) => entry.action));
    for (const action of ['auth.signed_in', 'auth.signed_out', 'access.denied', 'production.updated', 'source.updated', 'production.created', 'source.created', 'review.approved'] as const) {
      assert.ok(actions.has(action), action);
    }
    const results = new Set<AuditResult>(everything.map((entry) => entry.result));
    assert.deepEqual([...results].sort(), ['denied', 'failure', 'success']);
    const update = everything.find((entry) => entry.action === 'production.updated' && entry.changes?.some((change) => change.field === 'Título'));
    assert.ok(update?.changes?.[0].before && update.changes[0].after, 'before and after');
    assert.ok(everything.every((entry) => !entry.origin.ip || entry.origin.ip.includes('•••')), 'IPs are masked');
    assert.ok(everything.every((entry) => AUDIT_ACTION_IDS.includes(entry.action)));
  });

  it('filters by period, person, type, result and folded search; the strip ignores the result filter', async () => {
    const runtime = open();
    const all = await page(runtime);
    const denied = await page(runtime, { results: ['denied'] });
    assert.ok(denied.total > 0 && denied.items.every((entry) => entry.result === 'denied'));
    assert.deepEqual(denied.metrics, all.metrics, 'metrics stay a breakdown');
    assert.equal(all.metrics.denied, denied.total);

    const pedro = await page(runtime, { actorIds: [PEOPLE.pedro] });
    assert.ok(pedro.total > 0 && pedro.items.every((entry) => entry.actorId === PEOPLE.pedro));

    const sessions = await page(runtime, { types: ['session'] });
    assert.ok(sessions.items.every((entry) => entry.action.startsWith('auth.')));

    const folded = await page(runtime, { search: 'aprovacao registrada' });
    assert.ok(folded.total > 0 && folded.items.every((entry) => entry.title === 'Aprovação registrada'));

    const lastDay = await page(runtime, { from: '2026-10-06T15:00:00.000Z', to: NOW });
    assert.ok(lastDay.total > 0 && lastDay.total < all.total);
    assert.ok(lastDay.items.every((entry) => entry.at >= '2026-10-06T15:00:00.000Z'));

    const oldest = await page(runtime, { sort: 'oldest' });
    assert.ok(oldest.items[0].at <= oldest.items[1].at);
    assert.equal(oldest.since, oldest.items[0].at);

    assert.ok(all.people.some((person) => person.id === PEOPLE.joao));
    assert.deepEqual(
      all.people.map((person) => person.name),
      [...all.people.map((person) => person.name)].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    );
  });

  it('pages like the other lists (clamped page, total and page count)', async () => {
    const runtime = open();
    const first = await page(runtime, {}, { size: 25 });
    assert.equal(first.items.length, 25);
    assert.equal(first.pageCount, Math.ceil(first.total / 25));
    const beyond = await page(runtime, {}, { size: 25, page: 999 });
    assert.equal(beyond.page, first.pageCount);
  });

  it('opens one entry by id', async () => {
    const runtime = open();
    const [entry] = (await page(runtime)).items;
    const found = await runtime.audit.get(entry.id);
    assert.ok(found.ok && found.value.id === entry.id);
    const missing = await runtime.audit.get('aud-inexistente');
    assert.equal(!missing.ok && missing.refusal.code, 'not_found');
  });

  it('starts empty in an empty workspace', async () => {
    const runtime = open({ empty: true });
    const empty = await page(runtime);
    assert.equal(empty.total, 0);
    assert.equal(empty.since, undefined);
  });
});

describe('local audit: live entries', () => {
  it('refuses non-admins with `restricted`, audits the denial once per window and logs the switch', async () => {
    const runtime = open();
    const switched = await runtime.session.actAs?.(PEOPLE.pedro);
    assert.ok(switched?.ok);
    const refused = await runtime.audit.list();
    assert.equal(!refused.ok && refused.refusal.code, 'restricted');
    await runtime.audit.list();
    const lookup = await runtime.audit.get('aud-s-0001');
    assert.equal(!lookup.ok && lookup.refusal.code, 'restricted');

    await runtime.session.actAs?.(PEOPLE.joao);
    const recent = await page(runtime, { from: NOW });
    const denials = recent.items.filter((entry) => entry.action === 'access.denied');
    assert.equal(denials.length, 1, 'repeats inside the window count once');
    assert.equal(denials[0].actorId, PEOPLE.pedro);
    assert.equal(denials[0].target?.label, 'Logs');
    assert.equal(denials[0].result, 'denied');
    const signIns = recent.items.filter((entry) => entry.action === 'auth.signed_in').map((entry) => entry.actorId);
    assert.deepEqual(signIns.sort(), [PEOPLE.joao, PEOPLE.pedro].sort());
  });

  it('records renames with the field before and after', async () => {
    const runtime = open();
    const before = await runtime.queries.get('prod-lume');
    assert.ok(before.ok);
    const renamed = await runtime.commands.rename('prod-lume', 'Lume Acessórios chega a 64 lojas na Europa');
    assert.ok(renamed.ok);
    const { items } = await page(runtime, { from: NOW, types: ['production'] });
    const update = items.find((entry) => entry.action === 'production.updated' && entry.id.startsWith('aud-l-'));
    assert.ok(update);
    assert.equal(update.actorId, PEOPLE.joao);
    assert.deepEqual(update.changes, [{ field: 'Título', before: before.value.title, after: 'Lume Acessórios chega a 64 lojas na Europa' }]);
    assert.equal(update.productionTitle, 'Lume Acessórios chega a 64 lojas na Europa');
  });

  it('records a new size of the pauta as "Tamanho do artigo"', async () => {
    const runtime = open();
    const before = await runtime.queries.get('prod-lume');
    assert.ok(before.ok);
    assert.equal(before.value.brief.size, 'standard');
    const saved = await runtime.commands.updateBrief('prod-lume', { sections: 2, size: 'short', angle: before.value.brief.angle }, before.value.brief.revision);
    assert.ok(saved.ok, saved.ok ? '' : saved.refusal.message);
    const { items } = await page(runtime, { from: NOW, types: ['production'] });
    const update = items.find((entry) => entry.action === 'production.updated' && entry.id.startsWith('aud-l-'));
    assert.deepEqual(update?.changes, [{ field: 'Tamanho do artigo', before: 'Padrão · 2 laudas', after: 'Curto · 1 lauda' }]);
  });

  it('⌘K › Simulação: the next read fails as "Log indisponível", then the trail answers again', async () => {
    const runtime = open();
    const notices: ChangeNotice[] = [];
    const off = runtime.subscribe((notice) => notices.push(notice));
    runtime.audit.simulateOutage?.();
    assert.ok(notices.some((notice) => notice.scope === 'audit'), 'screens refetch at once');
    const failed = await runtime.audit.list();
    assert.equal(!failed.ok && failed.refusal.code, 'unavailable');
    const retried = await runtime.audit.list();
    assert.ok(retried.ok);
    off();
  });

  it('keeps live entries in this browser until the workspace is reset', async () => {
    const storage = memoryStorage();
    const first = open({ storage, assets: 'memory' });
    await first.commands.rename('prod-lume', 'Lume na Europa');
    first.dispose();
    assert.ok(storage.getItem(AUDIT_STORAGE_KEY));

    const reopened = open({ storage, assets: 'memory' });
    const kept = await page(reopened, { search: 'Lume na Europa', types: ['production'] });
    assert.ok(kept.items.some((entry) => entry.action === 'production.updated'), 'survives a reload');
    reopened.dispose();

    const reset = open({ storage, assets: 'memory', reset: true });
    const after = await page(reset, { from: NOW, types: ['production'] });
    assert.ok(!after.items.some((entry) => entry.id.startsWith('aud-l-')), 'a reset starts the live trail again');
  });
});

describe('local audit: two tabs of one browser', () => {
  it('merge their live entries instead of overwriting each other', async () => {
    const storage = memoryStorage();
    const first = open({ storage, assets: 'memory' });
    const second = open({ storage, assets: 'memory' });
    await first.commands.rename('prod-lume', 'Lume, aba 1');
    await second.commands.rename('prod-aurora', 'Aurora, aba 2');
    await first.commands.rename('prod-lume', 'Lume, aba 1 de novo');
    const stored = JSON.parse(storage.getItem(AUDIT_STORAGE_KEY) ?? '{}') as { events: { id: string; action: string }[] };
    const updates = stored.events.filter((event) => event.action === 'production.updated');
    assert.equal(updates.length, 3);
    assert.equal(new Set(updates.map((event) => event.id)).size, 3, 'ids stay unique across tabs');
  });
});

describe('auditFromActivity', () => {
  const base = { id: 'act-1', workspaceId: 'ws', at: NOW, actorId: PEOPLE.joao } as const;
  const none = { pieceKind: () => undefined };

  it('maps CRUD, generation results, review steps and exports; skips work in progress', () => {
    const created = auditFromActivity({ ...base, type: 'source.added', productionId: 'prod-1', subject: { kind: 'source-version', sourceId: 'src-1', sourceVersion: 1, hash: 'h' }, data: { title: 'Entrevista' } }, none);
    assert.equal(created?.action, 'source.created');
    assert.equal(created?.target?.label, 'Entrevista');
    assert.equal(created?.activityId, 'act-1');

    const failed = auditFromActivity({ ...base, type: 'run.failed', productionId: 'prod-1', data: { runKind: 'carousel.generate', error: 'Falha simulada.' } }, none);
    assert.equal(failed?.action, 'carousel.generated');
    assert.equal(failed?.result, 'failure');
    assert.equal(failed?.reason, 'Falha simulada.');

    const approved = auditFromActivity(
      { ...base, type: 'decision.recorded', productionId: 'prod-1', subject: { kind: 'version', pieceId: 'piece-1', versionId: 'ver-4', number: 4, hash: 'h' }, data: { decision: 'approved' } },
      { pieceKind: () => 'article' },
    );
    assert.equal(approved?.action, 'review.approved');
    assert.equal(approved?.target?.label, 'Artigo v4');

    const version = { kind: 'version' as const, pieceId: 'piece-1', versionId: 'ver-2', number: 2, hash: 'h' };
    const sent = auditFromActivity(
      { ...base, type: 'review.requested', productionId: 'prod-1', subject: version, data: { piece: 'article', number: 2, assigneeId: 'person-pedro', assigneeName: 'Pedro', dueOn: '2026-10-08' } },
      { pieceKind: () => 'article' },
    );
    assert.equal(sent?.action, 'review.requested');
    assert.deepEqual(sent?.changes, [
      { field: 'Quem aprova', before: '—', after: 'Pedro' },
      { field: 'Para quando', before: '—', after: '08/10/2026' },
    ]);
    const withdrawn = auditFromActivity({ ...base, type: 'review.withdrawn', productionId: 'prod-1', subject: version, data: { piece: 'article', number: 2 } }, { pieceKind: () => 'article' });
    assert.equal(withdrawn?.action, 'review.withdrawn');
    assert.equal(withdrawn?.target?.label, 'Artigo v2');

    const edited = auditFromActivity({ ...base, type: 'version.created', productionId: 'prod-1', data: { piece: 'Carrossel', number: 2, origin: 'edit' } }, none);
    assert.equal(edited?.action, 'carousel.updated');

    const skipped: ActivityEvent['type'][] = ['run.started', 'suggestion.applied', 'suggestion.discarded', 'feedback.recorded'];
    for (const type of skipped) assert.equal(auditFromActivity({ ...base, type, productionId: 'prod-1', data: { runKind: 'article.generate' } }, none), undefined, type);
    assert.equal(auditFromActivity({ ...base, type: 'version.created', data: { piece: 'article', origin: 'generation', number: 1 } }, none), undefined, 'AI versions come with the run');
    assert.equal(auditFromActivity({ ...base, type: 'run.completed', data: { runKind: 'article.assist' } }, none), undefined, 'assistant runs are not records');
  });
});
