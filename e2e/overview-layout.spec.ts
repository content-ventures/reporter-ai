import { expect, test } from '@playwright/test';
import { createFixtures, fixtureSeed } from '../src/fixtures/index.ts';
import { normalizeSeed } from '../src/adapters/local/store/state.ts';
import { GREETING, VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

for (const viewport of VIEWPORTS) {
  test.describe(`overview layout at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });
    for (const empty of [false, true]) {
      test(empty ? 'empty workspace offers creation' : 'greeting, stages, resume cards, recent table and pending actions', async ({ page }) => {
        const errors = watchErrors(page);
        const fixtures = createFixtures({ now: '2026-10-15T17:00:00.000Z', empty });
        const state = normalizeSeed(fixtureSeed(fixtures));
        // This layout test covers the supported no-cover state without fetching fixture assets.
        for (const production of state.productions) {
          for (const piece of production.pieces) {
            if (piece.draft.body.type === 'article') {
              delete piece.draft.body.cover;
              piece.draft.body.blocks = piece.draft.body.blocks.filter(block => block.type !== 'figure');
            }
          }
        }
        await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
        await page.goto('/');
        await expect(page.getByRole('heading', { name: GREETING, level: 1 })).toBeVisible();
        await expect(page.getByRole('heading', { name: empty ? 'Sua próxima história começa aqui' : 'Continuar de onde parou' })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Precisa de você', exact: true })).toBeVisible();
        if (!empty) {
          const recent = page.getByRole('region', { name: 'Produções recentes', exact: true });
          await expect(recent.getByRole('link', { name: 'Ver todas' })).toHaveAttribute('href', '/productions');
          const resume = page.getByRole('article', { name: /^Continuar:/ }).first();
          await expect(resume.getByRole('link', { name: /^Continuar:/ })).toHaveAttribute('href', /\/productions\/.+\/article$/);
          await expect(page.getByRole('region', { name: 'Produções por etapa', exact: true }).getByRole('link')).toHaveCount(5);
          await expect(page.getByRole('list', { name: 'Precisa de você', exact: true })).toContainText('Casa Forma');
          await page.getByRole('radio', { name: '30 dias' }).click();
          await expect(page).toHaveURL(/range=30d/);
        }
        await expectHeadingOutline(page);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: test.info().outputPath('overview.png'), fullPage: true });
        expect(errors).toEqual([]);
      });
    }
  });
}
