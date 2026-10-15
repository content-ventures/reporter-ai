import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeNavItem, menuFor, navigationFor } from './navigation.ts';
import { CURRENT_RELEASE, isReleased } from './release.ts';

import { R2_NAVIGATION, R2_UI_PREVIEW } from '../ui/r2-preview.ts';

const preview = R2_NAVIGATION;
test('published UI demonstration adds R2 destinations after the R1 base without releasing backend features', () => {
  const main = menuFor(undefined, { roles: ['admin'] }, preview)[0].items;
  assert.deepEqual(main.map(item => item.id), ['overview', 'productions', 'templates', 'news', 'images', 'quotes', 'archive', 'editorial-map', 'writing-guide', 'integrations']);
  assert.ok(main.every(item => !item.soon));
  assert.equal(R2_UI_PREVIEW, true);
  assert.equal(CURRENT_RELEASE, 'R1');
  assert.equal(isReleased('R2'), false);
  assert.ok(menuFor(undefined, { roles: ['admin'] }).find(section => section.group.id === 'soon')?.items.some(item => item.id === 'news'));
  assert.equal(activeNavItem('/news/draft', undefined, preview)?.id, 'news');
  assert.equal(activeNavItem('/admin/integrations', undefined, preview)?.label, 'CMS do portal');
});
test('R2 sidebar and command palette preserve role restrictions and hidden banners', () => {
  const editor = menuFor(undefined, { roles: ['editor'] }, preview).flatMap(section => section.items);
  assert.ok(!editor.some(item => ['integrations', 'prompts', 'audit', 'banners'].includes(item.id)));
  const commands = navigationFor(undefined, { roles: ['admin'] }, preview).flatMap(section => section.items);
  assert.ok(['news', 'images', 'quotes', 'archive', 'editorial-map', 'writing-guide', 'integrations'].every(id => commands.some(item => item.id === id)));
  assert.ok(!commands.some(item => item.id === 'banners'));
});
