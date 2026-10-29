import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { auditMemoryAccessibility } from './editorial-memory-accessibility-browser.ts';

export async function exerciseMemoryLocationBrowser(base: string, width: number, excerpt: string, dispatch: (request: Request) => Promise<Response>) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390, locale: 'pt-BR' });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await context.route('**/api/reporter/**', async route => {
    const original = route.request(), method = original.method();
    const response = await dispatch(new Request(original.url(), { method, headers: original.headers(), ...(method === 'GET' || method === 'HEAD' ? {} : { body: original.postData() }) }));
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  try {
    await page.goto(`${base}/w/reporter-ai/quotes?bankView=citation`);
    const row = page.getByRole('row', { name: excerpt.slice(0, 80), exact: true }); await row.focus(); await page.keyboard.press('Enter');
    const detail = page.getByRole('dialog', { name: 'Evidência', exact: true }); await expect(detail).toBeVisible();
    const button = detail.getByRole('button', { name: 'Localizar no arquivo', exact: true }); await button.focus(); await page.keyboard.press('Enter');
    await expect(detail.getByText('Acervo — março.csv', { exact: true })).toBeVisible();
    await expect(detail.getByText('1, 2, 3, 4, 5', { exact: true })).toBeVisible();
    await expect(detail.getByText('Localização encontrada.', { exact: true })).toBeAttached();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
    await page.screenshot({ path: `/tmp/reporter-memory-location-${width}.png`, fullPage: true, animations: 'disabled' });
    await auditMemoryAccessibility(page, width, 'evidence-original-location');
    await page.keyboard.press('Escape'); await expect(detail).toBeHidden(); await expect(row).toBeFocused();
    await row.click(); await expect(detail.getByRole('button', { name: 'Localizar no arquivo', exact: true })).toBeVisible();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
