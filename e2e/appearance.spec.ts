import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { expectNoHorizontalOverflow, watchErrors } from './support';

for (const theme of ['light', 'dark'] as const) {
  for (const system of ['light', 'dark'] as const) {
    test(`the ${theme} logo stays legible with a ${system} operating system`, async ({ page }, testInfo) => {
      const errors = watchErrors(page);
      await page.emulateMedia({ colorScheme: system });
      await page.goto('/productions/new');
      await page.getByRole('button', { name: /Menu da conta/ }).click();
      await page.getByRole('menuitemradio', { name: theme === 'dark' ? 'Usar tema escuro' : 'Usar tema claro' }).click();
      await expect(page.getByRole('menu', { name: 'Conta', exact: true })).toBeHidden();
      await expect(page.locator('[data-ds-v3]').first()).toHaveAttribute('data-color-scheme', theme);

      const logo = page.getByRole('link', { name: 'Reporter IA — Início', exact: true }).getByRole('img');
      await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
      const pixels = await sharp(await logo.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let visibleLetters = 0;
      // Read the rendered wordmark, excluding the blue R and the surrounding transparent area.
      for (let y = 0; y < pixels.info.height; y++) {
        for (let x = Math.ceil(pixels.info.width * 0.3); x < pixels.info.width; x++) {
          const offset = (y * pixels.info.width + x) * pixels.info.channels;
          const [r, g, b] = pixels.data.subarray(offset, offset + 3);
          const neutral = Math.max(r, g, b) - Math.min(r, g, b) < 24;
          if (neutral && (theme === 'dark' ? Math.min(r, g, b) > 190 : Math.max(r, g, b) < 90)) visibleLetters++;
        }
      }
      expect(visibleLetters, 'visible lettering in the actual logo pixels').toBeGreaterThan(80);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${system}-desktop.png`) });
      await page.reload();
      await expect(page.locator('[data-ds-v3]').first()).toHaveAttribute('data-color-scheme', theme);
      await page.setViewportSize({ width: 390, height: 844 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-${system}-mobile.png`) });
      expect(errors).toEqual([]);
    });
  }
}

test('saved dark appearance renders before client JavaScript runs', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, colorScheme: 'light' });
  await context.addCookies([{ name: 'reporter-appearance', value: 'dark', url: baseURL! }]);
  const page = await context.newPage();
  await page.goto('/auth/sign-in');
  await expect(page.locator('[data-ds-v3]').first()).toHaveAttribute('data-color-scheme', 'dark');
  await context.close();
});

test('the previous browser preference migrates without being replaced by the server fallback', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('reporter:appearance', 'dark'));
  await page.goto('/productions/new');
  await expect(page.locator('[data-ds-v3]').first()).toHaveAttribute('data-color-scheme', 'dark');
  await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === 'reporter-appearance')?.value).toBe('dark');
  await page.getByRole('button', { name: /Menu da conta/ }).click();
  await page.getByRole('menuitemradio', { name: 'Usar tema do sistema' }).click();
  await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === 'reporter-appearance')?.value).toBe('system');
});
