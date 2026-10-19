import { expect, test, type Page } from '@playwright/test';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
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
const SOURCE = { id: '6b1f8a8e-2f7c-4d55-9a51-6f0f3f8d7a10', name: 'Seafood Brasil', url: 'https://www.seafoodbrasil.com.br/feed/', everyMinutes: 60, state: 'active', lastReadAt: AT, lastDay: 2, lastWeek: [0, 0, 0, 0, 0, 1, 2], kind: 'rss' };
const STORY = {
  id: '0c2b3d4e-5f60-4718-8a9b-0c1d2e3f4a5b', title: 'Auditoria europeia aproxima Brasil da reabertura das exportações de pescado',
  url: 'https://www.seafoodbrasil.com.br/comercializacao/auditoria', source: 'Seafood Brasil', feedId: SOURCE.id, via: 'rss',
  publishedAt: AT, importedAt: AT, excerpt: 'O relatório preliminar valida o sistema sanitário nacional.', body: ['O relatório preliminar valida o sistema sanitário nacional.'],
  paragraphs: 3, duplicates: [{ source: 'g1.globo.com', url: 'https://g1.globo.com/agro/auditoria', publishedAt: AT }], status: 'new',
};

test('Notícias e Fontes leem o servidor: sem Demo, sem triagem, texto sob demanda; o Início da R1 não muda', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const checkpoint = emptyEditorialCheckpoint();
  await page.route('**/api/reporter/workspace', (route) => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  await page.route('**/api/reporter/news?**', (route) => route.fulfill({ json: { at: AT, sources: [SOURCE], items: [STORY], rssApp: false } }));
  await page.route('**/api/reporter/news', (route) => route.fulfill({ json: { at: AT, sources: [SOURCE], items: [STORY], rssApp: false } }));
  await page.route(`**/api/reporter/news/items/${STORY.id}`, (route) => route.fulfill({ json: { item: { ...STORY, paragraphs: undefined, body: [...STORY.body, 'Nenhuma recomendação foi apontada.', 'A decisão final sai em novembro.'] } } }));
  const errors = watchErrors(page);
  const writes = watchWrites(page);
  await page.goto('/news');
  await expect(page.getByRole('heading', { level: 1, name: 'Notícias', exact: true })).toBeVisible();
  await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: STORY.title })).toBeVisible();
  // No triage yet: no "Cobrir agora", no AI reading, no decisions.
  await expect(page.getByRole('heading', { name: 'Cobrir agora' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cobrir', exact: true })).toHaveCount(0);
  await expect(page.getByText('2 veículos').first()).toBeVisible();
  await page.getByText('Texto original', { exact: true }).click();
  await expect(page.getByText('A decisão final sai em novembro.')).toBeVisible();
  await expectHeadingOutline(page);

  await page.goto('/news/sources');
  await expect(page.getByRole('heading', { level: 1, name: 'Fontes', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Seafood Brasil' })).toBeVisible();
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
