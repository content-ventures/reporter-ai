import { expect, test, type Page } from '@playwright/test';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import type { NewsFeed, NewsItem } from '../src/domain/hard-news.ts';
import type { NewsDiscoveryResult } from '../src/domain/news-discovery.ts';
import { GREETING, VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

/**
 * The Hard News (R2) screens in an R1 build: a demonstration on their own routes, with "Demo" in
 * the top bar, that writes nothing to the workspace (no API request but reads) and leaves the R1
 * screens as they are. The image and quote banks read the R1 libraries, and the radar and its
 * sources read the server's news (F2.1), so they carry no "Demo" (connected smoke).
 */
const DEMO_SCREENS = [
  ['/archive', 'Acervo'],
  ['/settings/editorial-map', 'Mapa editorial'],
  ['/settings/writing-guide', 'Guia de escrita'],
  ['/admin/integrations', 'Integrações'],
  ['/admin/integrations/slack', 'Slack'],
  ['/admin/integrations/cms', 'WordPress'],
] as const;

// Keep third-party favicon delivery deterministic; the UI must still render an actual image.
test.beforeEach(async ({ page }) => {
  await page.route('https://www.google.com/s2/favicons?**', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'),
  }));
});

/** Every API request that is not a read. */
function watchWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(`${request.method()} ${pathname}`);
  });
  return writes;
}

for (const viewport of VIEWPORTS) {
  test.describe(`demonstração da R2 em ${viewport.name}`, () => {
    test.use(
      viewport.width < 768
        ? { viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true }
        : { viewport: { width: viewport.width, height: viewport.height } },
    );
    test.beforeEach(async ({ page }) => {
      const checkpoint = emptyEditorialCheckpoint();
      await page.route('**/api/reporter/workspace', (route) => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
    });

    test('as telas da R2 abrem no menu de sempre, sem gravar nada', async ({ page }) => {
      const errors = watchErrors(page);
      const writes = watchWrites(page);
      for (const [path, title] of DEMO_SCREENS) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
        await expect(page.getByText('Demo', { exact: true })).toBeVisible();
        await expectHeadingOutline(page);
        await expectNoHorizontalOverflow(page);
      }
      // The first review URL opens the matching destination.
      await page.goto('/prototypes/r2?screen=archive');
      await expect(page).toHaveURL(/\/archive$/);
      expect(writes, 'escritas na API').toEqual([]);
      expect(errors, 'erros no console').toEqual([]);
    });
  });
}

const AT = new Date().toISOString();
const SOURCE = { id: '6b1f8a8e-2f7c-4d55-9a51-6f0f3f8d7a10', name: 'Peixe BR', url: 'https://www.peixebr.com.br/feed/', everyMinutes: 60, state: 'active', lastReadAt: AT, lastDay: 2, lastWeek: [0, 0, 0, 0, 0, 1, 2], kind: 'rss' };
const STORY = {
  id: '0c2b3d4e-5f60-4718-8a9b-0c1d2e3f4a5b', title: 'Auditoria europeia aproxima Brasil da reabertura das exportações de pescado',
  url: 'https://www.peixebr.com.br/comercializacao/auditoria', source: 'Peixe BR', feedId: SOURCE.id, via: 'rss',
  publishedAt: AT, importedAt: AT, excerpt: 'O relatório preliminar valida o sistema sanitário nacional.', body: ['O relatório preliminar valida o sistema sanitário nacional.'],
  paragraphs: 3, duplicates: [{ source: 'g1.globo.com', url: 'https://g1.globo.com/agro/auditoria', publishedAt: AT }], status: 'new',
};

test('Notícias e Fontes leem o servidor: manchetes primeiro e texto ao abrir; o Início da R1 não muda', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const checkpoint = emptyEditorialCheckpoint();
  const feedStory = { ...STORY, excerpt: 'O relatório preliminar valida o sistema…' };
  await page.route('**/api/reporter/workspace', (route) => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  await page.route('**/api/reporter/news?**', (route) => route.fulfill({ json: { at: AT, sources: [SOURCE], items: [feedStory], rssApp: false } }));
  await page.route('**/api/reporter/news', (route) => route.fulfill({ json: { at: AT, sources: [SOURCE], items: [feedStory], rssApp: false } }));
  let detailReads = 0;
  await page.route(`**/api/reporter/news/items/${STORY.id}`, (route) => {
    detailReads += 1;
    return route.fulfill({ json: { item: { ...feedStory, paragraphs: undefined, body: [...STORY.body, 'Nenhuma recomendação foi apontada.', 'A decisão final sai em novembro.'] } } });
  });
  const errors = watchErrors(page);
  const writes = watchWrites(page);
  await page.goto('/news');
  await expect(page.getByRole('heading', { level: 1, name: 'Radar de notícias', exact: true })).toBeVisible();
  await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
  const headline = page.getByTestId(`news-card-${STORY.id}`);
  await expect(headline.getByRole('heading', { name: `Ler notícia: ${STORY.title}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Selecionar para redação', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-ws-stop="footer"]')).toHaveCount(0);
  expect(detailReads, 'a manchete não carrega o texto antes de ser aberta').toBe(0);
  await headline.click();
  await expect(page).toHaveURL(new RegExp(`/news\\?item=${STORY.id}$`));
  await expect(page.getByRole('heading', { level: 2, name: STORY.title })).toBeVisible();
  await expect(page.getByRole('img', { name: SOURCE.name, exact: true }).locator('img')).toHaveAttribute('src', /peixebr\.com\.br/);
  await expect.poll(() => page.getByRole('img', { name: SOURCE.name, exact: true }).locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  // No AI triage yet: the connected desk offers selection without starting research or drafting.
  await expect(page.getByRole('heading', { name: 'Cobrir agora' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cobrir', exact: true })).toHaveCount(0);
  await expect(page.getByText('2 veículos').first()).toBeVisible();
  await expect(page.getByText('A decisão final sai em novembro.')).toBeVisible();
  await expect(page.getByText(feedStory.excerpt, { exact: true })).toHaveCount(0);
  await expect(page.getByText(STORY.body[0], { exact: true })).toHaveCount(1);
  expect(detailReads).toBeGreaterThan(0);
  await expectHeadingOutline(page);

  await page.goto('/news/sources');
  await expect(page.getByRole('heading', { level: 1, name: 'Fontes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Peixe BR' })).toBeVisible();
  await expect(page.getByRole('img', { name: SOURCE.name, exact: true }).locator('img')).toHaveAttribute('src', /peixebr\.com\.br/);
  await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);

  await page.goto('/admin/integrations/rss-app');
  await expect(page.getByRole('heading', { level: 1, name: 'RSS.app', exact: true })).toBeVisible();
  await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Início', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: GREETING })).toBeVisible();
  await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pauta do dia' })).toHaveCount(0);
  expect(writes, 'escritas na API').toEqual([]);
  expect(errors, 'erros no console').toEqual([]);
});

for (const viewport of VIEWPORTS) {
  test.describe(`tradução das notícias em ${viewport.name}`, () => {
    test.use(viewport.width < 768
      ? { viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true }
      : { viewport: { width: viewport.width, height: viewport.height } });

    test('mostra a tradução, mantém o original acessível e identifica estados incompletos', async ({ page }) => {
      await page.clock.install();
      const checkpoint = emptyEditorialCheckpoint();
      const errors = watchErrors(page);
      const translated: NewsItem = {
        ...STORY, status: 'new', via: 'rss', paragraphs: undefined, duplicates: [], source: 'The Fish Site',
        title: 'Pesquisa amplia a produção sustentável de peixes', excerpt: 'Pesquisadores desenvolveram um novo método de cultivo.',
        body: ['O estudo reduziu o consumo de água nas fazendas de peixes.'], contentKind: 'feed',
        url: 'https://thefishsite.com/articles/sustainable-fish-production',
        translation: { status: 'translated', sourceLanguage: 'en', targetLanguage: 'pt-BR' },
      };
      const native: NewsItem = {
        ...STORY, id: '0c2b3d4e-5f60-4718-8a9b-0c1d2e3f4a61', status: 'new', via: 'rss', paragraphs: undefined, duplicates: [],
        translation: { status: 'original', sourceLanguage: 'pt-BR', targetLanguage: 'pt-BR' },
      };
      const pending: NewsItem = {
        ...translated, id: '0c2b3d4e-5f60-4718-8a9b-0c1d2e3f4a62', title: 'Fish farms reduce water usage',
        excerpt: 'Researchers tested a new system.', body: ['The study followed fish farms for twelve months.'],
        translation: { status: 'pending', sourceLanguage: 'en', targetLanguage: 'pt-BR' },
      };
      const failed: NewsItem = { ...pending, id: '0c2b3d4e-5f60-4718-8a9b-0c1d2e3f4a63', translation: { status: 'failed', sourceLanguage: 'en', targetLanguage: 'pt-BR', error: 'Provider temporarily unavailable' } };
      const items = [translated, native, pending, failed];
      let retries = 0;
      await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
      await page.route('**/api/reporter/news**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith(`/${failed.id}/translation/retry`)) {
          expect(route.request().method()).toBe('POST');
          retries += 1;
          items[3] = { ...translated, id: failed.id, url: failed.url };
          return route.fulfill({ json: { ...failed, translation: { status: 'pending', targetLanguage: 'pt-BR' } } });
        }
        if (path.includes('/items/')) return route.fulfill({ json: { item: items.find(item => path.endsWith(`/${item.id}`)) } });
        return route.fulfill({ json: { at: AT, sources: [SOURCE], items: items.map(item => ({ ...item, body: [], paragraphs: item.body.length })), rssApp: false } });
      });

      await page.goto(`/news?item=${translated.id}`);
      await expect(page.getByRole('heading', { level: 2, name: translated.title, exact: true })).toBeVisible();
      await expect(page.getByText(translated.excerpt, { exact: true })).toBeVisible();
      await expect(page.getByText('Tradução automática · pt-BR', { exact: true })).toBeVisible();
      const original = page.getByRole('link', { name: 'Ver original (abre em nova aba)', exact: true });
      await expect(original).toHaveAttribute('href', translated.url);
      await expect(original).toHaveAttribute('target', '_blank');
      await expect(original).toHaveAttribute('rel', /noopener/);
      await expect(page.getByText(translated.body[0], { exact: true })).toBeVisible();
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);

      await page.goto(`/news?item=${native.id}`);
      await expect(page.getByRole('heading', { level: 2, name: native.title, exact: true })).toBeVisible();
      await expect(page.getByText('Tradução automática · pt-BR', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Tentar tradução novamente', exact: true })).toHaveCount(0);

      await page.goto(`/news?item=${pending.id}`);
      await expect(page.getByText('Preparando tradução · exibindo original', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Ver original (abre em nova aba)', exact: true })).toHaveAttribute('href', pending.url);

      await page.goto(`/news?item=${failed.id}`);
      await expect(page.getByText('Tradução indisponível', { exact: true })).toBeVisible();
      await expect(page.getByText('Exibindo o texto original.', { exact: true })).toBeVisible();
      await expect(page.getByText('Provider temporarily unavailable', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Tentar tradução novamente', exact: true }).click();
      await expect(page.getByText('Preparando tradução · exibindo original', { exact: true })).toBeVisible();
      // Retry only queues the job. The next regular polling cycle brings the translated article.
      await page.clock.fastForward(60_000);
      await expect(page.getByText('Tradução automática · pt-BR', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: translated.title, exact: true })).toBeVisible();
      await expect(page.getByText(translated.body[0], { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Tentar tradução novamente', exact: true })).toHaveCount(0);
      expect(retries).toBe(1);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`descoberta de fontes em ${viewport.name}`, () => {
    test.use(viewport.width < 768
      ? { viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true }
      : { viewport: { width: viewport.width, height: viewport.height } });

    test('confirma feeds, coleta a seleção e repete só a leitura que falhou', async ({ page }) => {
      const checkpoint = emptyEditorialCheckpoint();
      const errors = watchErrors(page);
      const sources: NewsFeed[] = [];
      const items: NewsItem[] = [];
      const created: string[] = [], retried: string[] = [];
      const secondId = '6b1f8a8e-2f7c-4d55-9a51-6f0f3f8d7a11';
      const secondStory: NewsItem = { ...STORY, status: 'new', via: 'rss', id: '0c2b3d4e-5f60-4718-8a9b-0c1d2e3f4a5c', title: 'Nova pesquisa amplia a produção de pescado', source: 'Agência Brasil', feedId: secondId, url: 'https://agenciabrasil.ebc.com.br/pesquisa' };
      const discovery: NewsDiscoveryResult = {
        context: { portal: { url: 'https://www.seafoodbrasil.com.br', title: 'Seafood Brasil' }, sector: 'pesca e aquicultura', region: 'Brasil' }, queries: ['pesca e aquicultura Brasil notícias'], checkedAt: AT,
        suggestions: [
          { id: 'peixebr', name: SOURCE.name, site: 'https://www.peixebr.com.br', status: 'verified', feedUrl: SOURCE.url,
            reason: 'Publica notícias do setor de pescado.', evidence: { url: STORY.url, title: STORY.title, excerpt: STORY.excerpt },
            sample: [{ title: STORY.title, url: STORY.url, publishedAt: AT }], recentItems: 2 },
          { id: 'research', name: secondStory.source, site: 'https://agenciabrasil.ebc.com.br', status: 'verified', feedUrl: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
            reason: 'Acompanha pesquisas sobre aquicultura.', evidence: { url: 'https://agenciabrasil.ebc.com.br/noticias', title: 'Agência Brasil', excerpt: 'Pesquisas recentes.' },
            sample: [{ title: secondStory.title, url: 'https://agenciabrasil.ebc.com.br/pesquisa' }], recentItems: 1 },
          { id: 'unverified', name: 'Portal sem feed', site: 'https://sem-feed.example', status: 'no-feed',
            reason: 'Foi encontrado na busca do setor.', evidence: { url: 'https://sem-feed.example', title: 'Portal sem feed', excerpt: 'Notícias.' },
            sample: [], recentItems: 0, issue: 'Não foi possível confirmar um feed público.' },
        ],
      };
      await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
      await page.route('**/api/reporter/news**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/discover')) {
          expect(route.request().postDataJSON()).toEqual({ portalUrl: 'https://www.seafoodbrasil.com.br', sector: 'pesca e aquicultura', region: 'Brasil' });
          return route.fulfill({ json: discovery });
        }
        if (path.endsWith('/sources')) {
          const input = route.request().postDataJSON() as { url: string; name: string };
          created.push(input.url);
          const first = input.url === SOURCE.url;
          const source: NewsFeed = first ? { ...SOURCE, state: 'active', kind: 'rss' }
            : { ...SOURCE, id: secondId, name: secondStory.source, url: input.url, state: 'failing', kind: 'rss', lastDay: 0, lastError: 'O site demorou para responder.' };
          sources.push(source);
          if (first) items.push({ ...STORY, status: 'new', via: 'rss' });
          return route.fulfill({ json: { source, inserted: first ? 1 : 0, grouped: 0 } });
        }
        if (path.endsWith('/read')) {
          retried.push(path);
          const source = sources.find(source => source.id === secondId)!;
          source.state = 'active'; delete source.lastError;
          items.push(secondStory);
          return route.fulfill({ json: { source, inserted: 1, grouped: 0 } });
        }
        if (path.includes('/items/')) return route.fulfill({ json: { item: items.find(item => path.endsWith(`/${item.id}`)) } });
        return route.fulfill({ json: { at: AT, sources, items, rssApp: false } });
      });
      await page.goto('/news');
      await page.getByRole('button', { name: 'Descobrir fontes', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Descobrir fontes', exact: true });
      await dialog.getByLabel('Site do seu veículo (contexto)').fill('https://www.seafoodbrasil.com.br');
      await dialog.getByLabel('Setor ou tema').fill('pesca e aquicultura');
      await dialog.getByRole('button', { name: 'Buscar fontes', exact: true }).click();
      await expect(dialog.getByRole('checkbox', { name: `Selecionar ${SOURCE.name}`, exact: true })).not.toBeChecked();
      await expect(dialog.getByRole('checkbox', { name: 'Selecionar Seafood Brasil', exact: true })).toHaveCount(0);
      const sourceLogo = dialog.locator('img[src*="peixebr.com.br"]');
      await expect(sourceLogo).toBeVisible();
      await expect.poll(() => sourceLogo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await expect(dialog.getByRole('button', { name: 'Adicionar fontes', exact: true })).toBeDisabled();
      await dialog.getByRole('checkbox', { name: `Selecionar ${SOURCE.name}`, exact: true }).check();
      await dialog.getByRole('checkbox', { name: `Selecionar ${secondStory.source}`, exact: true }).check();
      await expect(dialog.getByRole('checkbox', { name: 'Selecionar Portal sem feed', exact: true })).toHaveCount(0);
      await expect(dialog.getByText('Data não informada', { exact: true })).toBeVisible();
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await dialog.getByRole('button', { name: 'Adicionar 2 fontes', exact: true }).click();
      await expect(dialog.getByText('1 notícia nova', { exact: true })).toBeVisible();
      await expect(dialog.getByText('O site demorou para responder.', { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Tentar fontes com falha', exact: true }).click();
      await expect(dialog.getByText('2 de 2 fontes prontas', { exact: true })).toBeVisible();
      expect(created).toEqual([SOURCE.url, 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml']);
      expect(retried).toEqual([`/api/reporter/news/sources/${secondId}/read`]);
      await dialog.getByRole('button', { name: 'Ir para notícias', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId(`news-card-${secondStory.id}`)).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}

test('notícia fora da janela do radar abre pelo link e a seleção permanece ao recarregar', async ({ page }) => {
  const checkpoint = emptyEditorialCheckpoint();
  let linked: NewsItem = { ...STORY, via: 'rss', status: 'new', decisionRevision: 0 };
  const writes: unknown[] = [];
  await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  await page.route('**/api/reporter/news**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/decision')) {
      writes.push(route.request().postDataJSON());
      linked = { ...linked, status: 'selected', decisionRevision: 1, decidedAt: AT, decidedBy: 'Editor' };
      return route.fulfill({ json: linked });
    }
    if (path.includes('/items/')) return route.fulfill({ json: { item: linked } });
    return route.fulfill({ json: { at: AT, sources: [{ ...SOURCE, state: 'active' }], items: [], rssApp: false } });
  });
  await page.goto(`/news?item=${linked.id}`);
  await expect(page.getByRole('heading', { level: 2, name: linked.title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Selecionar para redação', exact: true }).click();
  await expect(page.locator('[data-ws-stop="footer"]').getByText('Selecionada para redação', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voltar para a fila', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 2, name: linked.title, exact: true })).toBeVisible();
  await expect(page.locator('[data-ws-stop="footer"]').getByText('Selecionada para redação', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voltar para a fila', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Selecionar para redação', exact: true })).toHaveCount(0);
  expect(writes).toEqual([{ revision: 0, action: 'select' }]);
});

test('falha de leitura e busca indisponível não aparecem como uma lista vazia', async ({ page }) => {
  const checkpoint = emptyEditorialCheckpoint();
  let snapshotFails = true, discoveryFails = true;
  await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  await page.route('**/api/reporter/news**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/discover')) {
      return discoveryFails ? route.fulfill({ status: 503, json: { error: 'TAVILY_KEY_MISSING', message: 'Integração de busca não configurada.' } })
        : route.fulfill({ json: { context: { sector: 'aquicultura' }, queries: [], checkedAt: AT, suggestions: [] } });
    }
    return snapshotFails ? route.fulfill({ status: 503, json: { error: 'UNAVAILABLE', message: 'Não foi possível ler as notícias.' } })
      : route.fulfill({ json: { at: AT, sources: [], items: [], rssApp: false } });
  });
  await page.goto('/news');
  await expect(page.getByText('Não foi possível carregar as notícias', { exact: true })).toBeVisible();
  await expect(page.getByText('Nenhuma fonte cadastrada', { exact: true })).toHaveCount(0);
  snapshotFails = false;
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
  await page.getByRole('button', { name: 'Descobrir fontes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Descobrir fontes', exact: true });
  await dialog.getByLabel('Setor ou tema').fill('aquicultura');
  await dialog.getByRole('button', { name: 'Buscar fontes', exact: true }).click();
  await expect(dialog.getByText('A busca de fontes ainda não está conectada.', { exact: false })).toBeVisible();
  await expect(dialog.getByText('Nenhuma fonte encontrada', { exact: true })).toHaveCount(0);
  discoveryFails = false;
  await dialog.getByRole('button', { name: 'Buscar fontes', exact: true }).click();
  await expect(dialog.getByText('Nenhuma fonte encontrada', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Adicionar fontes', exact: true })).toBeDisabled();
});
