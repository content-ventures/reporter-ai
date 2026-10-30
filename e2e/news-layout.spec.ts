import { expect, test, type Locator, type Page } from '@playwright/test';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import type { NewsSearchView, NewsSearchWrite } from '../src/domain/news-search.ts';
import type { NewsFeed, NewsItem } from '../src/domain/hard-news.ts';
import { expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 709, height: 790 }, { width: 390, height: 844 }];
const FIRST = '10000000-0000-4000-8000-000000000001';
const SECOND = '10000000-0000-4000-8000-000000000002';
const SIXTH = '10000000-0000-4000-8000-000000000006';
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
      // Two stories ran in a second outlet: they lead the cover, in order of publication.
      duplicates: index % 3 === 0 || index === 5 ? [{ source: 'Jornal do Pescado', url: `https://jornal.example/noticia-${index + 1}`, publishedAt }] : [],
      decisionRevision: 0,
    };
  });
  const decisions: { revision: number; action: string; reason?: string; scoreSnapshot?: { score: number; topic: string; mapVersion: number; reasons: unknown[] } }[] = [];
  await page.route('https://www.google.com/s2/favicons?**', route => route.fulfill({ contentType: 'image/png', body: PNG }));
  // A corrupt image response exercises decode failure without an unrelated HTTP console error.
  await page.route(`${IMAGE_ORIGIN}/**`, route => route.fulfill({ contentType: 'image/png',
    body: route.request().url().endsWith('/broken.png') ? Buffer.from('invalid PNG') : PNG }));
  await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  await page.route('**/api/reporter/news**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/decision')) {
      const input = route.request().postDataJSON() as { revision: number; action: string; hours?: number; reason?: string; scoreSnapshot?: { score: number; topic: string; mapVersion: number; reasons: unknown[] } };
      decisions.push(input);
      const index = items.findIndex(item => path.includes(`/items/${item.id}/`));
      const now = new Date().toISOString();
      const status = { select: 'selected', postpone: 'later', discard: 'discarded', restore: 'new' }[input.action] as NewsItem['status'];
      items[index] = { ...items[index], status, decisionRevision: (items[index].decisionRevision ?? 0) + 1,
        decidedAt: status === 'new' ? undefined : now, laterUntil: input.hours ? new Date(Date.now() + input.hours * 3_600_000).toISOString() : undefined,
        discardReason: input.reason };
      return route.fulfill({ json: items[index] });
    }
    if (path.startsWith('/api/reporter/news/items/')) return route.fulfill({ json: { item: items.find(item => path.endsWith(item.id)) } });
    return route.fulfill({ json: { at: new Date().toISOString(), sources: feeds, items, rssApp: false } });
  });
  return { decisions };
}

async function loadedNewsImage(card: Locator, index: number) {
  const image = card.locator(`img[src="${IMAGE_ORIGIN}/news-${index}.png"]`);
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => [node.complete, node.naturalWidth, node.naturalHeight])).toEqual([true, 160, 90]);
  return image;
}

/** The radar's first view: the pulse, the lead with its photo, the highlights and the subjects beside them. */
async function expectRadar(page: Page) {
  await expect(page.getByRole('region', { name: 'Pulso do radar', exact: true })).toBeVisible();
  const lead = page.locator('[data-news-layout="lead"]');
  await expect(lead).toHaveCount(1);
  await loadedNewsImage(lead, 1);
  await expect(lead.getByText('Em 2 veículos', { exact: true })).toBeVisible();
  const highlights = page.getByRole('list', { name: 'Outros destaques', exact: true });
  await expect(highlights.getByTestId(/^news-card-/)).toHaveCount(3);
  await expect(page.getByTestId(`news-card-${SIXTH}`).getByText('Em 2 veículos', { exact: true })).toBeVisible();
  // A story without a photo leads with its outlet's mark, never an icon stretched into a photo frame.
  const second = page.getByTestId(`news-card-${SECOND}`);
  await expect(second.locator(`img[src^="${IMAGE_ORIGIN}/"]`)).toHaveCount(0);
  await expect(second.locator('img[src*="s2/favicons"]')).toHaveCount(1);
  await expect(page.getByTestId('news-headlines').locator(`img[src="${IMAGE_ORIGIN}/broken.png"]`)).toHaveCount(0);
  // Where and how strong: the outlet and its rating ride along every row; the time has its column.
  await expect(second.getByText('Revista Aquicultura')).toBeVisible();
  await expect(second.getByText('A2', { exact: true })).toBeVisible();
  const leadFont = await lead.getByRole('heading', { level: 3 }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const rowFont = await second.getByText(SECOND_TITLE, { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(leadFont, 'a manchete principal tem peso visual maior').toBeGreaterThan(rowFont);
  const subjects = page.getByRole('list', { name: 'Assuntos em alta', exact: true });
  await expect(subjects.getByTestId('news-topic-tilapia')).toContainText('2 notícias');
  const viewport = page.viewportSize()!;
  if (viewport.width >= 1280) {
    const coverHeading = (await page.getByRole('heading', { name: 'Em destaque', exact: true }).boundingBox())!;
    const subjectsHeading = (await page.getByRole('heading', { name: 'Em alta', exact: true }).boundingBox())!;
    expect(Math.abs(coverHeading.y - subjectsHeading.y), 'destaques e assuntos começam na mesma linha').toBeLessThanOrEqual(4);
    const leadBox = (await lead.boundingBox())!;
    expect(subjectsHeading.x, 'os assuntos ficam ao lado dos destaques').toBeGreaterThan(leadBox.x + leadBox.width);
    const visible = await page.getByTestId(/^news-card-/).evaluateAll(elements => elements.filter(el => {
      const { y, height } = el.getBoundingClientRect();
      return y >= 0 && y + height <= window.innerHeight;
    }).length);
    expect(visible, 'o destaque e outros destaques aparecem antes de rolar, abaixo do pulso').toBeGreaterThanOrEqual(3);
  }
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
  await expect(page.getByRole('region', { name: 'Pulso do radar', exact: true })).toHaveCount(0);
  const more = page.getByRole('button', { name: 'Carregar mais manchetes', exact: true });
  await more.click();
  await expect(page.getByTestId(/^news-card-/)).toHaveCount(30);
  await expect(more).toHaveCount(0);
  const card = page.getByTestId('news-card-10000000-0000-4000-8000-000000000025');
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport();
  const before = (await card.boundingBox())!.y;
  await card.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Cadeia do pescado acompanha pesquisa e mercado 25', exact: true })).toBeVisible();
  await loadedNewsImage(page.locator('[data-ws-stop="main"]'), 25);
  await page.goBack();
  await expect(page).toHaveURL(/\/news$/);
  await expect(search).toHaveValue('a');
  await expect(page.getByTestId(/^news-card-/)).toHaveCount(30);
  await expect(card).toBeFocused();
  await expect(card).toBeInViewport();
  await expect.poll(async () => Math.abs((await card.boundingBox())!.y - before), { message: 'a volta mantém a posição entre as manchetes carregadas' }).toBeLessThan(3);
  await expect(page.locator('[data-ws-stop="footer"]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test('decide na fila sem abrir a notícia e desfaz pela confirmação', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { decisions } = await mockDesk(page);
  const errors = watchErrors(page);
  await page.goto('/news');
  const open = page.getByRole('tab', { name: /^Para decidir/ });
  const decided = page.getByRole('tab', { name: /^Decididas/ });
  await expect(open).toContainText('18');
  // The A1 stories lead the score-ranked cover; use the next A2 item to exercise a wire-row action.
  const row = page.getByTestId('news-card-10000000-0000-4000-8000-000000000011');
  const actions = row.locator('xpath=ancestor::li[1]');
  await actions.getByRole('button', { name: 'Selecionar para redação', exact: true }).click();
  await expect(page.getByText('Notícia selecionada para redação', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  await expect(open).toContainText('17');
  await expect(decided).toContainText('1');
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await expect(row).toBeVisible();
  await expect(open).toContainText('18');
  await actions.getByRole('button', { name: 'Adiar ou descartar', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Fora do mapa editorial', exact: true }).click();
  await expect(page.getByText('Notícia descartada', { exact: true })).toBeVisible();
  await expect(row).toHaveCount(0);
  await decided.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Descartadas', exact: true })).toBeVisible();
  await expect(row).toContainText('Fora do mapa editorial');
  await page.getByTestId('news-card-10000000-0000-4000-8000-000000000011').locator('xpath=ancestor::li[1]')
    .getByRole('button', { name: 'Voltar para a fila', exact: true }).click();
  await expect(page.getByText('De volta à fila', { exact: true })).toBeVisible();
  expect(decisions.map(({ revision, action, reason }) => ({ revision, action, reason }))).toEqual([
    { revision: 0, action: 'select', reason: undefined }, { revision: 1, action: 'restore', reason: undefined },
    { revision: 2, action: 'discard', reason: 'Fora do mapa editorial' }, { revision: 3, action: 'restore', reason: undefined },
  ]);
  for (const decision of decisions.filter(input => input.action !== 'restore')) {
    expect(decision.scoreSnapshot).toMatchObject({ score: expect.any(Number), topic: expect.any(String), mapVersion: expect.any(Number), reasons: expect.any(Array) });
  }
  await expectNoHorizontalOverflow(page);
  await expectHeadingOutline(page);
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

/** "Ver atividade" lives in "Mais ações" at every width. */
async function openActivity(page: Page) {
  await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ver atividade', exact: true }).click();
}

for (const viewport of VIEWPORTS) {
  test.describe(`radar e leitura em ${viewport.width}`, () => {
    test.use(viewport.width === 390 ? { viewport, hasTouch: true, isMobile: true } : { viewport });
    const phone = viewport.width < 768;

    test('abre o radar sem selecionar e só mostra a leitura e a barra de decisão após o clique', async ({ page }) => {
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
      await expect(first).toContainText(FIRST_TITLE);
      await expect(decisions).toHaveCount(0);
      await expect(page.getByText('Parágrafo 1 da notícia 1.', { exact: false })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Chegadas', exact: true })).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Força editorial da fonte', exact: true })).toHaveCount(0);
      const searchBox = (await search.boundingBox())!;
      const pulseBox = (await page.getByRole('region', { name: 'Pulso do radar', exact: true }).boundingBox())!;
      expect(pulseBox.y, 'o pulso vem logo depois da busca').toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
      const overviewWidth = (await article.boundingBox())!.width;
      // Decision shortcuts must not act on a story the person has not opened.
      await page.keyboard.press('c');
      await page.keyboard.press('a');
      await expect(page.getByTestId('news-headlines')).toBeVisible();
      expect(writes).toEqual([]);
      await expectRadar(page);
      await expectNoHorizontalOverflow(page);
      await expectHeadingOutline(page);
      if (viewport.width === 1440 || viewport.width === 709) await page.screenshot({ path: test.info().outputPath(`news-radar-${viewport.width}.png`), animations: 'disabled' });
      const headline = first.getByRole('heading', { name: FIRST_TITLE, exact: true });
      await headline.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await entirelyVisible(page, headline);
      await first.getByRole('button', { name: `Ler notícia: ${FIRST_TITLE}`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/news\\?item=${FIRST}$`));
      await expect(page.getByTestId('news-headlines')).toHaveCount(0);
      await expect(search).toHaveCount(0);
      await expect(page.locator('[data-ws-stop="start"]')).toHaveCount(0);
      const heading = article.getByRole('heading', { name: FIRST_TITLE, exact: true });
      await entirelyVisible(page, heading);
      await entirelyVisible(page, article.getByRole('link', { name: /^Ver original/ }));
      await loadedNewsImage(article, 1);
      await expect(page.getByText('1 de 18', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Notícia anterior', exact: true })).toBeDisabled();
      const back = page.getByRole('navigation', { name: 'Trilha de navegação', exact: true }).getByRole('link', { name: 'Notícias', exact: true });
      await entirelyVisible(page, back);
      await expect(back).toHaveAttribute('href', '/news');
      const choices = phone ? ['Outras ações da notícia', 'Selecionar para redação'] : ['Descartar', 'Adiar', 'Selecionar para redação'];
      for (const name of choices) await entirelyVisible(page, decisions.getByRole('button', { name, exact: true }));
      await entirelyVisible(page, decisions);
      await entirelyVisible(page, article);
      expect((await article.boundingBox())!.width, 'a leitura ocupa toda a largura usada pelo radar').toBeCloseTo(overviewWidth, 0);
      // The received text is expanded on entry, without an additional disclosure click.
      await expect(article.getByText('Parágrafo 1 da notícia 1.', { exact: false })).toBeVisible();
      // Other open stories on the same subject follow the text.
      await expect(article.getByRole('heading', { name: 'Na mesma pauta', exact: true })).toBeVisible();
      await expect(article.getByTestId(`news-card-${SECOND}`)).toBeVisible();
      await article.getByText('Parágrafo 12 da notícia 1.', { exact: false }).scrollIntoViewIfNeeded();
      for (const name of choices) await entirelyVisible(page, decisions.getByRole('button', { name, exact: true }));
      await decisions.getByRole('button', { name: choices[phone ? 0 : 1], exact: true }).click();
      // "Até amanhã cedo" carries its shortcut (A) in the menu of the wide bar.
      for (const name of phone ? [/^Por 2 horas$/, /^Até amanhã cedo$/, /^Fora do mapa editorial$/] : [/^Por 2 horas$/, /^Até amanhã cedo/]) {
        await entirelyVisible(page, page.getByRole('menuitem', { name }));
      }
      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitem', { name: 'Por 2 horas', exact: true })).toHaveCount(0);
      expect(writes, 'consultar as ações não grava decisões').toEqual([]);
      // The next story is one click (or J) away, and the position follows.
      await page.getByRole('button', { name: 'Próxima notícia', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/news\\?item=${SIXTH}$`));
      await expect(page.getByText('2 de 18', { exact: true })).toBeVisible();
      await expect(article.getByRole('heading', { level: 2, name: 'Cadeia do pescado acompanha pesquisa e mercado 6', exact: true })).toBeVisible();
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
      const topic = page.getByTestId('news-topic-tilapia');
      await topic.click();
      await expect(topic).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(2);
      await expect(page.getByRole('region', { name: 'Pulso do radar', exact: true })).toHaveCount(0);
      await first.click();
      await expect(page).toHaveURL(new RegExp(`/news\\?item=${FIRST}$`));
      await expect(page.getByRole('heading', { level: 2, name: FIRST_TITLE, exact: true })).toBeVisible();
      await page.goBack();
      await expect(topic).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(2);
      await page.getByRole('button', { name: 'Ver todas', exact: true }).click();
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(18);
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
      await first.click();
      const article = page.locator('[data-ws-stop="main"]');
      await expect(article.getByRole('heading', { name: FIRST_TITLE, exact: true })).toBeVisible();
      await expect(page.getByTestId('news-headlines')).toHaveCount(0);
      await page.getByRole('navigation', { name: 'Trilha de navegação', exact: true }).getByRole('link', { name: 'Notícias', exact: true }).click();
      await expect(page).toHaveURL(/\/news$/);
      await expect(search).toHaveValue('tilápia');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(1);
      await expect(first).toBeVisible();
      await expect(page.getByRole('group', { name: 'Filtros aplicados', exact: true })).toContainText('Instituto do Pescado');
      await expect(page.getByRole('group', { name: 'Filtros aplicados', exact: true })).toContainText('A1');
      await expect(page.locator('[data-ws-stop="footer"]')).toHaveCount(0);

      await first.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/news\\?item=${FIRST}$`));
      await page.goBack();
      await expect(page).toHaveURL(/\/news$/);
      await expect(search).toHaveValue('tilápia');
      await expect(page.getByTestId(/^news-card-/)).toHaveCount(1);
      await expect(first).toBeFocused();
      await expect(page.locator('[data-ws-stop="footer"]')).toHaveCount(0);

      await openActivity(page);
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


for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`configura coleta web persistente e impede pedidos repetidos em ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockDesk(page);
    let view: NewsSearchView = { configured: true, revision: 0, state: 'idle', usedToday: 0, lastAdded: 0 };
    let manual = 0;
    await page.route('**/api/reporter/news/search', async route => {
      if (route.request().method() === 'POST') {
        const input = route.request().postDataJSON() as NewsSearchWrite;
        expect(input.revision).toBe(view.revision);
        expect(input.config.portalUrl).toBe('https://seafoodbrasil.com.br');
        expect(input.config.topics).toEqual(['Exportação de pescado', 'Sanidade']);
        view = { ...view, revision: view.revision + 1, config: input.config, state: 'queued' };
      }
      await route.fulfill({ json: view });
    });
    await page.route('**/api/reporter/news/search/collect', route => {
      manual++; view = { ...view, state: 'queued' }; return route.fulfill({ json: view });
    });
    const errors = watchErrors(page);
    await page.goto('/news/sources');
    await page.getByRole('button', { name: 'Busca complementar', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Busca complementar', exact: true });
    await dialog.getByRole('textbox', { name: 'Portal cliente', exact: true }).fill('https://seafoodbrasil.com.br');
    await dialog.getByRole('textbox', { name: 'Setor', exact: true }).fill('Pesca e aquicultura');
    await dialog.getByRole('textbox', { name: 'Temas para acompanhar', exact: true }).fill('Exportação de pescado\nSanidade');
    await dialog.getByRole('button', { name: 'Salvar e buscar', exact: true }).click();
    await expect(dialog.getByText('Na fila', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Buscar agora', exact: true })).toBeDisabled();
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
    view = { ...view, state: 'idle', usedToday: 2, lastAdded: 3, lastRunAt: new Date().toISOString() };
    await page.getByRole('button', { name: 'Busca complementar', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Portal cliente', exact: true })).toHaveValue('https://seafoodbrasil.com.br');
    await dialog.getByRole('button', { name: 'Buscar agora', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Buscar agora', exact: true })).toBeDisabled();
    expect(manual).toBe(1);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}
