import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appChecks,
  appDef,
  CATALOG,
  catalogCounts,
  catalogGroups,
  chatChecks,
  cmsChecks,
  deliveryOutcome,
  endpointProblem,
  failureStreak,
  maskSecret,
  matchesQuery,
  newSecret,
  overall,
  rebase,
  setupDefaults,
  setupSteps,
  statusOf,
  successRate,
  webhooksState,
} from './integrations-model.ts';
import type { AppRecord, CatalogEntry, WebhookDelivery } from './integrations-model.ts';
import { seedIntegrations } from './integrations-seed.ts';

const NOW = Date.parse('2026-10-17T15:00:00.000Z');

const entries = (live: string[], failing: string[] = []): CatalogEntry[] =>
  CATALOG.map((def) => ({ ...def, status: statusOf(def, failing.includes(def.id) ? 'failing' : live.includes(def.id) ? 'connected' : 'disconnected') }));

describe('catalog', () => {
  it('lists between 12 and 18 apps with unique ids', () => {
    assert.ok(CATALOG.length >= 12 && CATALOG.length <= 18);
    assert.equal(new Set(CATALOG.map((app) => app.id)).size, CATALOG.length);
  });

  it('gives every company its hotlinked logo, and none to generic entries', () => {
    for (const app of CATALOG) {
      if (app.id === 'email' || app.id === 'webhooks') assert.equal(app.logo, undefined, app.id);
      else assert.match(app.logo ?? '', /^https:\/\/(cdn\.simpleicons\.org\/[a-z]+|www\.google\.com\/s2\/favicons\?domain=[a-z.]+&sz=128)$/, app.id);
    }
  });

  it('marks later releases as soon, whatever the connection says', () => {
    const plaud = appDef('plaud');
    assert.ok(plaud);
    assert.equal(statusOf(plaud, 'connected'), 'soon');
    assert.equal(statusOf({}, undefined), 'available');
    assert.equal(statusOf({}, 'failing'), 'failing');
  });

  it('counts connected (with errors) and available apart from the later ones', () => {
    const counts = catalogCounts(entries(['wordpress', 'slack'], ['webhooks']));
    assert.equal(counts.all, CATALOG.length);
    assert.equal(counts.connected, 3);
    assert.equal(counts.available, CATALOG.filter((app) => !app.since).length - 3);
  });

  it('groups by category in order, failing first, and drops empty groups', () => {
    const groups = catalogGroups(entries(['webhooks'], ['zapier']), 'all', '');
    assert.equal(groups[0]?.id, 'publish');
    const automation = groups.find((group) => group.id === 'automation');
    assert.deepEqual(automation?.apps.map((app) => app.id), ['zapier', 'webhooks']);
    assert.equal(automation?.live, 2);

    const connected = catalogGroups(entries(['slack']), 'connected', '');
    assert.deepEqual(connected.map((group) => group.id), ['chat']);
  });

  it('searches name, line and category without accents', () => {
    const slack = appDef('slack');
    assert.ok(slack);
    assert.ok(matchesQuery(slack, 'comunicacao'));
    assert.ok(matchesQuery(slack, 'AVISOS canais'));
    assert.ok(!matchesQuery(slack, 'fotos'));
    assert.deepEqual(catalogGroups(entries([]), 'all', 'unsplash').flatMap((group) => group.apps.map((app) => app.id)), ['unsplash']);
  });
});

describe('webhooks', () => {
  it('accepts only complete https addresses that are not taken', () => {
    assert.equal(endpointProblem(''), 'Cole o endereço que vai receber os eventos.');
    assert.equal(endpointProblem('painel.exemplo/hook'), 'Cole o endereço completo, com https://.');
    assert.equal(endpointProblem('http://painel.exemplo/hook'), 'Use um endereço https://.');
    assert.equal(endpointProblem('https://painel.exemplo/hook/', ['https://painel.exemplo/hook']), 'Esse endereço já recebe eventos.');
    assert.equal(endpointProblem('https://painel.exemplo/hook'), undefined);
  });

  it('creates and masks signing secrets', () => {
    const secret = newSecret(() => 0);
    assert.match(secret, /^whsec_a{24}$/);
    assert.equal(maskSecret('whsec_k3p9tq7vm2xw8rn4bd6hy5ca'), 'whsec_••••••••y5ca');
    assert.notEqual(newSecret(), newSecret());
  });

  it('reads outcomes, success rate and the failure streak', () => {
    assert.equal(deliveryOutcome(204), 'ok');
    assert.equal(deliveryOutcome(410), 'refused');
    assert.equal(deliveryOutcome(500), 'failed');
    assert.equal(deliveryOutcome(0), 'failed');
    const at = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
    const deliveries: WebhookDelivery[] = [
      { id: '1', endpointId: 'a', event: 'cms.sent', status: 500, ms: 900, at: at(1), subject: '' },
      { id: '2', endpointId: 'a', event: 'cms.sent', status: 0, ms: 10000, at: at(2), subject: '' },
      { id: '3', endpointId: 'a', event: 'cms.sent', status: 200, ms: 120, at: at(3), subject: '' },
      { id: '4', endpointId: 'b', event: 'cms.sent', status: 500, ms: 900, at: at(4), subject: '' },
    ];
    assert.equal(failureStreak(deliveries, 'a'), 2);
    assert.equal(successRate(deliveries, 'a'), 1 / 3);
    assert.equal(successRate(deliveries, 'c'), undefined);
  });

  it('is connected with endpoints and failing when one fails', () => {
    const seed = seedIntegrations(NOW);
    assert.equal(webhooksState([]), 'disconnected');
    assert.equal(webhooksState(seed.endpoints), 'failing');
    assert.equal(webhooksState(seed.endpoints.map((endpoint) => ({ ...endpoint, state: 'active' as const }))), 'connected');
    assert.equal(failureStreak(seed.deliveries, 'wh-pautas'), 3);
  });
});

describe('health', () => {
  it('warns about chat alerts without a channel', () => {
    const record: AppRecord = { state: 'connected', account: 'Portal', rules: [
      { event: 'news.priority_high', on: true, channel: '#pauta' },
      { event: 'cms.failed', on: true, channel: '' },
      { event: 'cms.sent', on: false, channel: '' },
    ] };
    const checks = chatChecks(record);
    assert.deepEqual(checks.map((check) => check.state), ['ok', 'warn']);
    assert.equal(checks[1]?.detail, '1 aviso sem canal.');
    assert.equal(overall(checks), 'warn');
  });

  it('reads the WordPress connection, authors, categories and failed sends', () => {
    const checks = cmsChecks({ status: 'connected', host: 'portal.exemplo', unmappedPeople: ['Marina Lopes'], unmappedTopics: ['Eventos', 'Pesca'], failedSends: 0 });
    assert.deepEqual(checks.map((check) => check.state), ['ok', 'warn', 'warn', 'ok']);
    assert.equal(checks[1]?.detail, 'Marina Lopes assina como Redação.');
    assert.equal(checks[2]?.detail, '2 temas sem categoria.');
    assert.equal(overall(cmsChecks({ status: 'failing', host: 'x', unmappedPeople: [], unmappedTopics: [], failedSends: 1 })), 'error');
  });

  it('warns when a photo bank is close to its limit', () => {
    const unsplash = appDef('unsplash');
    assert.ok(unsplash);
    const near = appChecks(unsplash, { state: 'connected', usage: { used: 4200, limit: 5000, period: 'por hora' } });
    assert.equal(near[1]?.state, 'warn');
    const calm = appChecks(unsplash, { state: 'connected', usage: { used: 312, limit: 5000, period: 'por hora' } });
    assert.equal(calm[1]?.detail, '6% do limite por hora');
  });
});

describe('connect flow', () => {
  it('skips Conectar when there is nothing to connect', () => {
    const webhooks = appDef('webhooks');
    const slack = appDef('slack');
    assert.ok(webhooks && slack);
    assert.deepEqual(setupSteps(webhooks).map((step) => step.id), ['configure', 'test']);
    assert.deepEqual(setupSteps(slack).map((step) => step.id), ['connect', 'configure', 'test']);
  });

  it('starts chat alerts with a channel for every rule that is on', () => {
    const teams = appDef('teams');
    assert.ok(teams);
    const defaults = setupDefaults(teams);
    assert.ok(defaults.rules?.some((rule) => rule.on));
    assert.ok(defaults.rules?.every((rule) => !rule.on || rule.channel));
    assert.equal(chatChecks({ state: 'connected', ...defaults }).every((check) => check.state === 'ok'), true);
  });
});

describe('time', () => {
  it('moves every time by the time away', () => {
    const seed = seedIntegrations(NOW);
    const later = NOW + 26 * 60 * 60_000;
    const moved = rebase(seed, later);
    assert.equal(moved.savedAt, new Date(later).toISOString());
    assert.equal(Date.parse(moved.deliveries[0]?.at ?? '') - Date.parse(seed.deliveries[0]?.at ?? ''), 26 * 60 * 60_000);
    assert.equal(Date.parse(moved.apps.slack?.connectedAt ?? '') - Date.parse(seed.apps.slack?.connectedAt ?? ''), 26 * 60 * 60_000);
    assert.equal(rebase(seed, NOW - 1000), seed);
  });
});
