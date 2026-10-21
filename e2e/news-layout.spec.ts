import { expect, test, type Locator, type Page } from '@playwright/test';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import type { NewsFeed, NewsItem } from '../src/domain/hard-news.ts';
import { expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 390, height: 844 }];
const FIRST = '10000000-0000-4000-8000-000000000001';
const SECOND = '10000000-0000-4000-8000-000000000002';
const FIRST_TITLE = 'Tilápia brasileira amplia presença no mercado externo e produtores discutem os próximos investimentos';
const SECOND_TITLE = 'Tilápia ganha novo estudo sobre alimentação e qualidade da água';

async function mockDesk(page: Page) {
  const checkpoint = emptyEditorialCheckpoint();
  const at = new Date().toISOString();
  const feeds: NewsFeed[] = ['Instituto do Pescado', 'Revista Aquicultura', 'Observatório do Mar'].map((name, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name,
    url: `https://fonte${index}.example/feed/`, everyMinutes: 60, state: 'active', lastDay: 6,
    lastReadAt: at, lastWeek: [2, 4, 3, 5, 2, 4, 6], kind: 'rss',
    ...(index < 2 ? { rating: { tier: index === 0 ? 'A1' as const : 'A2' as const, relevance: 'high' as const,
      rationale: 'Publica informações especializadas sobre a cadeia do pescado.', updatedAt: at } } : {}),
  }));
  const items: NewsItem[] = Array.from({ length: 18 }, (_, index) => {
    const feed = feeds[index % feeds.length];
    const publishedAt = new Date(Date.now() - index * 60_000).toISOString();
    return {
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title: index === 0 ? FIRST_TITLE : index === 1 ? SECOND_TITLE : `Cadeia do pescado acompanha pesquisa e mercado ${index + 1}`,
      source: feed.name, feedId: feed.id, url: feed.url.replace('/feed/', `/noticia-${index + 1}/`),
      via: 'rss', contentKind: 'feed', status: 'new', publishedAt, importedAt: publishedAt,
      excerpt: 'Os novos dados ajudam a acompanhar a produção, o comércio e os próximos desafios do setor.',
      body: Array.from({ length: 12 }, (_, paragraph) => `Parágrafo ${paragraph + 1} da notícia ${index + 1}. Pesquisadores e produtores apresentam os resultados, explicam a metodologia e discutem seus efeitos sobre a cadeia do pescado no Brasil.`),
      duplicates: [], decisionRevision: 0,
    };
  });
  await page.route('https://www.google.com/s2/favicons?**', route => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  await page.route('**/api/reporter/news**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/reporter/news/items/')) return route.fulfill({ json: { item: items.find(item => path.endsWith(item.id)) } });
    return route.fulfill({ json: { at: new Date().toISOString(), sources: feeds, items, rssApp: false } });
  });
}

async function choose(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Bounding boxes catch clipped footers even when Playwright considers an element visible. */
async function entirelyVisible(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport({ ratio: 1 });
  const rect = await target.boundingBox();
  expect(rect).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(rect!.x, 'left edge').toBeGreaterThanOrEqual(-1);
  expect(rect!.y, 'top edge').toBeGreaterThanOrEqual(-1);
  expect(rect!.x + rect!.width, 'right edge').toBeLessThanOrEqual(viewport.width + 1);
  expect(rect!.y + rect!.height, 'bottom edge').toBeLessThanOrEqual(viewport.height + 1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`radar e leitura em ${viewport.width}`, () => {
    test.use(viewport.width < 768 ? { viewport, hasTouch: true, isMobile: true } : { viewport });

    test('prioriza a fila e mantém leitura e decisões dentro da tela', async ({ page }) => {
      await mockDesk(page);
      const errors = watchErrors(page);
      await page.goto('/news');
      const radar = page.locator('[data-ws-stop="start"]');
      const article = page.locator('[data-ws-stop="main"]');
      const decisions = page.locator('[data-ws-stop="footer"]');
      const search = page.getByRole('searchbox', { name: 'Buscar notícias', exact: true });
      const first = page.getByTestId(`news-row-${FIRST}`);
      await entirelyVisible(page, search);
      await entirelyVisible(page, first);
      await expect(page.getByRole('heading', { name: 'Chegadas', exact: true })).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Força editorial da fonte', exact: true })).toHaveCount(0);
      const searchBox = (await search.boundingBox())!;
      const firstBox = (await first.boundingBox())!;
      expect(firstBox.y, 'a fila vem depois da busca').toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
      expect(firstBox.y - searchBox.y - searchBox.height, 'a lista começa perto da busca, sem gráficos entre elas').toBeLessThan(190);
      await expectNoHorizontalOverflow(page);

      await first.click();
      const heading = article.getByRole('heading', { name: FIRST_TITLE, exact: true });
      await entirelyVisible(page, heading);
      await entirelyVisible(page, article.getByRole('link', { name: /^Ver original/ }));
      for (const name of ['Outras ações da notícia', 'Selecionar para redação']) {
        await entirelyVisible(page, decisions.getByRole('button', { name, exact: true }));
      }
      await entirelyVisible(page, decisions);
      await entirelyVisible(page, article);
      if (viewport.width >= 900) {
        await entirelyVisible(page, radar);
        const radarBox = (await radar.boundingBox())!, articleBox = (await article.boundingBox())!;
        expect(radarBox.width).toBeGreaterThanOrEqual(360);
        expect(radarBox.width).toBeLessThanOrEqual(520);
        expect(articleBox.width).toBeGreaterThanOrEqual(480);
        expect(articleBox.x).toBeGreaterThanOrEqual(radarBox.x + radarBox.width);
      } else {
        await expect(page.getByRole('tab', { name: 'Notícia', exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(page.getByRole('tabpanel', { name: 'Radar', exact: true })).toBeHidden();
      }
      await article.getByRole('button', { name: /^Texto recebido do feed/ }).click();
      await article.getByText('Parágrafo 12 da notícia 1.', { exact: false }).scrollIntoViewIfNeeded();
      for (const name of ['Outras ações da notícia', 'Selecionar para redação']) {
        await entirelyVisible(page, decisions.getByRole('button', { name, exact: true }));
      }
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });

    test('combina filtros, limpa recortes e abre atividade sem perder a notícia nem a busca', async ({ page }) => {
      await mockDesk(page);
      const errors = watchErrors(page);
      await page.goto('/news');
      const search = page.getByRole('searchbox', { name: 'Buscar notícias', exact: true });
      const first = page.getByTestId(`news-row-${FIRST}`);
      const second = page.getByTestId(`news-row-${SECOND}`);
      await expect(first).toBeVisible();
      await search.fill('tilápia');
      await expect(page.getByTestId(/^news-row-/)).toHaveCount(2);
      await page.getByRole('button', { name: /^Filtros/ }).click();
      await choose(page, 'Força editorial da fonte', 'A1 · Referência');
      await choose(page, 'Fonte', 'Instituto do Pescado');
      await expect(first).toBeVisible();
      await expect(second).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: /^Filtros/ }).click();
      await expect(page.getByRole('combobox', { name: 'Fonte', exact: true })).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Filtros aplicados', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
      await expect(first).toBeVisible();
      await expect(second).toBeVisible();
      await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
      await expect(search).toHaveValue('');
      await expect(page.getByTestId(/^news-row-/)).toHaveCount(18);
      await search.fill('tilápia');
      await second.click();
      const article = page.locator('[data-ws-stop="main"]');
      await expect(article.getByRole('heading', { name: SECOND_TITLE, exact: true })).toBeVisible();

      if (viewport.width < 900) {
        await page.getByRole('tab', { name: 'Radar', exact: true }).click();
        await expect(search).toHaveValue('tilápia');
        await expect(page.getByTestId(/^news-row-/)).toHaveCount(2);
        await page.getByRole('tab', { name: 'Notícia', exact: true }).click();
        await expect(article.getByRole('heading', { name: SECOND_TITLE, exact: true })).toBeVisible();
      }
      if (viewport.width < 768) {
        await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Ver atividade', exact: true }).click();
      } else await page.getByRole('button', { name: 'Ver atividade', exact: true }).click();
      const activity = page.getByRole('dialog', { name: 'Atividade do radar', exact: true });
      await expect(activity).toBeVisible();
      await expect(activity.getByRole('heading', { name: 'Chegadas', exact: true })).toBeVisible();
      await entirelyVisible(page, activity.getByRole('button', { name: 'Fechar painel', exact: true }));
      await expectNoHorizontalOverflow(page);
      await activity.getByRole('button', { name: 'Fechar painel', exact: true }).click();
      await expect(activity).toHaveCount(0);
      await expect(article.getByRole('heading', { name: SECOND_TITLE, exact: true })).toBeVisible();
      if (viewport.width < 900) await page.getByRole('tab', { name: 'Radar', exact: true }).click();
      await expect(search).toHaveValue('tilápia');
      await expectNoHorizontalOverflow(page);
      await expectHeadingOutline(page);
      expect(errors).toEqual([]);
    });
  });
}
