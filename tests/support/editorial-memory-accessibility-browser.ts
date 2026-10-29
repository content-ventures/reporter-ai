import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export async function auditMemoryAccessibility(page: Page, width: number, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  await writeFile(`/tmp/reporter-memory-a11y-${width}-${label}.json`, JSON.stringify({ url: page.url(), engine: result.testEngine, violations: result.violations, incomplete: result.incomplete }, null, 2));
  await writeFile(`/tmp/reporter-memory-a11y-${width}-${label}.txt`, await page.locator('body').ariaSnapshot());
  assert.deepEqual(result.violations.map(rule => ({ id: rule.id, impact: rule.impact, nodes: rule.nodes.map(node => ({ target: node.target, failure: node.failureSummary })) })), [], `accessibility: ${label}`);
}

const animating = (dialog: Locator) => dialog.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running' || animation.pending));

/** Exercise real pointer/touch and keyboard input while the native entry animation is active. */
export async function probeMemoryImportEntry(page: Page, base: string, width: number, audit: (page: Page, label: string) => Promise<void>) {
  await page.goto(`${base}/w/reporter-ai/quotes`);
  const trigger = page.getByRole('button', { name: 'Importar material', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Importar material', exact: true });
  const select = dialog.getByRole('combobox', { name: 'Tipo', exact: true });
  const kinds = ['Relatório', 'Transcrição', 'Acervo', 'Dados de mercado', 'Notícia', 'Release'];
  let earlyPointer = 0, earlyKeyboard = 0;
  for (let index = 0; index < 12; index++) {
    await trigger.focus(); await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
    if (index % 2 === 0) {
      const box = await select.boundingBox(); assert.ok(box);
      // The measured target is clicked immediately: actionability stability would wait out the very animation under test.
      if (width === 390) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(select).toHaveAttribute('aria-expanded', 'true'); if (await animating(dialog)) earlyPointer++;
    } else {
      await select.focus(); await page.keyboard.press('ArrowDown');
      await expect(select).toHaveAttribute('aria-expanded', 'true'); if (await animating(dialog)) earlyKeyboard++;
    }
    const kind = kinds[index % kinds.length]; await page.getByRole('option', { name: kind, exact: true }).click();
    await expect(select).toContainText(kind); await expect(select).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  }
  assert.ok(earlyPointer > 0 && earlyKeyboard > 0, `the probe must actually overlap entry: pointer=${earlyPointer}, keyboard=${earlyKeyboard}`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await trigger.focus(); await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
    await select.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    await expect(select).toContainText('Transcrição'); assert.equal(await animating(dialog), false, 'reduced-motion import must not animate');
    const close = dialog.getByRole('button', { name: 'Fechar', exact: true }); await close.focus(); await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused(); await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    const title = dialog.getByRole('textbox', { name: 'Título', exact: true }); await title.focus(); await page.keyboard.press('Tab'); await expect(select).toBeFocused();
    await page.keyboard.press('Tab'); await expect(dialog.getByRole('textbox', { name: 'Texto original', exact: true })).toBeFocused();
    await audit(page, 'import-keyboard-reduced-motion');
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
  console.info('memory import entry probe', { width, earlyPointer, earlyKeyboard, cycles: 12 });
}
