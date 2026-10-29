import assert from 'node:assert/strict';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import type { MemoryImportInput, MemoryJob, MemoryMaterialRevisionResult, MemoryReplacementResult, MemoryWritingResult } from '../../src/ports/editorial-memory.ts';
import type { MemoryEvidence, MemoryMaterial, MemoryPolicy, MemorySelection } from '../../src/domain/editorial-memory.ts';
import type { MemoryFeedback } from '../../src/domain/editorial-memory-feedback.ts';
import type { RequestedReview } from '../../src/ports/production-commands.ts';
import { blockText, type ArticleBody } from '../../src/domain/article.ts';
import type { MemoryCalibrationCase } from '../../src/domain/editorial-memory-calibration.ts';
import { annotateMemoryPolicyCase, inspectMemoryPolicyLifecycle, reapplyMemoryPolicy } from './editorial-memory-policy-browser.ts';
import { inspectMemoryCollectionPages } from './editorial-memory-collections-browser.ts';
import { auditMemoryAccessibility, probeMemoryImportEntry } from './editorial-memory-accessibility-browser.ts';

/** Real product UI and handlers, with a test-only authenticated identity adapter. */
export async function createMemoryJourneyBrowser(base: string, width: number, dispatch: (request: Request, actor: number) => Promise<Response>) {
  const browser = await chromium.launch({ headless: true }), contexts: BrowserContext[] = [], errors: string[] = [];
  const expectedConflictConsole = new Map<string, number>();
  const expectedFileConsole = new Map<string, number>(), lostFileReplies = new Set<string>();
  const fileReceipts: { path: string; key: string | undefined; payload: string | null; value: { id?: string; material?: MemoryMaterial } }[] = [];
  let originalReplyHold: Promise<void> | undefined;
  let reviewer: Page | undefined;
  async function pageFor(actor: number) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width === 390, hasTouch: width === 390, locale: 'pt-BR' });
    contexts.push(context);
    await context.route('**/api/reporter/**', async route => {
      const original = route.request(), method = original.method();
      let response = await dispatch(new Request(original.url(), { method, headers: original.headers(),
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: original.postData() }) }), actor);
      const path = new URL(original.url()).pathname;
      if (method === 'POST' && (path.endsWith('/memory/originals') || path.endsWith('/memory/materials/from-file')) && response.ok) {
        fileReceipts.push({ path, key: original.headers()['idempotency-key'], payload: original.postData(), value: await response.clone().json() });
        if (lostFileReplies.delete(path)) {
          if (path.endsWith('/originals')) await originalReplyHold;
          expectedFileConsole.set(original.url(), (expectedFileConsole.get(original.url()) ?? 0) + 1);
          response = Response.json({ error: 'SYNTHETIC_REPLY_LOST', message: 'Falha sintética após gravação. Tente novamente.' }, { status: 503 });
        }
      }
      if (response.status >= 400) console.info('memory UI refusal', actor, new URL(original.url()).pathname, response.status, await response.clone().text());
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const url = message.location().url, remaining = expectedConflictConsole.get(url) ?? 0;
      const fileRemaining = expectedFileConsole.get(url) ?? 0;
      if (fileRemaining > 0 && /^Failed to load resource: the server responded with a status of 503 \(Service Unavailable\)$/.test(message.text())) expectedFileConsole.set(url, fileRemaining - 1);
      else if (remaining > 0 && /^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/.test(message.text())) expectedConflictConsole.set(url, remaining - 1);
      else errors.push(message.text());
    });
    return page;
  }
  async function audit(page: Page, label: string) {
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(layout.scroll <= layout.width, JSON.stringify(layout));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `/tmp/reporter-memory-writing-${width}-${label}.png`, fullPage: true, animations: 'disabled' });
    if (new URL(page.url()).pathname.endsWith('/quotes')) await auditMemoryAccessibility(page, width, label);
  }
  const command = (page: Page, method: string) => page.waitForResponse(response => response.url().includes('/api/reporter/')
    && response.request().method() === 'POST' && response.url().endsWith('/workspace') && response.request().postDataJSON().method === method);
  async function value<T>(response: Awaited<ReturnType<Page['waitForResponse']>>) {
    assert.equal(response.status(), 200, await response.text()); const result = await response.json();
    assert.equal(result.ok, true, JSON.stringify(result)); return result.value as T;
  }
  const editor = await pageFor(0);
  return {
    probeImportEntry: () => probeMemoryImportEntry(editor, base, width, audit),
    async observeExtraction(material: MemoryMaterial, job: MemoryJob, extract: () => Promise<void>) {
      await editor.goto(`${base}/w/reporter-ai/quotes?bankView=materials`);
      const row = editor.getByRole('row', { name: material.title, exact: true }); await row.focus(); await editor.keyboard.press('Enter');
      const drawer = editor.getByRole('dialog', { name: material.title, exact: true });
      const announcement = drawer.getByRole('status').filter({ hasText: /^Extração de / }); await expect(announcement).toContainText('Na fila');
      await expect(announcement).toHaveAttribute('aria-live', 'polite'); const close = drawer.getByRole('button', { name: 'Fechar painel', exact: true }); await close.focus();
      await extract(); await expect(announcement).toContainText('Concluído'); await expect(announcement).toContainText(`${job.totalBlocks} de ${job.totalBlocks} blocos concluídos`);
      await expect(drawer.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100'); await expect(close).toBeFocused(); await audit(editor, 'extraction-announced');
      await editor.keyboard.press('Escape'); await expect(drawer).toBeHidden(); await expect(row).toBeFocused();
    },
    async collectionPages() {
      for (const kind of ['materials', 'selections'] as const) {
        const params = new URLSearchParams(kind === 'materials' ? { limit: '25', cursor: 'invalid-collection-cursor' } : { cursor: 'invalid-collection-cursor', limit: '25' });
        expectedConflictConsole.set(`${base}/api/reporter/w/reporter-ai/memory/${kind}?${params}`, 1);
        await inspectMemoryCollectionPages(editor, base, kind, audit);
      }
    },
    annotateCalibration: (excerpt: string) => annotateMemoryPolicyCase(editor, base, excerpt, audit),
    async policyLifecycle(item: MemoryCalibrationCase) { return inspectMemoryPolicyLifecycle(await pageFor(2), editor, base, item, audit); },
    async reapplyPolicy(evidence: MemoryEvidence, checkedAt: string, compete: () => Promise<MemoryPolicy>) {
      return reapplyMemoryPolicy(editor, base, evidence, checkedAt, audit, async () => { const result = await compete(); expectedConflictConsole.set(`${base}/api/reporter/w/reporter-ai/memory/${encodeURIComponent(evidence.id)}/reassess-policy`, 1); return result; });
    },
    async rateSelection(selection: MemorySelection, excerpt: string, reason: string): Promise<MemoryFeedback> {
      console.info('memory UI pauta feedback', width);
      await editor.goto(`${base}/w/reporter-ai/quotes?bankView=selections`);
      const row = editor.getByRole('row', { name: `Seleção de ${selection.items.length} evidências`, exact: true });
      await expect(row.getByRole('cell').nth(3)).toHaveText(String(selection.revision)); await row.click();
      const saved = editor.getByRole('dialog', { name: 'Escrever com a seleção', exact: true });
      const trigger = saved.getByRole('button', { name: 'Avaliar relevância da evidência 1', exact: true }); await trigger.click();
      const form = editor.getByRole('dialog', { name: 'Avaliar relevância', exact: true }), submit = form.getByRole('button', { name: 'Registrar avaliação', exact: true });
      await expect(form.getByRole('textbox', { name: 'Trecho avaliado na seleção', exact: true })).toHaveValue(excerpt); await expect(submit).toBeDisabled();
      await form.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => undefined));
      const rating = form.getByRole('combobox', { name: 'Utilidade para a pauta', exact: true });
      await rating.click(); await editor.getByRole('option', { name: 'Não foi útil para a pauta', exact: true }).click();
      const why = form.getByRole('textbox', { name: 'Motivo da avaliação', exact: true }); await why.fill(reason);
      await form.getByRole('button', { name: 'Fechar', exact: true }).filter({ hasText: /^Fechar$/ }).click();
      await expect(form).toBeHidden(); await expect(trigger).toBeFocused(); await trigger.click();
      await expect(why).toHaveValue(reason); await expect(rating).toContainText('Não foi útil para a pauta');
      await form.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => undefined));
      await audit(editor, 'relevance-form');
      const response = editor.waitForResponse(reply => reply.url().endsWith('/memory/feedback/relevance') && reply.request().method() === 'POST');
      await submit.click(); const recorded = await response; assert.equal(recorded.status(), 200, await recorded.text()); const result = await recorded.json() as MemoryFeedback;
      await expect(form).toBeHidden(); await expect(trigger).toBeFocused(); await expect(saved).toBeVisible();
      return result;
    },
    async inspectFeedback(reason: string, replacementReason: string) {
      console.info('memory UI feedback dataset', width);
      await editor.goto(`${base}/w/reporter-ai/quotes?bankView=feedback&feedbackKind=relevance`);
      const table = editor.getByRole('table', { name: 'Feedback editorial', exact: true }), row = table.getByRole('row', { name: reason.slice(0, 100), exact: true });
      await row.focus(); await editor.keyboard.press('Enter');
      const detail = editor.getByRole('dialog', { name: 'Feedback registrado', exact: true });
      await expect(detail.getByRole('textbox', { name: 'Motivo do feedback', exact: true })).toHaveValue(reason);
      await expect(detail.getByText('Não foi útil para a pauta', { exact: true })).toBeVisible();
      await detail.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => undefined));
      await audit(editor, 'feedback-relevance');
      await editor.keyboard.press('Escape'); await expect(detail).toBeHidden(); await expect(row).toBeFocused();
      const kind = editor.getByRole('combobox', { name: 'Tipo de feedback', exact: true }); await kind.click(); await editor.getByRole('option', { name: 'Correção', exact: true }).click();
      await editor.waitForURL(url => url.searchParams.get('feedbackKind') === 'correction'); await editor.reload(); await expect(kind).toContainText('Correção');
      const replacement = table.getByRole('row', { name: replacementReason.slice(0, 100), exact: true }); await replacement.click();
      await expect(detail.getByRole('textbox', { name: 'Motivo do feedback', exact: true })).toHaveValue(replacementReason);
      await detail.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => undefined));
      await audit(editor, 'feedback-correction');
      await detail.getByRole('button', { name: 'Ver evidência', exact: true }).click();
      await expect(editor.getByRole('dialog', { name: 'Evidência', exact: true })).toBeVisible();
    },
    async replaceObservation(previous: MemoryEvidence, current: MemoryEvidence, reason: string, competing?: () => Promise<unknown>): Promise<MemoryReplacementResult> {
      console.info('memory UI evidence replacement', width);
      await editor.goto(`${base}/w/reporter-ai/quotes?bankView=statistic&q=240`);
      await editor.getByRole('row', { name: previous.anchor.excerpt.slice(0, 80), exact: true }).click();
      const drawer = editor.getByRole('dialog', { name: 'Evidência', exact: true });
      const trigger = drawer.getByRole('button', { name: 'Substituir', exact: true }); await trigger.click();
      const form = editor.getByRole('dialog', { name: 'Substituir evidência', exact: true });
      const save = form.getByRole('button', { name: 'Registrar substituição', exact: true }); await expect(save).toBeDisabled();
      await form.getByRole('searchbox', { name: 'Buscar registro substituto', exact: true }).fill('241');
      const candidate = form.getByRole('row', { name: current.anchor.excerpt.slice(0, 80), exact: true });
      await candidate.focus(); await editor.keyboard.press('Enter');
      const oldText = form.getByRole('textbox', { name: 'Trecho registro anterior', exact: true });
      const newText = form.getByRole('textbox', { name: 'Trecho registro substituto', exact: true });
      const why = form.getByRole('textbox', { name: 'Motivo da substituição', exact: true });
      await expect(oldText).toHaveValue(previous.anchor.excerpt); await expect(newText).toHaveValue(current.anchor.excerpt);
      await expect(oldText).toHaveAttribute('readonly', ''); await expect(newText).toHaveAttribute('readonly', '');
      await expect(save).toBeDisabled(); await why.fill(reason);
      await form.getByRole('button', { name: 'Fechar', exact: true }).filter({ hasText: /^Fechar$/ }).click();
      await expect(form).toBeHidden(); await expect(trigger).toBeFocused(); await trigger.click();
      await expect(why).toHaveValue(reason); await expect(newText).toHaveValue(current.anchor.excerpt);
      const beforeBox = await oldText.boundingBox(), afterBox = await newText.boundingBox(); assert.ok(beforeBox && afterBox);
      if (width === 390) { assert.ok(beforeBox.width >= 300 && afterBox.width >= 300); assert.ok(afterBox.y >= beforeBox.y + beforeBox.height); }
      else { assert.ok(Math.abs(beforeBox.y - afterBox.y) < 2); assert.ok(afterBox.x >= beforeBox.x + beforeBox.width); }
      if (competing) {
        await competing();
        const path = `/memory/${previous.id}/replacement`; expectedConflictConsole.set(`${base}/api/reporter/w/reporter-ai${path}`, 1);
        const refusal = editor.waitForResponse(reply => reply.url().endsWith(path) && reply.request().method() === 'POST');
        await save.click(); assert.equal((await refusal).status(), 409);
        await expect(why).toHaveValue(reason); await expect(newText).toHaveValue(current.anchor.excerpt); await expect(save).toBeDisabled();
        await form.getByRole('button', { name: 'Atualizar comparação', exact: true }).click();
        await expect(save).toBeEnabled(); await expect(why).toHaveValue(reason); await expect(newText).toHaveValue(current.anchor.excerpt);
      }
      await audit(editor, 'replacement-comparison');
      const response = editor.waitForResponse(reply => reply.url().endsWith(`/memory/${previous.id}/replacement`) && reply.request().method() === 'POST');
      await save.click(); const saved = await response; assert.equal(saved.status(), 200, await saved.text()); const result = await saved.json() as MemoryReplacementResult;
      await expect(form).toBeHidden();
      const historyTrigger = drawer.getByRole('button', { name: 'Ver substituição', exact: true }); await expect(historyTrigger).toBeFocused(); await historyTrigger.click();
      const history = editor.getByRole('dialog', { name: 'Substituição registrada', exact: true });
      await expect(history.getByRole('textbox', { name: 'Trecho registro anterior', exact: true })).toHaveValue(previous.anchor.excerpt);
      await expect(history.getByRole('textbox', { name: 'Trecho registro substituto', exact: true })).toHaveValue(current.anchor.excerpt);
      await expect(history.getByText(reason, { exact: true })).toBeVisible(); await expect(history.getByRole('textbox')).toHaveCount(2);
      await history.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => undefined));
      await expect(history.getByRole('textbox', { name: 'Trecho registro anterior', exact: true })).toBeInViewport({ ratio: 1 });
      await audit(editor, 'replacement-history');
      await editor.keyboard.press('Escape'); await editor.keyboard.press('Escape');
      await expect(history).toBeHidden(); await expect(drawer).toBeVisible(); await expect(historyTrigger).toBeFocused();
      await historyTrigger.click(); await history.getByRole('button', { name: 'Abrir registro substituto', exact: true }).click();
      await expect(history).toBeHidden(); await expect(drawer.getByRole('textbox', { name: 'Trecho literal', exact: true })).toHaveValue(current.anchor.excerpt);
      await expect(drawer.getByText('Aguardando revisão', { exact: true })).toBeVisible(); await expect(drawer.getByRole('button', { name: 'Ver registro anterior', exact: true })).toBeVisible();
      await audit(editor, 'replacement-current'); return result;
    },
    async inspectImpact(material: MemoryMaterial, excerpt: string, productionId: string, title: string, count: number, selectionRevision: number) {
      console.info('memory UI correction impact', width);
      await editor.goto(`${base}/w/reporter-ai/quotes?bankView=materials`);
      await editor.getByRole('row', { name: material.title, exact: true }).click();
      const original = editor.getByRole('dialog', { name: material.title, exact: true });
      const trigger = original.getByRole('button', { name: 'Ver impacto da correção', exact: true }); await trigger.click();
      const impact = editor.getByRole('dialog', { name: 'Impacto da correção', exact: true });
      const table = impact.getByRole('table', { name: 'Destinos afetados', exact: true });
      const production = table.getByRole('row', { name: title, exact: true });
      const selection = table.getByRole('row', { name: `Seleção de 4 evidências · revisão ${selectionRevision}`, exact: true });
      await expect(production.getByRole('cell').nth(2)).toHaveText(String(count));
      await expect(production.getByRole('cell').nth(3)).toHaveText(String(count));
      await expect(selection.getByRole('cell').nth(2)).toHaveText(String(count));
      await expect(impact.getByRole('button', { name: 'Próxima', exact: true })).toBeDisabled();
      await audit(editor, 'impact-material');
      await selection.focus(); await editor.keyboard.press('Enter');
      const review = editor.getByRole('dialog', { name: 'Escrever com a seleção', exact: true });
      await expect(review.getByText('Há evidências com nova revisão', { exact: true })).toBeVisible();
      await expect(review.getByRole('list', { name: 'Ordem das evidências' }).getByRole('listitem')).toHaveCount(4);
      await expect(review.getByRole('button', { name: 'Salvar seleção', exact: true })).toBeDisabled();
      await audit(editor, 'impact-selection');
      await review.getByRole('button', { name: 'Fechar', exact: true }).filter({ hasText: /^Fechar$/ }).click();
      await expect(review).toBeHidden(); await expect(impact).toBeVisible(); await expect(selection).toBeFocused();
      await editor.keyboard.press('Escape'); await editor.keyboard.press('Escape');
      await expect(impact).toBeHidden(); await expect(original).toBeVisible(); await expect(trigger).toBeFocused();
      await trigger.click(); await production.click();
      await editor.waitForURL(url => url.pathname.endsWith(`/productions/${productionId}/article`));
      await expect(editor.getByRole('textbox', { name: 'Texto do artigo', exact: true })).toBeVisible(); await audit(editor, 'impact-production');
      await editor.goto(`${base}/w/reporter-ai/quotes?bankView=statistic&q=240`);
      await editor.getByRole('row', { name: excerpt.slice(0, 80), exact: true }).click();
      const evidence = editor.getByRole('dialog', { name: 'Evidência', exact: true });
      const evidenceTrigger = evidence.getByRole('button', { name: 'Ver impacto', exact: true }); await evidenceTrigger.click();
      await expect(production.getByRole('cell').nth(2)).toHaveText('1'); await expect(production.getByRole('cell').nth(3)).toHaveText('1');
      await expect(selection.getByRole('cell').nth(2)).toHaveText('1'); await audit(editor, 'impact-evidence');
      await editor.keyboard.press('Escape'); await editor.keyboard.press('Escape');
      await expect(impact).toBeHidden(); await expect(evidence).toBeVisible(); await expect(evidenceTrigger).toBeFocused();
    },
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
      await dialog.getByRole('button', { name: 'Fechar', exact: true }).filter({ hasText: /^Fechar$/ }).click();
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
      // Read both rectangles in the same browser frame, including during the sheet's entrance.
      const [beforeBox, afterBox] = await comparison.or(revision).evaluateAll(nodes => nodes.map(node => { const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height }; })); assert.ok(beforeBox && afterBox);
      if (width === 390) { assert.ok(beforeBox.width >= 300 && afterBox.width >= 300); assert.ok(afterBox.y >= beforeBox.y + beforeBox.height); }
      else { assert.ok(Math.abs(beforeBox.y - afterBox.y) < 2); assert.ok(afterBox.x >= beforeBox.x + beforeBox.width); }
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
    async import(input: MemoryImportInput, original?: { name: string; bytes: Buffer }): Promise<{ material: MemoryMaterial; job: MemoryJob }> {
      console.info('memory UI import', width, input.kind);
      await editor.goto(`${base}/w/reporter-ai/quotes`);
      await editor.getByRole('button', { name: 'Importar material', exact: true }).click();
      const dialog = editor.getByRole('dialog', { name: 'Importar material', exact: true });
      await dialog.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => undefined));
      await dialog.getByRole('textbox', { name: 'Título', exact: true }).fill(input.title);
      const kind = input.kind === 'report' ? 'Relatório' : 'Transcrição', select = dialog.getByRole('combobox', { name: 'Tipo', exact: true });
      if (!(await select.textContent())?.includes(kind)) {
        await select.click(); await editor.getByRole('option', { name: kind, exact: true }).click();
      }
      await expect(select).toContainText(kind);
      if (original) {
        await dialog.getByRole('radio', { name: 'Enviar arquivo', exact: true }).click();
        const choose = async (name: string, buffer: Buffer) => {
          const waiting = editor.waitForEvent('filechooser'); await dialog.getByRole('button', { name: /^Escolher arquivo original/ }).click();
          await (await waiting).setFiles({ name, mimeType: 'application/octet-stream', buffer });
        };
        await choose('unsupported.pdf', Buffer.from('Synthetic unsupported file'));
        await expect(dialog.getByRole('alert')).toContainText('Escolha um arquivo TXT'); await expect(dialog.getByRole('button', { name: 'Importar', exact: true })).toBeDisabled();
        await choose('oversized.txt', Buffer.alloc(1024 * 1024 + 1, 65));
        await expect(dialog.getByRole('alert')).toContainText('Divida o documento em arquivos de até 1 MiB.');
        await expect(dialog.getByRole('button', { name: 'Importar', exact: true })).toBeDisabled();
        await choose('invalid.txt', Buffer.from([255]));
        await expect(dialog.locator('[data-status="error"]')).toContainText('Salve o arquivo em UTF-8 e tente novamente.');
        await expect(dialog.getByRole('status').filter({ hasText: 'Salve o arquivo em UTF-8 e tente novamente.' })).toHaveAttribute('aria-live', 'polite');
        await expect(dialog.getByRole('button', { name: 'Importar', exact: true })).toBeDisabled();
        await choose('dialect.csv', Buffer.from('institution;value\r\n"Synthetic; institution";1.234,56\r\n'));
        const dialect = dialog.getByRole('combobox', { name: 'Separador do CSV', exact: true });
        await dialect.click(); await editor.getByRole('option', { name: 'Ponto e vírgula', exact: true }).click();
        await expect(dialog.getByRole('textbox', { name: 'Prévia do arquivo original', exact: true })).toHaveValue('institution;value\n"Synthetic; institution";1.234,56\n');
        await choose(original.name, original.bytes);
        const preview = dialog.getByRole('textbox', { name: 'Prévia do arquivo original', exact: true });
        await expect(preview).toHaveValue(input.text); await expect(preview).toHaveAttribute('readonly', '');
        await expect(dialog.getByRole('textbox', { name: /^Instituição/ })).toHaveValue('');
      } else await dialog.getByRole('textbox', { name: 'Texto original', exact: true }).fill(input.text);
      await dialog.getByRole('textbox', { name: /^Documento ou origem principal/ }).fill(input.primaryOrigin ?? '');
      await dialog.getByRole('textbox', { name: /^Temas/ }).fill(input.metadata.topics.join(', '));
      await dialog.getByRole('checkbox', { name: 'Confirmo a autorização de uso deste material' }).check();
      if (original) {
        let release: () => void = () => {};
        originalReplyHold = new Promise<void>(resolve => { release = resolve; });
        try {
          for (const [index, path] of ['originals', 'materials/from-file'].entries()) {
            lostFileReplies.add(`/api/reporter/w/reporter-ai/memory/${path}`);
            const failure = editor.waitForResponse(reply => reply.url().endsWith(`/memory/${path}`) && reply.request().method() === 'POST');
            await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
            if (index === 0) {
              await expect(dialog.getByRole('status').filter({ hasText: /^Enviando original/ }).and(dialog.locator('[aria-live="polite"]'))).toHaveText('Enviando original…');
              await editor.keyboard.press('Escape'); await expect(dialog).toBeHidden();
              await editor.getByRole('button', { name: 'Importar material', exact: true }).click();
              await expect(dialog.getByRole('status').filter({ hasText: /^Enviando original/ }).and(dialog.locator('[aria-live="polite"]'))).toHaveText('Enviando original…'); release();
            }
            assert.equal((await failure).status(), 503);
            await expect(dialog.getByRole('alert')).toContainText('Falha sintética após gravação.');
            await editor.keyboard.press('Escape'); await expect(dialog).toBeHidden();
            await editor.getByRole('button', { name: 'Importar material', exact: true }).click();
            await expect(dialog.getByRole('textbox', { name: 'Título', exact: true })).toHaveValue(input.title);
            await expect(dialog.getByRole('textbox', { name: 'Prévia do arquivo original', exact: true })).toHaveValue(input.text);
            await expect(dialog.getByRole('checkbox', { name: 'Confirmo a autorização de uso deste material' })).toBeChecked();
            await audit(editor, `file-retry-${index}`);
          }
        } finally { release(); originalReplyHold = undefined; }
      }
      const response = editor.waitForResponse(response => response.url().endsWith(original ? '/memory/materials/from-file' : '/memory/materials') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Importar', exact: true }).click();
      const imported = await response; assert.equal(imported.status(), 200, await imported.text());
      const result = await imported.json(); assert.equal(result.material.kind, input.kind);
      if (original) {
        for (const path of ['/memory/originals', '/memory/materials/from-file']) {
          const receipts = fileReceipts.filter(receipt => receipt.path.endsWith(path)); assert.equal(receipts.length, 2);
          assert.equal(new Set(receipts.map(receipt => receipt.key)).size, 1); assert.ok(receipts[0].key);
          assert.equal(receipts[0].payload, receipts[1].payload); assert.deepEqual(receipts[0].value, receipts[1].value);
        }
        assert.equal(fileReceipts[0].value.id, result.material.originalFileId);
      }
      await expect(dialog).toBeHidden(); await audit(editor, 'import'); return result;
    },
    async downloadOriginal(material: MemoryMaterial, original: { name: string; bytes: Buffer }) {
      await editor.goto(`${base}/w/reporter-ai/quotes?bankView=materials`);
      await editor.getByRole('row', { name: material.title, exact: true }).click();
      const drawer = editor.getByRole('dialog', { name: material.title, exact: true });
      const waiting = editor.waitForEvent('download'); await drawer.getByRole('link', { name: 'Baixar arquivo enviado', exact: true }).click();
      const download = await waiting, stream = await download.createReadStream(); assert.ok(stream);
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      assert.equal(download.suggestedFilename(), original.name); assert.deepEqual(Buffer.concat(chunks), original.bytes);
      await expect(drawer.getByRole('link', { name: 'Baixar arquivo enviado', exact: true })).toHaveAttribute('href', '#');
      await audit(editor, 'original-file-download');
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
        const text = version.getByRole('textbox', { name: `Artigo na versão ${number}`, exact: true });
        await expect(text).toHaveAttribute('aria-readonly', 'true');
        await version.getByRole('button', { name: 'Fechar painel', exact: true }).focus(); await editor.keyboard.press('Tab'); await expect(text).toBeFocused();
        const focusRing = await text.evaluate(element => { const style = getComputedStyle(element); return { visible: element.matches(':focus-visible'), width: parseFloat(style.outlineWidth), style: style.outlineStyle }; });
        assert.ok(focusRing.visible && focusRing.width > 0 && focusRing.style !== 'none', 'immutable article text must retain a visible keyboard focus ring');
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
