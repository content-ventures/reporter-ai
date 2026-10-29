import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import type { MemoryBatch } from '../../src/ports/editorial-memory-batch.ts';
import { auditMemoryAccessibility } from './editorial-memory-accessibility-browser.ts';

export async function exerciseMemorySingleFileBrowser(base: string, width: number, bytes: Buffer, expectedMaterial: string, dispatch: (request: Request) => Promise<Response>, compete?: () => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390, locale: 'pt-BR' });
  const page = await context.newPage(), errors: string[] = []; let resolved: MemoryBatch | undefined;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await context.route('**/api/reporter/**', async route => {
    const request = route.request(), method = request.method();
    const response = await dispatch(new Request(request.url(), { method, headers: request.headers(), ...(method === 'GET' || method === 'HEAD' ? {} : { body: request.postData() }) }));
    if (response.ok && method === 'POST' && request.url().endsWith('/process')) resolved = await response.clone().json() as MemoryBatch;
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  try {
    await page.goto(`${base}/w/reporter-ai/quotes`); await page.getByRole('button', { name: 'Importar material', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Importar material', exact: true });
    await form.getByRole('radio', { name: 'Enviar arquivo', exact: true }).check();
    await form.getByRole('textbox', { name: 'Título', exact: true }).fill('Outra edição sintética');
    await form.getByRole('combobox', { name: 'Tipo', exact: true }).click(); await page.getByRole('option', { name: 'Acervo', exact: true }).click();
    const chooser = page.waitForEvent('filechooser'); await form.getByRole('button', { name: /^Escolher arquivo original/ }).click();
    await (await chooser).setFiles({ name: 'outra-edicao.csv', mimeType: 'text/csv', buffer: bytes });
    await form.getByRole('combobox', { name: 'Separador do CSV', exact: true }).click(); await page.getByRole('option', { name: 'Ponto e vírgula', exact: true }).click();
    await form.getByRole('textbox', { name: /^Edição/ }).fill('Outra edição sintética');
    await form.getByRole('checkbox', { name: 'Confirmo a autorização de uso deste material', exact: true }).check();
    await form.getByRole('button', { name: 'Importar', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Revisar correspondência', exact: true }); await expect(review).toBeVisible();
    await expect(review.getByText('Synthetic original file', { exact: true })).toBeVisible(); await expect(review.getByText('Edição sintética', { exact: true })).toBeVisible();
    await expect(review.getByText('Origem no envio', { exact: true })).toHaveCount(0);
    const choice = width === 390 ? 'Registrar material distinto' : 'Usar material existente';
    const accept = review.getByRole('button', { name: choice, exact: true }); await expect(accept).toBeDisabled();
    const reason = 'A equipe confirmou que é a mesma publicação.';
    await review.getByRole('textbox', { name: 'Motivo da decisão', exact: true }).fill(reason);
    await expect(accept).toBeEnabled(); await page.screenshot({ path: `/tmp/reporter-memory-single-file-${width}.png`, fullPage: true, animations: 'disabled' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
    await auditMemoryAccessibility(page, width, 'single-file-reconciliation');
    if (compete) {
      await compete(); await expect(review.getByText('O material existente mudou', { exact: true })).toBeVisible(); await expect(accept).toBeDisabled();
      await review.getByRole('button', { name: 'Abrir importação', exact: true }).click(); await expect(review).toBeHidden();
      const batch = page.getByRole('dialog', { name: 'Outra edição sintética', exact: true });
      const row = batch.getByRole('row', { name: '1. outra-edicao.csv', exact: true }); await row.click();
      const document = page.getByRole('dialog', { name: 'Documento do lote', exact: true }); await document.getByRole('button', { name: 'Revisar documento', exact: true }).click();
      const edit = page.getByRole('dialog', { name: 'Revisar documento do lote', exact: true });
      await edit.getByRole('textbox', { name: 'Motivo da revisão', exact: true }).fill('Atualizar a comparação após a revisão da fonte.');
      await edit.getByRole('button', { name: 'Salvar revisão', exact: true }).click(); await expect(edit).toBeHidden();
      await document.getByRole('button', { name: 'Fechar painel', exact: true }).click(); await batch.getByRole('button', { name: 'Importar documentos', exact: true }).click();
      await expect(row).toContainText('Revisar correspondência'); await row.click();
      await document.getByRole('textbox', { name: 'Motivo da decisão', exact: true }).fill(reason);
      await document.getByRole('button', { name: 'Usar registro existente', exact: true }).click(); await expect(document).toBeHidden();
    } else { await accept.focus(); await page.keyboard.press('Enter'); await expect(review).toBeHidden(); }
    assert.ok(resolved); assert.equal(resolved.items[0].status, width === 390 && !compete ? 'included' : 'existing');
    if (width === 390 && !compete) assert.notEqual(resolved.items[0].materialId, expectedMaterial); else assert.equal(resolved.items[0].materialId, expectedMaterial);
    assert.equal(resolved.items[0].input.metadata.edition, 'Outra edição sintética');
    assert.equal(resolved.items[0].reason, reason); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
