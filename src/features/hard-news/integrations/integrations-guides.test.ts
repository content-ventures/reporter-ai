import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiBase, connectionFrom, exampleFields, fieldProblem, fieldProblems, GUIDES, guideOf, stepHref, WEBHOOK_SPEC } from './integrations-guides.ts';
import { appDef, CATALOG } from './integrations-model.ts';

describe('connection guides', () => {
  it('cover every app that connects, with steps, an action and the API calls', () => {
    for (const app of CATALOG) {
      if (app.since || app.auth === 'none') continue;
      const guide = GUIDES[app.id];
      assert.ok(guide, app.id);
      assert.ok(guide.steps.length >= 2, app.id);
      assert.ok(guide.calls.length >= 1, app.id);
      assert.ok(guide.action, app.id);
      if (app.auth === 'oauth') assert.ok(guide.scopes?.length, `${app.id} lists its scopes`);
      else assert.ok(guide.fields.length, `${app.id} asks for a credential`);
    }
  });

  it('checks each kind of credential', () => {
    const wordpress = guideOf('wordpress');
    assert.ok(wordpress);
    const [site, user, password] = wordpress.fields;
    assert.ok(site && user && password);
    assert.equal(fieldProblem(site, ''), 'Preencha endereço do site.');
    assert.equal(fieldProblem(site, 'portal.exemplo'), 'Cole o endereço completo, com https://.');
    assert.equal(fieldProblem(site, 'http://portal.exemplo'), 'Use um endereço https://.');
    assert.equal(fieldProblem(password, 'abcd efgh'), 'A senha de aplicativo tem 24 letras e números.');
    assert.equal(fieldProblem(password, 'abcd EFGH 1234 ijkl MNOP 5678'), undefined);

    const zapier = guideOf('zapier')?.fields[0];
    assert.ok(zapier);
    assert.equal(fieldProblem(zapier, 'https://hooks.exemplo/catch/1'), 'Use o endereço de hooks.zapier.com.');
    assert.equal(fieldProblem(zapier, 'https://hooks.zapier.com/hooks/catch/123/abc'), undefined);

    const ghostKey = guideOf('ghost')?.fields.find((field) => field.id === 'secret');
    assert.ok(ghostKey);
    assert.equal(fieldProblem(ghostKey, 'semdoispontos'), 'Use a chave inteira, no formato id:segredo.');

    const sender = guideOf('email')?.fields[0];
    assert.ok(sender);
    assert.equal(fieldProblem(sender, 'redacao@'), 'Use um e-mail completo.');
    assert.deepEqual(Object.keys(fieldProblems(wordpress, { siteUrl: 'https://portal.exemplo' })), ['username', 'secret']);
  });

  it('links each step to the page of the site typed', () => {
    const wordpress = guideOf('wordpress');
    assert.ok(wordpress);
    const [create, password] = wordpress.steps;
    assert.ok(create && password);
    assert.equal(stepHref(create, {}), undefined);
    assert.equal(stepHref(password, { siteUrl: 'https://portal.exemplo/wp-admin/' }), 'https://portal.exemplo/wp-admin/profile.php#application-passwords-section');
    assert.equal(apiBase(wordpress, { siteUrl: 'https://portal.exemplo/' }), 'https://portal.exemplo/wp-json/wp/v2');
  });

  it('keeps the account and a description of the credential, never the secret', () => {
    const wordpress = appDef('wordpress');
    const unsplash = appDef('unsplash');
    const alerts = appDef('google-alerts');
    assert.ok(wordpress && unsplash && alerts);
    const site = connectionFrom(wordpress, GUIDES.wordpress!, { siteUrl: 'https://www.portal.exemplo/wp-admin', username: 'reporter-ia', secret: 'abcd EFGH 1234 ijkl MNOP 5678' });
    assert.equal(site.account, 'portal.exemplo');
    assert.equal(site.siteUrl, 'https://www.portal.exemplo');
    assert.equal(site.credential, 'Senha de aplicativo de reporter-ia');
    assert.ok(!JSON.stringify(site).includes('MNOP'));

    const key = connectionFrom(unsplash, GUIDES.unsplash!, { secret: 'kq81pZ0aLm2sX9a91f' });
    assert.equal(key.credential, 'Access Key ••••a91f');

    const feed = connectionFrom(alerts, GUIDES['google-alerts']!, { query: 'tilápia', feedUrl: 'https://www.google.com/alerts/feeds/1/2' });
    assert.equal(feed.account, 'Alerta “tilápia”');
    assert.deepEqual(feed.feeds, [{ query: 'tilápia', url: 'https://www.google.com/alerts/feeds/1/2' }]);
  });

  it('flattens the webhook example into readable fields', () => {
    const rows = exampleFields(WEBHOOK_SPEC.example);
    assert.deepEqual(rows.slice(0, 3).map((row) => row.field), ['id', 'event', 'created_at']);
    assert.ok(rows.some((row) => row.field === 'data.score' && row.example === '86'));
  });
});
