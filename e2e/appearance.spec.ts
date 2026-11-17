import { expect, test, type Locator } from '@playwright/test';
import sharp from 'sharp';
import { expectNoHorizontalOverflow, watchErrors } from './support';

/** Measure the label against its actual composited surface, including translucent ancestors. */
async function groupLabelContrast(group: Locator) {
  return group.evaluate(element => {
    const label = document.getElementById(element.getAttribute('aria-labelledby')!);
    if (!label) throw new Error('The group has no accessible label');
    const rgba = (value: string) => {
      const channels = value.match(/[\d.]+/g)!.map(Number);
      return [...channels.slice(0, 3), channels[3] ?? 1];
    };
    const ancestors: Element[] = [];
    for (let node: Element | null = label; node; node = node.parentElement) ancestors.unshift(node);
    let background = [255, 255, 255];
    for (const node of ancestors) {
      const color = rgba(getComputedStyle(node).backgroundColor);
      background = background.map((channel, index) => color[index] * color[3] + channel * (1 - color[3]));
    }
    const luminance = (color: number[]) => color.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = luminance(rgba(getComputedStyle(label).color));
    const surface = luminance(background);
    return { contrast: (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05), surface };
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`grouped pending actions and delivery remain legible in ${theme} at ${width}px`, async ({ page, context, baseURL }, testInfo) => {
      const errors = watchErrors(page);
      await context.addCookies([{ name: 'reporter-appearance', value: theme, url: baseURL! }]);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const route of ['/', '/productions/prod-bella-passo/delivery']) {
        await page.goto(route);
        await expect(page.locator('[data-ds-v3]').first()).toHaveAttribute('data-color-scheme', theme);
        const section = page.getByRole('region', { name: route === '/' ? 'Precisa de você' : 'Arquivos do pacote', exact: true });
        const group = section.getByRole('group', { name: route === '/' ? 'Devolvidos para ajuste' : 'Artigo', exact: true });
        await expect(group).toBeVisible();
        await expect(group.getByRole('list')).toBeVisible();
        if (route === '/') await expect(group).toContainText('Casa Forma');
        else await expect(group.getByRole('link', { name: /^Baixar artigo-v\d+\.md$/ })).toBeVisible();
        for (const item of await section.getByRole('group').all()) {
          const measured = await groupLabelContrast(item);
          expect(measured.contrast, 'normal-size group labels meet AA contrast').toBeGreaterThanOrEqual(4.5);
          if (theme === 'dark') expect(measured.surface, 'group headings use a dark surface').toBeLessThan(0.15);
        }
        await expectNoHorizontalOverflow(page);
        await group.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`${route === '/' ? 'pending' : 'delivery'}-${theme}-${width}.png`), fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
}

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
