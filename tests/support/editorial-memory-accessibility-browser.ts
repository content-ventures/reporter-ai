import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export async function auditMemoryAccessibility(page: Page, width: number, label: string) {
  const result = await new AxeBuilder({ page }).analyze();
  const tabContrast = result.incomplete.some(rule => rule.id === 'color-contrast') ? await measureTabContrast(page) : [];
  await writeFile(`/tmp/reporter-memory-a11y-${width}-${label}.json`, JSON.stringify({ url: page.url(), engine: result.testEngine, violations: result.violations, incomplete: result.incomplete, tabContrast }, null, 2));
  await writeFile(`/tmp/reporter-memory-a11y-${width}-${label}.txt`, await page.locator('body').ariaSnapshot());
  assert.deepEqual(result.violations.map(rule => ({ id: rule.id, impact: rule.impact, nodes: rule.nodes.map(node => ({ target: node.target, failure: node.failureSummary })) })), [], `accessibility: ${label}`);
  assert.deepEqual(tabContrast.filter(sample => !sample.hiddenSizingTwin || sample.ratio === null || sample.ratio < 4.5), [], `tab contrast: ${label}`);
}

/** Supplement Axe's pseudoContent review without disabling or removing any rule/result. */
async function measureTabContrast(page: Page) {
  const samples = await page.getByRole('tablist', { name: 'Conteúdo do banco', exact: true }).locator('[data-label]').evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element), twin = getComputedStyle(element, '::after'), backgrounds = [];
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      const paint = getComputedStyle(ancestor); backgrounds.push({ color: paint.backgroundColor, image: paint.backgroundImage, opacity: paint.opacity });
    }
    return { label: element.textContent, color: style.color, backgrounds, hiddenSizingTwin: twin.visibility === 'hidden' && parseFloat(twin.height) === 0 };
  }));
  assert.ok(samples.length > 0, 'incomplete contrast requires the actual bank tabs');
  const rgb = (value: string) => { const match = /^rgba?\(([^)]+)\)$/.exec(value); return match ? match[1].split(',').map(Number) : null; };
  // WCAG relative luminance; compare the unrounded result against 4.5:1.
  const luminance = (color: number[]) => color.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return samples.map(sample => {
    const foreground = rgb(sample.color); let background: number[] | null = null, known = true;
    for (const paint of sample.backgrounds) {
      if (paint.opacity !== '1' || paint.image !== 'none') known = false;
      const color = rgb(paint.color); if (!color) { known = false; break; }
      if (color.length === 3 || color[3] === 1) { background = color; break; }
      if (color[3] !== 0) { known = false; break; }
    }
    const light = foreground && background && known && (foreground.length === 3 || foreground[3] === 1) ? [luminance(foreground), luminance(background)] : null;
    return { label: sample.label, foreground: sample.color, background, hiddenSizingTwin: sample.hiddenSizingTwin, ratio: light ? (Math.max(...light) + 0.05) / (Math.min(...light) + 0.05) : null };
  });
}

type EntryInput = { hit: boolean; duringEntry: boolean; x: number | null; y: number | null; target: string; rect: { x: number; y: number; width: number; height: number } };
async function observeEntryInput(select: Locator, type: 'pointerdown' | 'keydown') {
  await select.evaluate((element, eventType) => {
    document.addEventListener(eventType, event => {
      const rect = element.getBoundingClientRect(), target = event.target as Element;
      const duringEntry = element.closest('dialog')?.getAnimations({ subtree: true }).some(animation => {
        const animated = (animation.effect as KeyframeEffect | null)?.target;
        return animation instanceof CSSAnimation && animated instanceof Element && animated.contains(element) && (animation.playState === 'running' || animation.pending);
      }) ?? false;
      (element as HTMLElement & { memoryEntryInput?: EntryInput }).memoryEntryInput = { hit: element.contains(target), duringEntry,
        x: event instanceof PointerEvent ? event.clientX : null, y: event instanceof PointerEvent ? event.clientY : null,
        target: target.outerHTML.slice(0, 300), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }, { capture: true, once: true });
  }, type);
}
const entryInput = (select: Locator) => select.evaluate(element => {
  const target = element as HTMLElement & { memoryEntryInput?: EntryInput };
  const input = target.memoryEntryInput; delete target.memoryEntryInput; return input;
});

/** Verify native touch plus keyboard/desktop-pointer interaction during native entry. */
export async function probeMemoryImportEntry(page: Page, base: string, width: number, audit: (page: Page, label: string) => Promise<void>) {
  await page.goto(`${base}/w/reporter-ai/quotes`);
  const trigger = page.getByRole('button', { name: 'Importar material', exact: true });
  const dialog = page.getByRole('dialog', { name: 'Importar material', exact: true });
  const select = dialog.getByRole('combobox', { name: 'Tipo', exact: true });
  const kinds = ['Relatório', 'Transcrição', 'Acervo', 'Dados de mercado', 'Notícia', 'Release'];
  let earlyPointer = 0, earlyKeyboard = 0;
  for (let index = 0; index < 12; index++) {
    await trigger.focus(); await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
    await observeEntryInput(select, index % 2 === 0 ? 'pointerdown' : 'keydown');
    if (index % 2 === 0) {
      // Native touch actionability avoids aiming at an obsolete coordinate while a sheet moves.
      // Desktop entry remains a measured real mouse event; keyboard entry is required at both sizes.
      if (width === 390) await select.tap();
      else {
        await expect(select).toBeInViewport({ ratio: 1 }); const box = await select.boundingBox(); assert.ok(box);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      }
      const actual = await entryInput(select); await writeFile(`/tmp/reporter-memory-entry-${width}-${index}.json`, JSON.stringify({ actual }, null, 2));
      assert.ok(actual?.hit, `pointer must hit the actual select: ${JSON.stringify(actual)}`);
      await expect(select).toHaveAttribute('aria-expanded', 'true'); if (actual.duringEntry) earlyPointer++;
    } else {
      await select.focus(); await page.keyboard.press('ArrowDown');
      const actual = await entryInput(select); assert.ok(actual?.hit);
      await expect(select).toHaveAttribute('aria-expanded', 'true'); if (actual.duringEntry) earlyKeyboard++;
    }
    const kind = kinds[index % kinds.length]; await page.getByRole('option', { name: kind, exact: true }).click();
    await expect(select).toContainText(kind); await expect(select).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  }
  assert.ok(earlyKeyboard > 0 && (width === 390 || earlyPointer > 0), `required native entry overlap: pointer=${earlyPointer}, keyboard=${earlyKeyboard}, width=${width}`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await trigger.focus(); await page.keyboard.press('Enter'); await expect(dialog).toBeVisible();
    await select.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
    await expect(select).toContainText('Transcrição');
    const reduced = await dialog.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' || animation.pending).map(animation => {
      const timing = animation.effect?.getComputedTiming();
      return { name: animation instanceof CSSAnimation ? animation.animationName : animation instanceof CSSTransition ? animation.transitionProperty : 'script', endTime: timing?.endTime, delay: timing?.delay, iterations: timing?.iterations };
    }));
    await writeFile(`/tmp/reporter-memory-a11y-${width}-reduced-motion.json`, JSON.stringify(reduced, null, 2));
    // The DS uses 0.01ms to retain native lifecycle events without visible motion.
    assert.deepEqual(reduced.filter(animation => typeof animation.endTime !== 'number' || !Number.isFinite(animation.endTime) || animation.endTime > 0.01 || animation.delay !== 0 || animation.iterations !== 1), [], 'reduced motion must use the DS near-zero duration without delay or repetition');
    const title = dialog.getByRole('textbox', { name: 'Título', exact: true });
    const first = width === 390 ? dialog.getByRole('region', { name: 'Importar material', exact: true }) : dialog.getByRole('button', { name: 'Fechar', exact: true });
    if (width === 390) await expect(first).toHaveAttribute('tabindex', '0');
    await first.focus(); await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused(); await page.keyboard.press('Tab'); await expect(first).toBeFocused();
    await title.focus(); await page.keyboard.press('Tab'); await expect(select).toBeFocused();
    await page.keyboard.press('Tab'); await expect(dialog.getByRole('textbox', { name: 'Texto original', exact: true })).toBeFocused();
    await audit(page, 'import-keyboard-reduced-motion');
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  } finally { await page.emulateMedia({ reducedMotion: 'no-preference' }); }
  console.info('memory import entry probe', { width, earlyPointer, earlyKeyboard, cycles: 12 });
}
