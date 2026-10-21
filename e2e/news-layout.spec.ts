import { expect, test, type Locator, type Page } from '@playwright/test';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import type { NewsFeed, NewsItem } from '../src/domain/hard-news.ts';
import { expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 390, height: 844 }];
const FIRST = '10000000-0000-4000-8000-000000000001';
const SECOND = '10000000-0000-4000-8000-000000000002';
const THIRD = '10000000-0000-4000-8000-000000000003';
const FIRST_TITLE = 'Tilápia brasileira amplia presença no mercado externo e produtores discutem os próximos investimentos';
const SECOND_TITLE = 'Tilápia ganha novo estudo sobre alimentação e qualidade da água';
const IMAGE_ORIGIN = 'https://images.example';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAMAAAAIGK1gAAAAA1BMVEUpWoLTBBdnAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAJUlEQVRo3u3BgQAAAADDoPlTX+EAVQEAAAAAAAAAAAAAAAAAvAY4mgABuJr0lwAAAABJRU5ErkJggg==', 'base64');

async function mockDesk(page: Page, count = 18) {
  const checkpoint = emptyEditorialCheckpoint();
  const at = new Date().toISOString();
  const feeds: NewsFeed[] = ['Instituto do Pescado', 'Revista Aquicultura', 'Alerta pescado'].map((name, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name,
    url: `https://fonte${index}.example/feed/`, everyMinutes: 60, state: 'active', lastDay: 6,
    lastReadAt: at, lastWeek: [2, 4, 3, 5, 2, 4, 6], kind: index === 2 ? 'google-alerts' : 'rss',
    ...(index === 2 ? { keyword: 'pescado' } : {}),
    ...(index < 2 ? { rating: { tier: index === 0 ? 'A1' as const : 'A2' as const, relevance: 'high' as const,
      rationale: 'Publica informações especializadas sobre a cadeia do pescado.', updatedAt: at } } : {}),
  }));
  const items: NewsItem[] = Array.from({ length: count }, (_, index) => {
    const feed = feeds[index % feeds.length];
    const publishedAt = new Date(Date.now() - index * 60_000).toISOString();
    return {
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title: index === 0 ? FIRST_TITLE : index === 1 ? SECOND_TITLE : `Cadeia do pescado acompanha pesquisa e mercado ${index + 1}`,
      source: feed.name, feedId: feed.id, url: feed.url.replace('/feed/', `/noticia-${index + 1}/`),
      ...(index === 0 || index === 24 ? { imageUrl: `${IMAGE_ORIGIN}/news-${index + 1}.png` }
        : index === 2 ? { imageUrl: `${IMAGE_ORIGIN}/broken.png` } : {}),
      via: 'rss', contentKind: 'feed', status: 'new', publishedAt, importedAt: publishedAt,
      excerpt: 'Os novos dados ajudam a acompanhar a produção, o comércio e os próximos desafios do setor.',
      body: Array.from({ length: 12 }, (_, paragraph) => `Parágrafo ${paragraph + 1} da notícia ${index + 1}. Pesquisadores e produtores apresentam os resultados, explicam a metodologia e discutem seus efeitos sobre a cadeia do pescado no Brasil.`),
      duplicates: [], decisionRevision: 0,
    };
  });
  await page.route('https://www.google.com/s2/favicons?**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  // A corrupt image response exercises decode failure without an unrelated HTTP console error.
  await page.route(`${IMAGE_ORIGIN}/**`, route => route.fulfill({ contentType: 'image/png',
    body: route.request().url().endsWith('/broken.png') ? Buffer.from('invalid PNG') : PNG }));
  await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  await page.route('**/api/reporter/news**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/reporter/news/items/')) return route.fulfill({ json: { item: items.find(item => path.endsWith(item.id)) } });
    return route.fulfill({ json: { at: new Date().toISOString(), sources: feeds, items, rssApp: false } });
  });
}

async function loadedNewsImage(card: Locator, index: number) {
  const image = card.locator(`img[src="${IMAGE_ORIGIN}/news-${index}.png"]`);
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => [node.complete, node.naturalWidth, node.naturalHeight])).toEqual([true, 160, 90]);
  return image;
}

/** CardLink stretches over the media; click the image's real screen coordinates. */
async function clickImage(page: Page, image: Locator) {
  await image.scrollIntoViewIfNeeded();
  const box = (await image.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('carrega mais manchetes com foco útil e preserva a página e a busca ao voltar da leitura', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDesk(page, 30);
  const errors = watchErrors(page);
  await page.goto('/news');
  const search = page.getByRole('searchbox', { name: 'Buscar notícias', exact: true });
  // All thirty headlines contain this term; a non-empty search also exercises return state.
  await search.fill('a');
  await expect(page.getByTestId(/^news-card-/)).toHaveCount(24);
  const more = page.getByRole('button', { name: 'Carregar mais manchetes', exact: true });
  await more.click();
  await expect(page.getByTestId(/^news-card-/)).toHaveCount(30);
  await expect(more).toHaveCount(0);
  const card = page.getByTestId('news-card-10000000-0000-4000-8000-000000000025');
  const open = card.getByRole('button', { name: 'Ler notícia: Cadeia do pescado acompanha pesquisa e mercado 25', exact: true });
  await expect(open).toBeFocused();
  const image = await loadedNewsImage(card, 25);
  await image.scrollIntoViewIfNeeded();
  await expect(card).toBeInViewport();
  const before = (await card.boundingBox())!.y;
  await clickImage(page, image);
  await expect(page.getByRole('heading', { level: 2, name: 'Cadeia do pescado acompanha pesquisa e mercado 25', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/news$/);
  await expect(search).toHaveValue('a');
  await expect(page.getByTestId(/^news-card-/)).toHaveCount(30);
  await loadedNewsImage(card, 25);
  await expect(open).toBeFocused();
  await expect(card).toBeInViewport();
  await expect.poll(async () => Math.abs((await card.boundingBox())!.y - before), { message: 'a volta mantém a posição entre as manchetes carregadas' }).toBeLessThan(3);
  await expect(page.locator('[data-ws-stop="footer"]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

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

    test('abre manchetes sem selecionar e só mostra leitura expandida e decisões após o clique', async ({ page }) => {
      await mockDesk(page);
      const errors = watchErrors(page);
      const writes: string[] = [];
      page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url());
      });
      await page.goto('/news');
      const article = page.locator('[data-ws-stop="main"]');
      const decisions = page.locator('[data-ws-stop="footer"]');
      const search = page.getByRole('searchbox', { name: 'Buscar notícias', exact: true });
      const first = page.getByTestId(`news-card-${FIRST}`);
      await expect(page.getByTestId('news-headlines')).toBeVisible();
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(18);
      await entirelyVisible(page, search);
      await expect(first.getByRole('heading', { name: FIRST_TITLE, exact: true })).toBeVisible();
      await expect(decisions).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Selecionar para redação', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Outras ações da notícia', exact: true })).toHaveCount(0);
      await expect(page.getByText('Parágrafo 1 da notícia 1.', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Chegadas', exact: true })).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Força editorial da fonte', exact: true })).toHaveCount(0);
      const searchBox = (await search.boundingBox())!;
      const firstBox = (await first.boundingBox())!;
      expect(firstBox.y, 'as manchetes vêm depois da busca').toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
      expect(firstBox.y - searchBox.y - searchBox.height, 'as manchetes começam perto da busca, sem gráficos entre elas').toBeLessThan(190);
      const overviewWidth = (await article.boundingBox())!.width;
      // Decision shortcuts must not act on a story the person has not opened.
      await page.keyboard.press('c');
      await page.keyboard.press('a');
      await expect(page.getByTestId('news-headlines')).toBeVisible();
      expect(writes).toEqual([]);
      await expectNoHorizontalOverflow(page);

      const image = await loadedNewsImage(first, 1);
      const second = page.getByTestId(`news-card-${SECOND}`);
      await expect(second.locator(`img[src^="${IMAGE_ORIGIN}/"]`)).toHaveCount(0);
      await expect(second.getByText('Imagem indisponível', { exact: true })).toHaveCount(0);
      const broken = page.getByTestId(`news-card-${THIRD}`);
      await expect(broken.getByRole('img', { name: /imagem indisponível/i })).toBeVisible();
      await expect(broken.getByText('Imagem indisponível', { exact: true })).toBeVisible();
      const headline = first.getByRole('heading', { name: FIRST_TITLE, exact: true });
      await headline.scrollIntoViewIfNeeded();
      await entirelyVisible(page, headline);
      await clickImage(page, image);
      await expect(page).toHaveURL(new RegExp(`/news\\?item=${FIRST}$`));
      await expect(page.getByTestId('news-headlines')).toHaveCount(0);
      await expect(search).toHaveCount(0);
      await expect(page.locator('[data-ws-stop="start"]')).toHaveCount(0);
      const heading = article.getByRole('heading', { name: FIRST_TITLE, exact: true });
      await entirelyVisible(page, heading);
      await entirelyVisible(page, article.getByRole('link', { name: /^Ver original/ }));
      const back = page.getByRole('navigation', { name: 'Trilha de navegação', exact: true }).getByRole('link', { name: 'Notícias', exact: true });
      await entirelyVisible(page, back);
      await expect(back).toHaveAttribute('href', '/news');
      for (const name of ['Outras ações da notícia', 'Selecionar para redação']) {
        await entirelyVisible(page, decisions.getByRole('button', { name, exact: true }));
      }
      await entirelyVisible(page, decisions);
      await entirelyVisible(page, article);
      expect((await article.boundingBox())!.width, 'a leitura ocupa toda a largura usada pelo overview').toBeCloseTo(overviewWidth, 0);
      // The received text is expanded on entry, without an additional disclosure click.
      await expect(article.getByText('Parágrafo 1 da notícia 1.', { exact: false })).toBeVisible();
      await article.getByText('Parágrafo 12 da notícia 1.', { exact: false }).scrollIntoViewIfNeeded();
      for (const name of ['Outras ações da notícia', 'Selecionar para redação']) {
        await entirelyVisible(page, decisions.getByRole('button', { name, exact: true }));
      }
      await decisions.getByRole('button', { name: 'Outras ações da notícia', exact: true }).click();
      for (const name of ['Por 2 horas', 'Até amanhã cedo', 'Fora do mapa editorial']) {
        await entirelyVisible(page, page.getByRole('menuitem', { name, exact: true }));
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitem', { name: 'Por 2 horas', exact: true })).toHaveCount(0);
      expect(writes, 'consultar as ações não grava decisões').toEqual([]);
      await expectNoHorizontalOverflow(page);
      await expectHeadingOutline(page);
      expect(errors).toEqual([]);
    });

    test('preserva busca e filtros ao voltar por breadcrumb e navegador, e permite consultar atividade', async ({ page }) => {
      await mockDesk(page);
      const errors = watchErrors(page);
      await page.goto('/news');
      const search = page.getByRole('searchbox', { name: 'Buscar notícias', exact: true });
      const first = page.getByTestId(`news-card-${FIRST}`);
      const second = page.getByTestId(`news-card-${SECOND}`);
      await expect(first).toBeVisible();
      await search.fill('tilápia');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(2);
      await page.getByRole('button', { name: /^Filtros/ }).click();
      await choose(page, 'Força editorial da fonte', 'A1 · Referência');
      await choose(page, 'Fonte', 'Instituto do Pescado');
      await expect(first).toBeVisible();
      await expect(second).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: /^Filtros/ }).click();
      await expect(page.getByRole('combobox', { name: 'Fonte', exact: true })).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Filtros aplicados', exact: true })).toBeVisible();
      await clickImage(page, await loadedNewsImage(first, 1));
      const article = page.locator('[data-ws-stop="main"]');
      await expect(article.getByRole('heading', { name: FIRST_TITLE, exact: true })).toBeVisible();
      await expect(page.getByTestId('news-headlines')).toHaveCount(0);
      await page.getByRole('navigation', { name: 'Trilha de navegação', exact: true }).getByRole('link', { name: 'Notícias', exact: true }).click();
      await expect(page).toHaveURL(/\/news$/);
      await expect(search).toHaveValue('tilápia');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(1);
      await expect(first).toBeVisible();
      await loadedNewsImage(first, 1);
      await expect(page.getByRole('group', { name: 'Filtros aplicados', exact: true })).toContainText('Instituto do Pescado');
      await expect(page.getByRole('group', { name: 'Filtros aplicados', exact: true })).toContainText('A1');
      await expect(page.locator('[data-ws-stop="footer"]')).toHaveCount(0);

      await clickImage(page, await loadedNewsImage(first, 1));
      await expect(page).toHaveURL(new RegExp(`/news\\?item=${FIRST}$`));
      await page.goBack();
      await expect(page).toHaveURL(/\/news$/);
      await expect(search).toHaveValue('tilápia');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(1);
      await expect(first).toBeVisible();
      await loadedNewsImage(first, 1);
      await expect(page.locator('[data-ws-stop="footer"]')).toHaveCount(0);

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
      await expect(search).toHaveValue('tilápia');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(1);
      await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
      await expect(first).toBeVisible();
      await expect(second).toBeVisible();
      await expect(search).toHaveValue('tilápia');
      await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
      await expect(search).toHaveValue('');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(18);
      await page.getByRole('button', { name: /^Filtros/ }).click();
      await choose(page, 'Fonte', 'Alerta pescado');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(6);
      await expect(first).toHaveCount(0);
      await expect(second).toHaveCount(0);
      await page.getByRole('button', { name: 'Limpar', exact: true }).click();
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(18);
      await expectNoHorizontalOverflow(page);
      await expectHeadingOutline(page);
      expect(errors).toEqual([]);
    });
  });
}
