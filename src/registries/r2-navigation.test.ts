import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeNavItem, menuFor, navigationFor } from './navigation.ts';
import { CURRENT_RELEASE, isReleased } from './release.ts';

import { HARD_NEWS_DEMO, R2_NAVIGATION, isR2DemoPath } from '../ui/r2-preview.ts';

const preview = R2_NAVIGATION;
test('the R1 build shows the Hard News demonstration in the R2 menu without releasing R2', () => {
  const sections = menuFor(undefined, { roles: ['admin'] }, preview);
  const of = (id: string) => sections.find((section) => section.group.id === id)?.items.map((item) => item.id);
  assert.deepEqual(of('main'), ['overview', 'news', 'productions']);
  assert.deepEqual(of('library'), ['templates', 'images', 'quotes', 'archive']);
  assert.deepEqual(of('settings'), ['editorial-map', 'writing-guide', 'integrations']);
  assert.ok(sections.flatMap((section) => section.items).filter((item) => ['news', 'images', 'quotes', 'archive'].includes(item.id)).every((item) => !item.soon));
  assert.equal(HARD_NEWS_DEMO, true);
  assert.equal(CURRENT_RELEASE, 'R1');
  assert.equal(isReleased('R2'), false);
  assert.ok(menuFor(undefined, { roles: ['admin'] }).find((section) => section.group.id === 'soon')?.items.some((item) => item.id === 'news'));
  assert.equal(activeNavItem('/news/sources', undefined, preview)?.id, 'news');
  assert.equal(activeNavItem('/admin/integrations/webhooks', undefined, preview)?.label, 'Integrações');
});

test('the demo screens carry "Demo"; Modelos and the R1 stages do not', () => {
  for (const path of ['/news', '/news/sources', '/images', '/images/own:img-processing', '/quotes', '/archive', '/settings/editorial-map', '/settings/writing-guide', '/admin/integrations', '/admin/integrations/cms']) {
    assert.equal(isR2DemoPath(path), true, path);
  }
  // Apuração answers 404 in an R1 build, without the badge.
  for (const path of ['/', '/productions', '/library/templates', '/productions/p1/article', '/productions/p1/research']) assert.equal(isR2DemoPath(path), false, path);
  for (const path of ['/images', '/images/i1', '/quotes']) assert.equal(isR2DemoPath(path, true), false, path);
  assert.equal(isR2DemoPath('/news', true), true);
  // F2.1: with the server's news, the radar, its sources and the news-source apps are real.
  for (const path of ['/news', '/news/sources', '/admin/integrations/google-alerts', '/admin/integrations/rss-app']) {
    assert.equal(isR2DemoPath(path, true), true, path);
    assert.equal(isR2DemoPath(path, true, true), false, path);
  }
  for (const path of ['/admin/integrations', '/admin/integrations/slack', '/archive']) assert.equal(isR2DemoPath(path, true, true), true, path);
  for (const path of ['/settings/editorial-map', '/settings/writing-guide']) {
    assert.equal(isR2DemoPath(path, true, false, true), false, path);
    assert.equal(isR2DemoPath(path, true, false, false), true, path);
  }
});

test('news and editorial settings capabilities independently remove their demo badges', () => {
  for (const news of [false, true]) for (const editorialSettings of [false, true]) {
    const capabilities = `news=${news}, editorialSettings=${editorialSettings}`;
    for (const path of ['/news', '/news/sources', '/admin/integrations/google-alerts', '/admin/integrations/rss-app']) {
      assert.equal(isR2DemoPath(path, true, news, editorialSettings), !news, `${path}: ${capabilities}`);
    }
    for (const path of ['/settings/editorial-map', '/settings/writing-guide']) {
      assert.equal(isR2DemoPath(path, true, news, editorialSettings), !editorialSettings, `${path}: ${capabilities}`);
    }
    for (const path of ['/admin/integrations', '/admin/integrations/cms', '/archive']) {
      assert.equal(isR2DemoPath(path, true, news, editorialSettings), true, `${path}: ${capabilities}`);
    }
    assert.equal(isR2DemoPath('/images', false, news, editorialSettings), true, capabilities);
    assert.equal(isR2DemoPath('/images', true, news, editorialSettings), false, capabilities);
  }
});

test('R2 sidebar and command palette preserve role restrictions and hidden banners', () => {
  const editor = menuFor(undefined, { roles: ['editor'] }, preview).flatMap((section) => section.items);
  assert.ok(!editor.some((item) => ['integrations', 'prompts', 'audit', 'banners'].includes(item.id)));
  const commands = navigationFor(undefined, { roles: ['admin'] }, preview).flatMap((section) => section.items);
  assert.ok(['news', 'images', 'quotes', 'archive', 'editorial-map', 'writing-guide', 'integrations'].every((id) => commands.some((item) => item.id === id)));
  assert.ok(!commands.some((item) => item.id === 'banners'));
});
