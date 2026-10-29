import assert from 'node:assert/strict';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import type { MemoryImportInput, MemoryJob, MemoryMaterialRevisionResult, MemoryWritingResult } from '../../src/ports/editorial-memory.ts';
import type { MemoryMaterial, MemorySelection } from '../../src/domain/editorial-memory.ts';
import type { RequestedReview } from '../../src/ports/production-commands.ts';
import { blockText, type ArticleBody } from '../../src/domain/article.ts';

/** Real product UI and handlers, with a test-only authenticated identity adapter. */
export async function createMemoryJourneyBrowser(base: string, width: number, dispatch: (request: Request, actor: number) => Promise<Response>) {
  const browser = await chromium.launch({ headless: true }), contexts: BrowserContext[] = [], errors: string[] = [];
  const expectedConflictConsole = new Map<string, number>();
  let reviewer: Page | undefined;
  async function pageFor(actor: number) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390, locale: 'pt-BR' });
    contexts.push(context);
    await context.route('**/api/reporter/**', async route => {
      const original = route.request(), method = original.method();
      const response = await dispatch(new Request(original.url(), { method, headers: original.headers(),
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: original.postData() }) }), actor);
      if (response.status >= 400) console.info('memory UI refusal', actor, new URL(original.url()).pathname, response.status, await response.clone().text());
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const url = message.location().url, remaining = expectedConflictConsole.get(url) ?? 0;
      if (remaining > 0 && /^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/.test(message.text())) expectedConflictConsole.set(url, remaining - 1);
      else errors.push(message.text());
    });
    return page;
  }
  async function audit(page: Page, label: string) {
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.scroll <= layout.width, JSON.stringify(layout));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `/tmp/reporter-memory-writing-${width}-${label}.png`, fullPage: true, animations: 'disabled' });
  }
  const command = (page: Page, method: string) => page.waitForResponse(response => response.url().includes('/api/reporter/')
    && response.request().method() === 'POST' && response.url().endsWith('/workspace') && response.request().postDataJSON().method === method);
  async function value<T>(response: Awaited<ReturnType<Page['waitForResponse']>>) {
    assert.equal(response.status(), 200, await response.text()); const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result)); return result.value as T;
  }
  const editor = await pageFor(0);
  return {
    async reviseOriginal(material: MemoryMaterial, original: string, corrected: string, reason: string, competing?: { text: string; run: () => Promise<MemoryMaterialRevisionResult> }): Promise<MemoryMaterialRevisionResult> {
      console.info('memory UI original revision', width, Boolean(competing));
      await editor.goto(`${base}/w/reporter-ai/quotes?bankView=materials`);
      await editor.getByRole('row', { name: material.title, exact: true }).click();
      const drawer = editor.getByRole('dialog', { name: material.title, exact: true });
      const trigger = drawer.getByRole('button', { name: 'Revisar original', exact: true });
      const preserved = drawer.getByRole('textbox', { name: 'Texto original preservado', exact: true });
      await expect(preserved).toHaveValue(original); await trigger.click();
      const dialog = editor.getByRole('dialog', { name: 'Revisar original', exact: true });
      const comparison = dialog.getByRole('textbox', { name: 'Original em uso', exact: true });
      const revision = dialog.getByRole('textbox', { name: 'Original revisado', exact: true });
      const why = dialog.getByRole('textbox', { name: 'Motivo da revisão', exact: true });
      await expect(comparison).toHaveValue(original); await expect(comparison).toHaveAttribute('readonly', '');
      await revision.fill(corrected); await why.fill(reason);
      await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
      await expect(dialog).toBeHidden(); await expect(drawer).toBeVisible(); await expect(trigger).toBeFocused();
      await trigger.click(); await expect(revision).toHaveValue(corrected); await expect(why).toHaveValue(reason);
      const path = `/memory/materials/${material.id}/revision`;
      if (competing) {
        const winner = await competing.run(); assert.equal(winner.material.source.sourceVersion, material.source.sourceVersion + 1);
        expectedConflictConsole.set(`${base}/api/reporter/w/reporter-ai${path}`, 1);
        const refused = editor.waitForResponse(response => response.url().endsWith(path) && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: 'Salvar nova versão', exact: true }).click();
        assert.equal((await refused).status(), 409);
        await expect(revision).toHaveValue(corrected); await expect(why).toHaveValue(reason);
        await dialog.getByRole('button', { name: 'Atualizar comparação', exact: true }).click();
        await expect(comparison).toHaveValue(competing.text); await expect(revision).toHaveValue(corrected); await expect(why).toHaveValue(reason);
      }
      await audit(editor, competing ? 'revision-conflict' : 'revision-comparison');
      const response = editor.waitForResponse(response => response.url().endsWith(path) && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Salvar nova versão', exact: true }).click();
      const saved = await response; assert.equal(saved.status(), 200, await saved.text()); const result = await saved.json() as MemoryMaterialRevisionResult;
      await expect(dialog).toBeHidden(); await expect(drawer).toBeVisible(); await expect(trigger).toBeFocused();
      await expect(preserved).toHaveValue(corrected);
      await drawer.getByRole('button', { name: 'Versão anterior', exact: true }).click();
      await expect(preserved).toHaveValue(competing?.text ?? original);
      await expect(drawer.getByRole('button', { name: 'Revisar original', exact: true })).toHaveCount(0);
      await expect(drawer.getByRole('button', { name: 'Revogar autorização', exact: true })).toHaveCount(0);
      await expect(preserved).toHaveAttribute('readonly', ''); await audit(editor, 'original-history');
      if (competing) {
        await drawer.getByRole('button', { name: 'Versão anterior', exact: true }).click(); await expect(preserved).toHaveValue(original);
        await drawer.getByRole('button', { name: 'Próxima versão', exact: true }).click(); await expect(preserved).toHaveValue(competing.text);
      }
      await drawer.getByRole('button', { name: 'Próxima versão', exact: true }).click(); await expect(preserved).toHaveValue(corrected);
      await expect(trigger).toBeVisible(); await editor.reload();
      await editor.getByRole('row', { name: material.title, exact: true }).click(); await expect(preserved).toHaveValue(corrected);
      await audit(editor, 'original-revised'); return result;
    },
    async import(input: MemoryImportInput): Promise<{ material: MemoryMaterial; job: MemoryJob }> {
      console.info('memory UI import', width, input.kind);
      await editor.goto(`${base}/w/reporter-ai/quotes`);
      await editor.getByRole('button', { name: 'Importar material', exact: true }).click();
      const dialog = editor.getByRole('dialog', { name: 'Importar material', exact: true });
      await dialog.getByRole('textbox', { name: 'Título', exact: true }).fill(input.title);
      await dialog.getByRole('textbox', { name: 'Texto original', exact: true }).fill(input.text);
      await dialog.getByRole('textbox', { name: /^Documento ou origem principal/ }).fill(input.primaryOrigin ?? '');
      await dialog.getByRole('textbox', { name: /^Temas/ }).fill(input.metadata.topics.join(', '));
      const kind = input.kind === 'report' ? 'Relatório' : 'Transcrição', select = dialog.getByRole('combobox', { name: 'Tipo', exact: true });
      if (!(await select.textContent())?.includes(kind)) {
        await select.click(); await editor.getByRole('option', { name: kind, exact: true }).click();
      }
      await expect(select).toContainText(kind);
      await dialog.getByRole('checkbox', { name: 'Confirmo a autorização de uso deste material' }).check();
      const response = editor.waitForResponse(response => response.url().endsWith('/memory/materials') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
      const imported = await response; assert.equal(imported.status(), 200, await imported.text());
      const result = await imported.json(); assert.equal(result.material.kind, input.kind);
      await expect(dialog).toBeHidden(); await audit(editor, 'import'); return result;
    },
    async select(passages: readonly { kind: 'citation' | 'statistic'; text: string }[]): Promise<MemorySelection> {
      console.info('memory UI select', width);
      await editor.goto(`${base}/w/reporter-ai/quotes`);
      for (const [index, passage] of passages.entries()) {
        await editor.getByRole('tab', { name: passage.kind === 'statistic' ? 'Estatísticas' : 'Citações', exact: true }).click();
        const query = ['240', 'origem', '120', 'história'][index];
        await editor.getByRole('searchbox', { name: 'Buscar evidências', exact: true }).fill(query);
        await editor.getByRole('checkbox', { name: 'Selecionar ' + passage.text.slice(0, 80), exact: true }).check();
      }
      await editor.getByRole('button', { name: 'Organizar e escrever', exact: true }).click();
      const dialog = editor.getByRole('dialog', { name: 'Escrever com a seleção', exact: true });
      await expect(dialog.getByRole('list', { name: 'Ordem das evidências' }).getByRole('listitem')).toHaveCount(4);
      const response = editor.waitForResponse(response => response.url().endsWith('/memory/selections') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Salvar seleção', exact: true }).click();
      const saved = await response; assert.equal(saved.status(), 200, await saved.text());
      await expect(dialog).toBeHidden(); await audit(editor, 'selection'); return saved.json();
    },
    async write(title: string): Promise<MemoryWritingResult> {
      console.info('memory UI write', width);
      await editor.reload(); await editor.getByRole('tab', { name: 'Seleções', exact: true }).click();
      await editor.getByRole('row', { name: 'Seleção de 4 evidências', exact: true }).click();
      const dialog = editor.getByRole('dialog', { name: 'Escrever com a seleção', exact: true });
      await dialog.getByRole('textbox', { name: 'Título interno', exact: true }).fill(title);
      const response = editor.waitForResponse(response => response.url().endsWith('/write') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Criar artigo e abrir editor', exact: true }).click();
      const made = await response; assert.equal(made.status(), 200, await made.text()); const result = await made.json() as MemoryWritingResult;
      await editor.waitForURL(url => url.pathname.endsWith(`/productions/${result.productionId}/article`));
      await expect(editor.getByRole('textbox', { name: 'Texto do artigo', exact: true })).toBeVisible(); await audit(editor, 'selected-article'); return result;
    },
    async start(productionId: string): Promise<{ runId: string }> {
      console.info('memory UI generate', width);
      await editor.goto(`${base}/w/reporter-ai/productions/${productionId}/article`);
      await editor.getByRole('button', { name: 'Mais ações', exact: true }).first().click();
      await editor.getByRole('menuitem', { name: 'Reescrever o artigo do zero…', exact: true }).click();
      const pending = command(editor, 'generation.start');
      await editor.getByRole('dialog', { name: 'Reescrever o artigo do zero?', exact: true }).getByRole('button', { name: 'Reescrever', exact: true }).click();
      return value(await pending);
    },
    async send(productionId: string): Promise<RequestedReview> {
      console.info('memory UI send', width); assert.ok(new URL(editor.url()).pathname.includes(productionId));
      await editor.reload();
      await editor.getByRole('button', { name: 'Enviar para aprovação', exact: true }).first().click();
      const dialog = editor.getByRole('dialog', { name: 'Enviar para aprovação', exact: true });
      await dialog.getByRole('button', { name: 'Marcar como revisado', exact: true }).click();
      const pending = command(editor, 'requestReview');
      await dialog.getByRole('button', { name: /^Enviar para / }).click();
      const result = await value<RequestedReview>(await pending); await expect(dialog).toBeHidden();
      await editor.waitForURL(url => url.pathname.endsWith('/productions')); await audit(editor, 'sent');
      assert.ok(result.version.ref.pieceId); return result;
    },
    async approve(productionId: string, body: ArticleBody): Promise<{ id: string; by: string }> {
      console.info('memory UI approve', width);
      reviewer = await pageFor(1); await reviewer.goto(`${base}/w/reporter-ai/productions/${productionId}/article/review`);
      const reading = reviewer.getByRole('article', { name: 'Texto do artigo', exact: true });
      await expect(reading).toContainText(body.title);
      for (const block of body.blocks) await expect(reading).toContainText(blockText(block), { useInnerText: true });
      await audit(reviewer, 'review');
      await reviewer.getByRole('button', { name: 'Aprovar artigo', exact: true }).first().click();
      const dialog = reviewer.getByRole('dialog', { name: 'Aprovar o artigo?', exact: true });
      const pending = command(reviewer, 'decide'); await dialog.getByRole('button', { name: 'Aprovar artigo', exact: true }).click();
      const result = await value<{ id: string; by: string }>(await pending); await expect(dialog).toBeHidden(); await audit(reviewer, 'approved'); return result;
    },
    async download(productionId: string) {
      console.info('memory UI download', width);
      await editor.goto(`${base}/w/reporter-ai/productions/${productionId}/delivery`);
      await expect(editor.getByRole('link', { name: /^Baixar .*manifesto.*\.json$/ })).toBeVisible();
      const count = await editor.getByRole('link', { name: /^Baixar / }).count(); assert.equal(count, 3);
      const downloads: Promise<{ name: string; text: string }>[] = [];
      const onDownload = (download: import('@playwright/test').Download) => {
        downloads.push((async () => { const stream = await download.createReadStream(); assert.ok(stream); const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk)); return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') }; })());
      };
      editor.on('download', onDownload);
      try {
        await editor.getByRole('button', { name: 'Baixar pacote', exact: true }).first().click();
        await expect.poll(() => downloads.length).toBe(count); const files = await Promise.all(downloads);
        await audit(editor, 'download'); return files;
      } finally { editor.off('download', onDownload); }
    },
    async used(passages: readonly { kind: 'citation' | 'statistic'; text: string }[], number: number, title: string) {
      console.info('memory UI frozen uses', width);
      for (const [index, passage] of passages.entries()) {
        await editor.goto(`${base}/w/reporter-ai/quotes?bankView=${passage.kind}&q=${['240', 'origem', '120', 'história'][index]}`);
        await editor.getByRole('row', { name: passage.text.slice(0, 80), exact: true }).click();
        const evidence = editor.getByRole('dialog', { name: 'Evidência', exact: true });
        const trigger = evidence.getByRole('button', { name: `Ler versão ${number}`, exact: true }); await trigger.click();
        const version = editor.getByRole('dialog', { name: `Artigo · versão ${number}`, exact: true });
        const reading = version.getByRole('article', { name: `Artigo na versão ${number}`, exact: true });
        await expect(reading).toContainText(title); await expect(reading).toContainText(passage.text, { useInnerText: true });
        await expect(reading).not.toContainText('Origem e contexto no texto do ensaio');
        await expect(version.locator('[contenteditable="true"]')).toHaveCount(0);
        await audit(editor, `used-${passage.kind}`); await editor.keyboard.press('Escape');
        // A repeated Escape during the reader's exit still belongs to that topmost layer.
        await editor.keyboard.press('Escape'); await expect(version).toBeHidden();
        await expect(evidence).toBeVisible(); await expect(trigger).toBeFocused();
      }
    },
    async close() {
      try { for (const context of contexts) for (const page of context.pages()) if (!page.isClosed()) await audit(page, 'final'); }
      finally { await browser.close(); }
    },
  };
}
