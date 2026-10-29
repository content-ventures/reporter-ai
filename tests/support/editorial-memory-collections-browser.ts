import assert from 'node:assert/strict';
import { expect, type Page } from '@playwright/test';
import type { MemoryMaterial, MemoryPage, MemorySelection } from '../../src/domain/editorial-memory.ts';

/** Real signed cursors and actual rendered rows, including reload and an unusable address. */
export async function inspectMemoryCollectionPages(page: Page, base: string, kind: 'materials' | 'selections', audit: (page: Page, label: string) => Promise<void>) {
  const title = kind === 'materials' ? 'Materiais' : 'Seleções salvas', pages = kind === 'materials' ? 'Páginas de materiais' : 'Páginas de seleções';
  const table = page.getByRole('table', { name: title, exact: true });
  const ids = () => table.locator('[data-key]').evaluateAll(rows => rows.map(row => row.getAttribute('data-key')));
  const read = async (cursor: string | null, action: () => Promise<unknown>) => {
    const pending = page.waitForResponse(reply => {
      const url = new URL(reply.url());
      return reply.request().method() === 'GET' && url.pathname.endsWith(`/memory/${kind}`) && url.searchParams.get('cursor') === cursor;
    });
    await action(); const reply = await pending; assert.equal(reply.status(), 200, await reply.text());
    const result = await reply.json() as MemoryPage<MemoryMaterial | MemorySelection>;
    await expect.poll(ids).toEqual(result.items.map(item => item.id)); return result;
  };
  const first = await read(null, () => page.goto(`${base}/w/reporter-ai/quotes?bankView=${kind}`));
  assert.equal(first.items.length, 25); assert.ok(first.nextCursor); assert.ok(first.total > 25);
  const second = await read(first.nextCursor, () => page.getByRole('group', { name: pages, exact: true }).getByRole('button', { name: 'Próxima', exact: true }).click());
  await page.waitForURL(url => url.searchParams.get('cursor') === first.nextCursor);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, first.items.length + second.items.length);
  const saved = page.url(); await read(first.nextCursor, () => page.reload()); assert.equal(page.url(), saved);
  const row = table.locator('[data-key]').first(); await row.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: kind === 'materials' ? (second.items[0] as MemoryMaterial).title : 'Escrever com a seleção', exact: true });
  await expect(dialog).toBeVisible(); await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(row).toBeFocused();
  assert.equal(page.url(), saved); await expect.poll(ids).toEqual(second.items.map(item => item.id));
  await page.goBack(); await page.waitForURL(url => !url.searchParams.has('cursor')); await expect.poll(ids).toEqual(first.items.map(item => item.id));
  await page.goForward(); await page.waitForURL(url => url.searchParams.get('cursor') === first.nextCursor); await expect.poll(ids).toEqual(second.items.map(item => item.id));
  await audit(page, `${kind}-recovered-page`);
  await read(null, () => page.getByRole('group', { name: pages, exact: true }).getByRole('button', { name: 'Primeira página', exact: true }).click());
  await page.waitForURL(url => !url.searchParams.has('cursor'));
  await page.goto(`${base}/w/reporter-ai/quotes?bankView=${kind}&cursor=invalid-collection-cursor`);
  const recover = page.getByRole('button', { name: kind === 'materials' ? 'Atualizar materiais' : 'Atualizar seleções', exact: true });
  await expect(recover).toBeVisible(); await read(null, () => recover.click());
  await page.waitForURL(url => !url.searchParams.has('cursor')); await audit(page, `${kind}-invalid-page-recovered`);
}
