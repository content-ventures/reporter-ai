import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Role } from '../domain/index.ts';
import { activeNavItem, MENU_GROUPS, menuFor, NAV_ITEMS, navigationFor, RELEASES, releaseIndex } from './index.ts';
import type { MenuSection, ReleaseId } from './index.ts';

const R1: ReleaseId = 'R1';
const EVERYONE: readonly Role[] = ['editor', 'approver', 'creative_reviewer', 'admin'];

/** "Label /href" for an item that navigates, "Label · Em breve" for one that does not. */
function outline(menu: readonly MenuSection[]): [string, string[]][] {
  return menu.map((section) => [
    section.group.id,
    section.items.map((item) => (item.soon ? `${item.label} · Em breve` : `${item.label} ${item.href}`)),
  ]);
}

const soonIds = (menu: readonly MenuSection[]) => menu.find((section) => section.group.id === 'soon')?.items.map((item) => item.id) ?? [];

describe('menu (D9): what works today on top, "Em breve" as one collapsed group', () => {
  test('João (editor + admin): Início, Produções, Aprovações, Modelos, Logs; 17 later items under "Em breve"; Novidades', () => {
    const menu = menuFor(R1, { roles: ['editor', 'admin'] });
    assert.deepEqual(outline(menu), [
      ['main', ['Início /', 'Produções /productions', 'Aprovações /approvals', 'Modelos /library/templates', 'Logs /admin/audit']],
      [
        'soon',
        [
          'Notícias · Em breve',
          'Acervo · Em breve',
          'Citações · Em breve',
          'Imagens · Em breve',
          'Mapa editorial · Em breve',
          'Guia de escrita · Em breve',
          'Integrações · Em breve',
          'Oportunidades · Em breve',
          'Mídia · Em breve',
          'Canais · Em breve',
          'Perfis · Em breve',
          'Newsletter · Em breve',
          'Desempenho · Em breve',
          'Lotes · Em breve',
          'Eventos · Em breve',
          'Prompts · Em breve',
          'Workspaces · Em breve',
        ],
      ],
      ['utility', ['Novidades /whats-new']],
    ]);
    assert.equal(soonIds(menu).length, 17);
  });

  test('the main section has no label; "Em breve" folds and starts closed; Novidades sits at the bottom', () => {
    const [main, soon, utility] = menuFor(R1, { roles: EVERYONE });
    assert.equal(main?.group, MENU_GROUPS.main);
    assert.equal(main?.group.label, undefined);
    assert.equal(main?.group.collapsible, false);
    assert.deepEqual(
      { id: soon?.group.id, label: soon?.group.label, collapsible: soon?.group.collapsible, defaultOpen: soon?.group.defaultOpen },
      { id: 'soon', label: 'Em breve', collapsible: true, defaultOpen: false },
    );
    assert.equal(utility?.group.placement, 'utility');
    assert.equal(menuFor(R1, { roles: EVERYONE }).length, 3);
  });

  test('"Em breve" follows the release (registry order within one), and every item keeps its reason, never a link', () => {
    const soon = menuFor(R1, { roles: EVERYONE }).find((section) => section.group.id === 'soon')?.items ?? [];
    const releases = soon.map((item) => releaseIndex(item.since));
    assert.deepEqual(releases, [...releases].sort((a, b) => a - b));
    for (const item of soon) {
      assert.ok(item.soon && item.soon.length > 0, `${item.id} says what it will do and when`);
      assert.ok(releaseIndex(item.since) > releaseIndex(R1), `${item.id} ships after R1`);
    }
  });

  test('Aprovações is only for whoever decides at a gate (approver, creative reviewer, admin) and carries the queue count', () => {
    const approvals = NAV_ITEMS.find((item) => item.id === 'approvals');
    assert.equal(approvals?.badge, 'awaiting-approval');
    assert.ok(!NAV_ITEMS.some((item) => item.id !== 'approvals' && item.badge), 'no other item carries a count ("Produções 2" is gone)');
    const main = (roles: readonly Role[]) => menuFor(R1, { roles })[0]?.items.map((item) => item.label);
    assert.deepEqual(main(['editor']), ['Início', 'Produções', 'Modelos']);
    assert.deepEqual(main(['approver']), ['Início', 'Produções', 'Aprovações', 'Modelos']);
    assert.deepEqual(main(['editor', 'creative_reviewer']), ['Início', 'Produções', 'Aprovações', 'Modelos']);
    assert.deepEqual(main(['editor', 'admin']), ['Início', 'Produções', 'Aprovações', 'Modelos', 'Logs']);
    assert.deepEqual(menuFor(R1)[0]?.items.map((item) => item.label), ['Início', 'Produções', 'Modelos'], 'unknown viewer: role items stay hidden');
  });

  test('non-admins never see admin items, not even under "Em breve"', () => {
    const soon = soonIds(menuFor(R1, { roles: ['editor'] }));
    assert.equal(soon.length, 14);
    for (const id of ['integrations', 'prompts', 'workspaces']) assert.ok(!soon.includes(id), `${id} stays hidden`);
  });

  test('⌘K "Ir para" lists released items only: Início, Produções, Aprovações, Modelos, Logs, Novidades', () => {
    const labels = (roles: readonly Role[]) => navigationFor(R1, { roles }).flatMap((section) => section.items.map((item) => item.label));
    assert.deepEqual(labels(['editor', 'admin']), ['Início', 'Produções', 'Aprovações', 'Modelos', 'Logs', 'Novidades']);
    assert.deepEqual(labels(['editor']), ['Início', 'Produções', 'Modelos', 'Novidades']);
  });

  test('shipping a release moves its items from "Em breve" to the top, in registry order', () => {
    const r2 = menuFor('R2', { roles: EVERYONE });
    assert.deepEqual(r2[0]?.items.map((item) => item.id), [
      'overview',
      'productions',
      'approvals',
      'news',
      'templates',
      'archive',
      'quotes',
      'images',
      'editorial-map',
      'writing-guide',
      'audit',
      'integrations',
    ]);
    assert.deepEqual(soonIds(r2), ['opportunities', 'media', 'channels', 'profiles', 'newsletter', 'performance', 'batches', 'events', 'prompts', 'workspaces']);
    const last: ReleaseId = RELEASES[RELEASES.length - 1] as ReleaseId;
    assert.deepEqual(soonIds(menuFor(last, { roles: EVERYONE })), [], 'nothing left "Em breve" once R7 ships');
  });

  test('the active item: Início only on "/", Aprovações on its tabs, Produções inside a production', () => {
    assert.equal(activeNavItem('/')?.label, 'Início');
    assert.equal(activeNavItem('/approvals')?.id, 'approvals');
    assert.equal(activeNavItem('/approvals?aba=aprovadas')?.id, 'approvals');
    assert.equal(activeNavItem('/productions/prod-aurora/article/review')?.id, 'productions');
  });
});
