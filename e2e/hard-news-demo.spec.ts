import { expect, test, type Page } from '@playwright/test';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { GREETING, VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

/**
 * The Hard News (R2) screens in an R1 build: a demonstration on their own routes, with "Demo" in
 * the top bar, that writes nothing to the workspace (no API request but reads) and leaves the R1
 * screens as they are. The image and quote banks read the R1 libraries (connected smoke).
 */
const DEMO_SCREENS = [
  ['/news', 'Notícias'],
  ['/news/sources', 'Fontes'],
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

test('no radar, Cobrir diz por que não abre pauta; o Início da R1 não muda', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const checkpoint = emptyEditorialCheckpoint();
  await page.route('**/api/reporter/workspace', (route) => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  const errors = watchErrors(page);
  const writes = watchWrites(page);
  await page.goto('/news');
  await expect(page.getByRole('button', { name: 'Cobrir', exact: true })).toBeDisabled();
  await expect(page.getByText('Na demonstração, Cobrir não abre pauta.')).toBeVisible();
  // A story the example marks as covered has no production to open.
  await page.getByRole('tab', { name: /^Decididas/ }).click();
  await page.getByRole('list', { name: 'Decididas' }).getByRole('button', { name: /^Porto de Itajaí registra recorde/ }).click();
  await expect(page.getByRole('button', { name: 'Abrir apuração', exact: true })).toBeDisabled();
  await expect(page.getByText('Na demonstração, a apuração não abre.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Voltar para a fila', exact: true })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: 'Início', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: GREETING })).toBeVisible();
  await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Pauta do dia' })).toHaveCount(0);
  expect(writes, 'escritas na API').toEqual([]);
  expect(errors, 'erros no console').toEqual([]);
});
