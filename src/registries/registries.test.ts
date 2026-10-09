import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { ARTICLE_CHECKS, CAROUSEL_CHECKS, RUN_KIND_LABELS } from '../domain/index.ts';
import type { RunKind, Source } from '../domain/index.ts';
import { RUN_KIND_OF } from '../ports/index.ts';
import {
  activeNavItem,
  arrivalOf,
  ARTICLE_RUN_NEXT,
  articleChecksFor,
  availableIn,
  CHANNELS,
  channelsFor,
  CHECKS,
  checksFor,
  COPILOT_TOOLS,
  copilotPresets,
  copilotToolsFor,
  CURRENT_RELEASE,
  DASHBOARD_WIDGETS,
  dashboardWidgetsFor,
  draftSizeInstructions,
  FLOWS,
  flowsFor,
  GATES,
  gatesFor,
  GENERATION_CHECKS,
  IMAGE_SOURCES,
  imageSourcesFor,
  isReleased,
  menuFor,
  NAV_GROUPS,
  NAV_ITEMS,
  NAV_REDIRECTS,
  navigationFor,
  PIECE_KINDS,
  pieceKindBySlug,
  pieceKindsFor,
  PRIMARY_ACTIONS,
  RECIPES,
  recipeFor,
  RELEASE_NAMES,
  RELEASES,
  releaseIndex,
  reservedAfter,
  SIZING_POLICIES,
  sizingPolicyFor,
  SOURCE_KINDS,
  sourceKindsFor,
} from './index.ts';
import type { IconKey, ReleaseId, Since } from './index.ts';

const R1: ReleaseId = 'R1';

function ids<T extends { id: string }>(entries: readonly T[]): string[] {
  return entries.map((entry) => entry.id);
}

function assertUnique(values: readonly string[], label: string): void {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

describe('release gating', () => {
  test('the build shows R1 and orders releases R0…R7', () => {
    assert.equal(CURRENT_RELEASE, 'R1');
    assert.deepEqual(RELEASES, ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']);
    assert.ok(releaseIndex('R0') < releaseIndex('R7'));
    assert.equal(isReleased('R0'), true);
    assert.equal(isReleased('R1'), true);
    assert.equal(isReleased('R2'), false);
    assert.equal(isReleased('R2', 'R2'), true);
  });

  test('availableIn and reservedAfter split entries by `since`', () => {
    const entries: (Since & { id: string })[] = [
      { id: 'a', since: 'R0' },
      { id: 'b', since: 'R1' },
      { id: 'c', since: 'R4' },
    ];
    assert.deepEqual(ids(availableIn(entries, R1)), ['a', 'b']);
    assert.deepEqual(ids(reservedAfter(entries, R1)), ['c']);
  });

  test('every registry visible in R1 contains only entries with since <= R1', () => {
    const registries: readonly (readonly Since[])[] = [
      NAV_GROUPS,
      NAV_ITEMS,
      SOURCE_KINDS,
      PIECE_KINDS,
      GATES,
      FLOWS,
      CHECKS,
      CHANNELS,
      RECIPES,
      COPILOT_TOOLS,
      DASHBOARD_WIDGETS,
    ];
    for (const registry of registries) {
      for (const entry of availableIn(registry, R1)) assert.ok(releaseIndex(entry.since) <= releaseIndex(R1));
      assert.ok(registry.some((entry) => !isReleased(entry.since, R1)) || registry === RECIPES, 'future plug points exist as data');
    }
  });
});

const EVERYONE = ['editor', 'approver', 'creative_reviewer', 'admin'] as const;

// The menu's shape (released items, "Em breve", utilities; roles) is tested in `navigation.test.ts`.
describe('navigation registry', () => {
  test('R1 menu: 23 items for an admin, 6 of them navigate (Início, Produções, Aprovações, Modelos, Logs, Novidades)', () => {
    const items = menuFor(R1, { roles: ['editor', 'admin'] }).flatMap((section) => section.items);
    assert.equal(items.length, 23);
    assert.deepEqual(
      items.filter((item) => !item.soon).map((item) => item.id),
      ['overview', 'productions', 'approvals', 'templates', 'audit', 'whats-new'],
    );
    assert.equal(menuFor(R1).at(-1)?.group.placement, 'utility');
    assert.equal(items.find((item) => item.id === 'whats-new')?.icon, 'Megaphone');
    assert.equal(activeNavItem('/admin/audit')?.label, 'Logs', 'the trail names the page for everyone');
  });

  test('"Em breve" says what the screen will do and when it arrives', () => {
    const plain = (text?: string) => text?.replace(/\u00a0/g, ' ');
    assert.equal(plain(arrivalOf('R2')), 'Chega na R2 · Hard News');
    for (const release of RELEASES) assert.ok(!arrivalOf(release).includes(' '), `the tip never breaks inside "${plain(arrivalOf(release))}"`);
    const items = menuFor(R1, { roles: EVERYONE }).flatMap((section) => section.items);
    for (const item of items) {
      if (isReleased(item.since, R1)) {
        assert.equal(item.soon, undefined, `${item.id} navigates in R1`);
        continue;
      }
      assert.ok(item.hint && item.hint.length <= 38, `${item.id}: the hint fits one line of the 240 px tip`);
      assert.equal(plain(item.soon), `${item.hint}. Chega na ${item.since} · ${RELEASE_NAMES[item.since]}`);
    }
    assert.equal(plain(items.find((item) => item.id === 'news')?.soon), 'Fila de notícias com triagem por IA. Chega na R2 · Hard News');
  });

  test('⌘K, the active item and the trail use only released items', () => {
    const released = navigationFor(R1, { roles: EVERYONE }).flatMap((section) => section.items.map((item) => item.id));
    assert.deepEqual(released, ['overview', 'productions', 'approvals', 'templates', 'audit', 'whats-new']);
    for (const item of NAV_ITEMS.filter((entry) => !isReleased(entry.since, R1))) {
      assert.equal(activeNavItem(item.href), undefined, `${item.href} is not highlighted before ${item.since}`);
    }
    assert.deepEqual(
      navigationFor(R1, { roles: ['approver'] }).map((section) => section.group.id),
      ['production', 'library', 'utility'],
    );
  });

  test('every R1 item has a route; later items have none yet', () => {
    const app = new URL('../app/(workspace)/', import.meta.url);
    const page = (href: string) => new URL(`.${href === '/' ? '' : href}/page.tsx`, app);
    // Wave 2 (track C2) adds `app/(workspace)/approvals/page.tsx`; the integrator drops this exception at I2.
    const pendingRoutes = new Set(['/approvals']);
    for (const item of NAV_ITEMS) {
      if (pendingRoutes.has(item.href) && !existsSync(page(item.href))) continue;
      assert.equal(existsSync(page(item.href)), isReleased(item.since, R1), `${item.href} page exists only once ${item.since} ships`);
    }
  });

  test('"Nova produção" is a primary action, never a menu item', () => {
    assert.ok(!NAV_ITEMS.some((item) => item.label === 'Nova produção' || item.href === '/productions/new'));
    assert.deepEqual(
      PRIMARY_ACTIONS.map((action) => [action.label, action.href]),
      [['Nova produção', '/productions/new']],
    );
  });

  test('"Versões" is not a menu label; /versions redirects to Novidades', () => {
    assert.ok(!NAV_ITEMS.some((item) => item.label === 'Versões'));
    assert.deepEqual(NAV_REDIRECTS, [{ from: '/versions', to: '/whats-new', permanent: true }]);
  });

  test('shipping a release turns "Em breve" into links; every item stays in the menu', () => {
    const all = (release: ReleaseId) => menuFor(release, { roles: EVERYONE }).flatMap((section) => section.items.map((item) => item.id)).sort();
    for (const release of RELEASES) assert.deepEqual(all(release), all(R1), `${release} shows the same items`);
    const soon = (release: ReleaseId) =>
      menuFor(release, { roles: EVERYONE }).flatMap((section) => section.items.filter((item) => item.soon).map((item) => item.id));
    assert.deepEqual(soon('R2'), ['opportunities', 'media', 'channels', 'profiles', 'newsletter', 'performance', 'batches', 'events', 'prompts', 'workspaces']);
    assert.deepEqual(soon('R7'), []);
    assert.deepEqual(
      navigationFor('R2').map((section) => section.group.id),
      ['production', 'intake', 'library', 'settings', 'utility'],
    );
    assert.equal(navigationFor('R7', { roles: EVERYONE }).flatMap((section) => section.items).length, NAV_ITEMS.length);
  });

  test('items are unique, follow their release inside the group and map to roadmap features', () => {
    assertUnique(ids(NAV_ITEMS), 'nav item ids');
    assertUnique(NAV_ITEMS.map((item) => item.href), 'nav hrefs');
    assertUnique(NAV_ITEMS.map((item) => item.label), 'nav labels');
    assertUnique(ids(NAV_GROUPS), 'nav group ids');
    assertUnique(NAV_GROUPS.map((group) => group.label), 'nav group labels');
    for (const item of NAV_ITEMS) {
      const group = NAV_GROUPS.find((candidate) => candidate.id === item.group);
      assert.ok(group, `${item.id} group`);
      assert.ok(releaseIndex(group.since) <= releaseIndex(item.since), `${item.id} ships no earlier than its group`);
      assert.ok(item.id === 'whats-new' || item.features.length > 0, `${item.id} names its roadmap features`);
    }
    for (const group of NAV_GROUPS) {
      const since = NAV_ITEMS.filter((item) => item.group === group.id).map((item) => releaseIndex(item.since));
      assert.deepEqual(since, [...since].sort((a, b) => a - b), `${group.id} items follow their release`);
      assert.equal(Math.min(...since), releaseIndex(group.since), `${group.id} ships with its first item`);
    }
  });

  test('every R1–R7 roadmap feature has a home: a menu item or a stage inside Produções', () => {
    const range = (prefix: string, last: number) => Array.from({ length: last }, (_, index) => `${prefix}.${index + 1}`);
    // Roadmap sheet (R0 screens are not routes), plus F1.7 (Logs, D01).
    const roadmap = [
      ...range('F1', 7),
      ...range('F2', 13),
      ...range('F3', 9),
      ...range('F4', 8),
      ...['F5.8', 'F5.10', 'F5.19', 'F5.20', 'F5.21'],
      ...range('F6', 10),
      ...range('F7', 6),
    ];
    const covered = new Set(NAV_ITEMS.flatMap((item) => item.features));
    assert.deepEqual(roadmap.filter((feature) => !covered.has(feature)), []);
    assert.deepEqual([...covered].filter((feature) => !roadmap.includes(feature)), [], 'no unknown feature ids');
  });

  test('"Chega na Rx" is the release of the first roadmap feature behind the screen', () => {
    // F2.10 → R2: the feature id carries its release.
    const releaseOf = (feature: string) => releaseIndex(`R${feature.slice(1, feature.indexOf('.'))}` as ReleaseId);
    for (const item of NAV_ITEMS.filter((entry) => entry.features.length > 0)) {
      assert.equal(releaseIndex(item.since), Math.min(...item.features.map(releaseOf)), `${item.id} arrives with ${item.features[0]}`);
    }
  });

  test('activeNavItem matches exact and nested routes of the release only', () => {
    assert.equal(activeNavItem('/')?.id, 'overview');
    assert.equal(activeNavItem('/productions')?.id, 'productions');
    assert.equal(activeNavItem('/productions/prod-1/article?compare=v1')?.id, 'productions');
    assert.equal(activeNavItem('/whats-new')?.id, 'whats-new');
    assert.equal(activeNavItem('/library/templates?model=tpl-aspas')?.id, 'templates');
    assert.equal(activeNavItem('/approvals?aba=devolvidas')?.id, 'approvals');
    assert.equal(activeNavItem('/news'), undefined);
    assert.equal(activeNavItem('/news', 'R2')?.id, 'news');
  });
});

describe('content registries', () => {
  test('R1 keeps transcript production and adds direct article writing with export', () => {
    assert.deepEqual(sourceKindsFor(R1).map((entry) => entry.kind), ['transcript']);
    assert.deepEqual(pieceKindsFor(R1).map((entry) => entry.kind), ['article', 'carousel']);
    assert.deepEqual(ids(gatesFor(R1)), ['article.approval', 'carousel.approval']);
    assert.deepEqual(ids(flowsFor(R1)), ['transcript-article', 'writing-article']);
    assert.deepEqual(ids(channelsFor(R1)), ['export']);
    assert.deepEqual(
      ids(channelsFor('R6')),
      ['export', 'cms', 'social', 'spotify', 'email', 'linkedin', 'whatsapp'],
    );
  });

  test('transcript intake accepts .txt .md .srt .vtt up to 2 MB and needs authorisation', () => {
    const transcript = SOURCE_KINDS[0];
    assert.equal(transcript.requiresAuthorization, true);
    assert.deepEqual(transcript.intake?.extensions, ['.txt', '.md', '.srt', '.vtt']);
    assert.equal(transcript.intake?.maxBytes, 2 * 1024 * 1024);
  });

  test('piece routes resolve only for released kinds', () => {
    assert.equal(pieceKindBySlug('article')?.kind, 'article');
    assert.equal(pieceKindBySlug('carousel')?.required, false);
    assert.equal(pieceKindBySlug('article')?.required, true);
    assert.equal(pieceKindBySlug('cut'), undefined);
    assert.equal(pieceKindBySlug('cut', 'R4')?.kind, 'cut');
    assert.deepEqual(pieceKindBySlug('carousel')?.parents, ['article']);
  });

  test('cross references resolve and never point to a later release', () => {
    const gateIds = new Set(ids(GATES));
    for (const piece of PIECE_KINDS) {
      if (piece.gateId) assert.ok(gateIds.has(piece.gateId), `${piece.kind} gate`);
      for (const parent of piece.parents) {
        const entry = PIECE_KINDS.find((candidate) => candidate.kind === parent);
        assert.ok(entry && releaseIndex(entry.since) <= releaseIndex(piece.since), `${piece.kind} parent ${parent}`);
      }
    }
    for (const flow of FLOWS) {
      for (const gate of flow.gates) {
        const entry = GATES.find((candidate) => candidate.id === gate);
        assert.ok(entry && releaseIndex(entry.since) <= releaseIndex(flow.since), `${flow.id} gate ${gate}`);
      }
      for (const stage of flow.stages) {
        if (!stage.pieceKind) continue;
        const entry = PIECE_KINDS.find((candidate) => candidate.kind === stage.pieceKind);
        assert.ok(entry && releaseIndex(entry.since) <= releaseIndex(flow.since), `${flow.id} stage ${stage.id}`);
      }
      for (const kind of flow.sourceKinds) {
        const entry = SOURCE_KINDS.find((candidate) => candidate.kind === kind);
        assert.ok(entry && releaseIndex(entry.since) <= releaseIndex(flow.since), `${flow.id} source ${kind}`);
      }
    }
    for (const channel of CHANNELS) {
      for (const kind of channel.pieceKinds) assert.ok(PIECE_KINDS.some((entry) => entry.kind === kind), `${channel.id} ${kind}`);
    }
    for (const registry of [ids(GATES), ids(FLOWS), ids(CHECKS), ids(CHANNELS), ids(COPILOT_TOOLS), ids(DASHBOARD_WIDGETS)]) {
      assertUnique(registry, 'registry ids');
    }
  });
});

describe('check registry', () => {
  test('R1 readiness checks are the domain checks; only "Texto da IA" (generation finished) blocks', () => {
    assert.deepEqual(ids(articleChecksFor(R1)), ids(ARTICLE_CHECKS));
    assert.deepEqual(
      checksFor('article', 'readiness', R1).filter((entry) => entry.blocking).map((entry) => entry.label),
      ['Texto da IA'],
    );
    assert.deepEqual(ids(checksFor('carousel', 'readiness', R1)), ids(CAROUSEL_CHECKS));
    assert.ok(!ids(checksFor('article', 'readiness', R1)).includes('article.seo'));
    assert.ok(ids(checksFor('article', 'readiness', 'R3')).includes('article.seo'));
  });

  test('"Material autorizado" blocks generation until the material is authorised', () => {
    const [check] = GENERATION_CHECKS;
    assert.equal(check.label, 'Material autorizado');
    const source = (authorized: boolean) => ({ rights: { authorized } }) as Source;
    assert.equal(check.evaluate({ sources: [] }).status, 'fail');
    assert.equal(check.evaluate({ sources: [source(false)] }).status, 'fail');
    assert.equal(check.evaluate({ sources: [source(true)] }).status, 'pass');
  });
});

describe('recipes', () => {
  test('every run kind has a recipe with unique step ids and a versioned prompt', () => {
    for (const kind of Object.keys(RUN_KIND_LABELS) as RunKind[]) {
      const recipe = recipeFor(kind);
      const steps = recipe.steps({ sections: 4 });
      assertUnique(ids(steps), `${kind} steps`);
      assert.ok(recipe.prompt.key && recipe.prompt.version && recipe.prompt.hash);
    }
  });

  test('the article recipe follows the editorial order: structure, sources and quotes, drafting, checking', () => {
    const steps = recipeFor('article.generate').steps({ sections: 3 });
    assert.deepEqual(
      steps.map((step) => step.id),
      ['read', 'outline', 'select', 'intro', 'section-1', 'section-2', 'section-3', 'quotes'],
      'step ids never change, only their order',
    );
    assert.deepEqual(steps.map((step) => step.label), [
      'Lendo material',
      'Montando estrutura',
      'Organizando fontes e citações',
      'Redigindo introdução',
      'Redigindo seção 1 de 3',
      'Redigindo seção 2 de 3',
      'Redigindo seção 3 de 3',
      'Conferindo citações e tamanho',
    ]);
    assert.equal(ARTICLE_RUN_NEXT, 'Próximo: revisar o texto e enviar para aprovação');
  });
});

describe('sizing', () => {
  test('Hard News is sized in laudas (R1 and R2 flows); Evergreen follows search intent, as data (R3)', () => {
    const flowIds = new Set(FLOWS.map((flow) => flow.id));
    for (const policy of SIZING_POLICIES) {
      assert.ok(policy.neverPad, `${policy.id} never pads`);
      for (const flow of policy.flows) assert.ok(flowIds.has(flow), `${policy.id} → ${flow}`);
    }
    const hardNews = sizingPolicyFor('transcript-article');
    assert.equal(hardNews.kind, 'laudas');
    assert.equal(sizingPolicyFor('news-article').id, 'hard-news');
    const evergreen = sizingPolicyFor('opportunity-article');
    assert.equal(evergreen.kind, 'intent');
    assert.equal(evergreen.kind === 'intent' && evergreen.cap, null);
    assert.equal(evergreen.since, 'R3');
  });

  test('the size contract a provider receives: target, maximum, no padding, budgets per section', () => {
    assert.deepEqual(draftSizeInstructions({ size: 'standard', sections: 3 }), {
      size: 'standard',
      laudas: 2,
      charsPerLauda: 2000,
      minChars: 2001,
      maxChars: 4000,
      targetChars: 3600,
      tolerance: 0.1,
      headings: true,
      neverPad: true,
      introChars: 900,
      sections: [
        { stepId: 'section-1', budgetChars: 900 },
        { stepId: 'section-2', budgetChars: 900 },
        { stepId: 'section-3', budgetChars: 900 },
      ],
      instruction: 'Escreva até 4.000 caracteres; se o material não sustentar, escreva menos e não complete.',
    });
    const curto = draftSizeInstructions({ size: 'short', sections: 2 });
    assert.equal(curto.headings, false, 'a Curto has no intertítulos');
    assert.deepEqual(curto.sections.map((section) => section.budgetChars), [540, 540]);
    assert.equal(curto.instruction, 'Escreva até 2.000 caracteres; se o material não sustentar, escreva menos e não complete.');
  });
});

describe('copilot and dashboard', () => {
  test('R1 presets: Mais direto, Sugerir intertítulos, Encurtar até o tamanho da pauta, Gerar títulos alternativos', () => {
    assert.deepEqual(
      copilotPresets('article', R1).map((tool) => tool.label),
      ['Mais direto', 'Sugerir intertítulos', 'Encurtar até o tamanho da pauta', 'Gerar títulos alternativos'],
    );
    assert.ok(copilotPresets('article', R1).find((tool) => tool.id === 'shorten-to-brief')?.toBriefSize);
    assert.equal(copilotPresets('article', R1).find((tool) => tool.id === 'titles')?.proposals, 3);
    assert.ok(!copilotToolsFor('article', R1).some((tool) => tool.id === 'suggest-links'));
    assert.deepEqual(
      copilotToolsFor('carousel', R1).map((tool) => tool.label),
      ['Reescrever', 'Encurtar para caber', 'Trocar ponto'],
    );
    assert.ok(COPILOT_TOOLS.every((tool) => tool.icon === 'Sparkles'), 'AI actions use the reserved AI icon');
    for (const tool of COPILOT_TOOLS) {
      if (tool.request) assert.equal(RUN_KIND_OF[tool.request], tool.runKind, `${tool.id} provenance kind`);
    }
    assert.ok(copilotToolsFor('article', R1).every((tool) => tool.request), 'every R1 article tool starts a port request');
  });

  test('R1 Início is a desk: what needs you, the team, what is in progress and one week line', () => {
    assert.deepEqual(ids(dashboardWidgetsFor({ capabilities: [] }, R1)), ['needs-you', 'team', 'in-progress', 'week']);
    assert.deepEqual(ids(dashboardWidgetsFor({ capabilities: ['cost'] }, R1)), ['needs-you', 'team', 'in-progress', 'week']);
    // Management charts wait for "Desempenho" (R6); cost still needs a runtime that measures it.
    const r6 = ids(dashboardWidgetsFor({ capabilities: [] }, 'R6'));
    assert.ok(r6.includes('rhythm') && r6.includes('time-to-approval') && !r6.includes('generation-cost'));
    assert.ok(ids(dashboardWidgetsFor({ capabilities: ['cost'] }, 'R6')).includes('generation-cost'));
    assert.equal(DASHBOARD_WIDGETS.find((widget) => widget.id === 'time-to-approval')?.lowerIsBetter, true);
    for (const gone of ['ai-retention', 'activity', 'generating-now', 'continue', 'awaiting-you', 'awaiting-approval']) {
      assert.ok(!DASHBOARD_WIDGETS.some((widget) => widget.id === gone), `${gone} left Início`);
    }
  });
});

describe('image sources', () => {
  test('R1 picks a file or a link; the archive (R2) and AI generation and semantic search (R6) plug in as entries', () => {
    assertUnique(ids(IMAGE_SOURCES), 'image source ids');
    assert.deepEqual(ids(imageSourcesFor(R1)), ['upload', 'link']);
    assert.deepEqual(ids(imageSourcesFor('R2')), ['upload', 'link', 'archive']);
    assert.deepEqual(ids(imageSourcesFor('R6')), ['upload', 'link', 'archive', 'generate', 'semantic-search']);
    assert.deepEqual(imageSourcesFor(R1).map((entry) => entry.label), ['Enviar arquivo', 'Link']);
    assert.ok(IMAGE_SOURCES.filter((entry) => entry.ai).every((entry) => entry.icon === 'Sparkles'), 'AI actions use the reserved AI icon');
    assert.deepEqual(
      IMAGE_SOURCES.filter((entry) => entry.requirement).map((entry) => entry.requirement),
      ['F2.9', 'F6.10', 'F6.9'],
    );
  });

  test('the image checks ship in R1 as warnings', () => {
    const entries = CHECKS.filter((entry) => entry.id === 'article.cover' || entry.id === 'article.image-credits');
    assert.deepEqual(
      entries.map((entry) => [entry.id, entry.label, entry.since, entry.blocking]),
      [
        ['article.cover', 'Imagem de destaque', 'R1', false],
        ['article.image-credits', 'Imagens com crédito', 'R1', false],
      ],
    );
    assert.ok(articleChecksFor(R1).some((check) => check.id === 'article.image-credits'));
  });
});

describe('icons', () => {
  const iconsFile = new URL('../../node_modules/@content-ventures/design-system/src/components/ds-v3/icons.ts', import.meta.url);

  test('every icon key is exported by the Design System icon module', { skip: !existsSync(iconsFile) }, () => {
    const exported = new Set(readFileSync(iconsFile, 'utf8').match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? []);
    const used = new Set<IconKey>([
      ...NAV_ITEMS.map((item) => item.icon),
      ...PRIMARY_ACTIONS.map((action) => action.icon),
      ...SOURCE_KINDS.map((entry) => entry.icon),
      ...PIECE_KINDS.map((entry) => entry.icon),
      ...CHANNELS.map((entry) => entry.icon),
      ...COPILOT_TOOLS.map((entry) => entry.icon),
      ...DASHBOARD_WIDGETS.map((entry) => entry.icon),
      ...IMAGE_SOURCES.map((entry) => entry.icon),
    ]);
    for (const icon of used) assert.ok(exported.has(icon), `${icon} is not in the DS icon module`);
  });
});
