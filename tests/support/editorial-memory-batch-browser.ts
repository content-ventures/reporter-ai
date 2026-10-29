import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import type { MemoryBatch } from '../../src/ports/editorial-memory-batch.ts';
import { auditMemoryAccessibility } from './editorial-memory-accessibility-browser.ts';

export async function exerciseMemoryBatchBrowser(base: string, width: number, dispatch: (request: Request) => Promise<Response>) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390, locale: 'pt-BR' });
  const page = await context.newPage(), errors: string[] = []; let latest: MemoryBatch | undefined, dropUpload = false, expectedNetworkUrl: string | undefined;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') {
    if (message.location().url === expectedNetworkUrl && /net::ERR_FAILED/.test(message.text())) { expectedNetworkUrl = undefined; return; }
    if (/Failed to load resource: the server responded with a status of 422/.test(message.text()) && latest?.items.some(item => item.file.name === 'bad.txt' && message.location().url.includes(`/items/${item.id}/upload`))) return;
    errors.push(message.text());
  } });
  await context.route('**/api/reporter/**', async route => {
    const original = route.request(), method = original.method();
    const response = await dispatch(new Request(original.url(), { method, headers: original.headers(), ...(method === 'GET' || method === 'HEAD' ? {} : { body: original.postData() }) }));
    if (new URL(original.url()).pathname.includes('/memory/batches') && response.ok) {
      const value = await response.clone().json(); if (Array.isArray(value.items) && typeof value.id === 'string') latest = value;
      if (dropUpload && method === 'POST' && original.url().endsWith('/upload')) { dropUpload = false; expectedNetworkUrl = original.url(); await route.abort('failed'); return; }
    }
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  const audit = async (label: string) => {
    assert.deepEqual(errors, []); const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth); assert.equal(overflow, false);
    await page.screenshot({ path: `/tmp/reporter-memory-batch-${width}-${label}.png`, fullPage: true, animations: 'disabled' });
    await auditMemoryAccessibility(page, width, `batch-${label}`);
  };
  const open = async () => { await page.goto(`${base}/w/reporter-ai/quotes`); await page.getByRole('button', { name: 'Importações', exact: true }).click(); };
  const list = page.getByRole('dialog', { name: 'Importações', exact: true });
  const body = Buffer.from('Documento técnico sintético do lote: foram observadas 240 pessoas em 2025, sem representar pesquisa real.');
  const title = `Synthetic browser batch ${width}`;
  try {
    await open(); await list.getByRole('button', { name: 'Novo lote', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Novo lote de documentos', exact: true });
    await form.getByRole('textbox', { name: 'Nome do lote', exact: true }).fill(title);
    const chooser = page.waitForEvent('filechooser'); await form.getByRole('button', { name: /^Escolher documentos/ }).click();
    await (await chooser).setFiles([{ name: 'first.txt', mimeType: 'text/plain', buffer: body }, { name: 'copy.txt', mimeType: 'text/plain', buffer: body },
      { name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from([255]) }, { name: 'unsupported.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Unsupported synthetic scan') }]);
    await form.getByRole('checkbox', { name: 'Confirmo a autorização de uso destes documentos', exact: true }).check();
    await audit('create'); await form.getByRole('button', { name: 'Salvar lote', exact: true }).click();
    const detail = page.getByRole('dialog', { name: title, exact: true }); await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Importar documentos', exact: true }).click();
    await expect.poll(() => latest?.items.filter(item => ['included', 'existing', 'refused'].includes(item.status)).length).toBe(4);
    await expect(detail.getByRole('button', { name: 'Importar documentos', exact: true })).toBeEnabled();
    assert.deepEqual(latest!.items.map(item => item.status).sort(), ['existing', 'included', 'refused', 'refused']);
    assert.equal(latest!.items[0].materialId, latest!.items[1].materialId); await audit('report');
    await detail.getByRole('row', { name: '3. bad.txt', exact: true }).click();
    const document = page.getByRole('dialog', { name: 'Documento do lote', exact: true });
    await expect(document.getByRole('alert')).toContainText('UTF-8'); await document.getByRole('button', { name: 'Revisar documento', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Revisar documento do lote', exact: true });
    const corrected = Buffer.from('Arquivo sintético corrigido e acessível após a recarga do navegador.');
    const replacement = page.waitForEvent('filechooser'); await edit.getByRole('button', { name: /^Escolher arquivo corrigido/ }).click();
    await (await replacement).setFiles({ name: 'corrected.txt', mimeType: 'text/plain', buffer: corrected });
    await edit.getByRole('textbox', { name: 'Motivo da revisão', exact: true }).fill('Arquivo resalvo como UTF-8 para o teste técnico.');
    await audit('edit'); await edit.getByRole('button', { name: 'Salvar revisão', exact: true }).click(); await expect(edit).toBeHidden();
    await document.getByRole('button', { name: 'Fechar painel', exact: true }).click();
    dropUpload = true; await detail.getByRole('button', { name: 'Importar documentos', exact: true }).click();
    await expect.poll(() => latest?.items[2].status).toBe('ready'); await expect(detail.getByRole('button', { name: 'Importar documentos', exact: true })).toBeEnabled();
    const original = latest!.items[2].original!.id; await page.reload();
    await page.getByRole('button', { name: 'Importações', exact: true }).click(); await list.getByRole('row', { name: title, exact: true }).click();
    await expect(detail.getByRole('row', { name: '3. corrected.txt', exact: true })).toContainText('Pronto para importar');
    await detail.getByRole('button', { name: 'Importar documentos', exact: true }).click();
    await expect.poll(() => latest?.items[2].status).toBe('included'); assert.equal(latest!.items[2].original!.id, original);
    await expect(detail.getByRole('button', { name: 'Importar documentos', exact: true })).toBeEnabled(); await audit('resumed');
    await detail.getByRole('row', { name: '3. corrected.txt', exact: true }).click();
    const downloading = page.waitForEvent('download'); await document.getByRole('link', { name: 'Baixar arquivo enviado', exact: true }).click();
    const download = await downloading, stream = await download.createReadStream(); assert.ok(stream); const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk)); assert.deepEqual(Buffer.concat(chunks), corrected); assert.equal(download.suggestedFilename(), 'corrected.txt');
    await audit('original'); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
