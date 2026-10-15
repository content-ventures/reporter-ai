import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { expect, test } from '@playwright/test';
import { VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

for (const viewport of VIEWPORTS) {
  test.describe(`account at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });

    test('opens from the account menu and persists the sidebar preference', async ({ page }) => {
      const errors = watchErrors(page);
      const checkpoint = emptyEditorialCheckpoint();
      await page.route('**/api/reporter/workspace', route => route.fulfill({ json: {
        state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true,
      } }));
      await page.goto('/');
      if (viewport.width < 768) await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
      await page.getByRole('button', { name: /Menu da conta/ }).click();
      await page.getByRole('menuitem', { name: 'Meu perfil', exact: true }).click();
      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByRole('heading', { name: 'Meu perfil', exact: true })).toBeVisible();
      await expect(page.getByText('Workspace', { exact: true })).toBeVisible();
      await expect(page.getByText('Permissões', { exact: true })).toBeVisible();
      const preference = page.getByRole('switch', { name: 'Menu lateral recolhido', exact: true });
      await preference.click();
      await expect(preference).toBeChecked();
      await page.reload();
      await expect(preference).toBeChecked();
      await preference.click();
      await expect(preference).not.toBeChecked();
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('account.png'), fullPage: true });
      expect(errors).toEqual([]);
    });
  });
}
