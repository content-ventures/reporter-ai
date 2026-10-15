import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createEditorialEngine, emptyEditorialCheckpoint, appendEditorialEvent } from '../src/runtime/editorial-engine.ts';
import type { EditorialJob } from '../src/ports/connected-workspace.ts';
import type { NewProductionInput } from '../src/ports/production-commands.ts';
import { VIEWPORTS, expectNoHorizontalOverflow, watchErrors } from './support';

/** Isolated same-origin replay: no provider calls or shared database writes. */
async function workspace(page: Page, refuseStart = false) {
  const checkpoint = emptyEditorialCheckpoint();
  const engine = createEditorialEngine(checkpoint, { next: () => randomUUID() });
  let revision = 0, creates = 0, starts = 0;
  let job: EditorialJob | undefined;
  await page.route('**/api/reporter/material/analysis', route => route.fulfill({ json: { title: 'Pauta sintética', participants: [], pipelineRevision: 1 } }));
  await page.route(url => url.pathname === '/api/reporter/workspace', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { state: engine.store.state, jobs: checkpoint.jobs, revision, model: 'openai/gpt-4.1', workerOnline: true } });
      return;
    }
    const { method, args } = route.request().postDataJSON();
    if (method === 'createFromSource') {
      creates++;
      const result = await engine.commands.createFromSource(args[0] as NewProductionInput);
      revision++;
      await route.fulfill({ json: result });
    } else if (method === 'generation.start') {
      starts++;
      expect(args[0]).toBe('article.draft');
      expect(args[1].outline).toBeUndefined();
      if (refuseStart) {
        await route.fulfill({ json: { ok: false, refusal: { code: 'provider_unavailable', message: 'Worker indisponível no teste.' } } });
        return;
      }
      const model = { alias: 'openai/gpt-4.1', label: 'Provedor de teste', engine: 'provider' as const };
      const prompt = { key: 'test', version: '1', hash: 'test' };
      const steps = [{ id: 'source', label: 'Preparando a fonte' }, { id: 'outline', label: 'Planejando o artigo' }, { id: 'article', label: 'Escrevendo o artigo' }];
      const started = engine.runs.begin({ productionId: args[1].productionId, kind: 'article.generate', model, prompt, steps });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      const run = started.value.run;
      job = { meta: { runId: run.id, productionId: args[1].productionId, pieceId: args[1].pieceId, label: 'Gerar artigo', request: { kind: 'article.draft', input: args[1] } },
        kind: 'article.draft', input: args[1], events: [], attempts: 0, availableAt: Date.now() };
      checkpoint.jobs[run.id] = job;
      appendEditorialEvent(engine, job, { type: 'run.started', productionId: job.meta.productionId, pieceId: job.meta.pieceId, kind: run.kind, prompt, model, inputs: run.inputs, steps, createdBy: engine.store.state.sessionPersonId });
      appendEditorialEvent(engine, job, { type: 'step.started', stepId: 'source' });
      revision++;
      await route.fulfill({ json: { ok: true, value: { runId: run.id } } });
    } else throw new Error('Unexpected test command: ' + method);
  });
  return { engine, counts: () => ({ creates, starts }), preview(text = 'Primeiro parágrafo chegando em tempo real.') {
    expect(job).toBeDefined();
    appendEditorialEvent(engine, job!, { type: 'step.completed', stepId: 'source' });
    appendEditorialEvent(engine, job!, { type: 'step.started', stepId: 'article' });
    const coverSlot = { subject: 'capa da pauta sintética', availability: { code: 'NO_RELEVANT_IMAGE', message: 'Nenhuma foto pertinente em alta resolução foi encontrada. O texto está preservado.' } };
    appendEditorialEvent(engine, job!, { type: 'outline', title: 'Texto sintético', sections: [], cover: coverSlot });
    appendEditorialEvent(engine, job!, { type: 'article.preview', body: { type: 'article', title: 'Texto sintético', coverSlot, blocks: [
      { id: 'preview-1', type: 'paragraph', inlines: [{ text }], ai: 'unreviewed' },
    ] } });
    revision++;
  }, complete() {
    expect(job).toBeDefined();
    appendEditorialEvent(engine, job!, { type: 'block.started', block: { id: 'final-1', type: 'paragraph' } });
    appendEditorialEvent(engine, job!, { type: 'block.completed', block: { id: 'final-1', type: 'paragraph', inlines: [{ text: 'Artigo final validado e pronto para edição.' }], ai: 'unreviewed' } });
    appendEditorialEvent(engine, job!, { type: 'step.completed', stepId: 'article' });
    appendEditorialEvent(engine, job!, { type: 'run.completed' });
    revision++;
  } };
}

async function confirmPauta(page: Page) {
  await page.goto('/productions/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /Operador local.*Menu da conta/, includeHidden: true })).toBeAttached();
  await expect(page.getByText('Estrutura', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Usar exemplo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Material (preenchida)', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('checkbox', { name: 'Os falantes autorizaram o uso' }).check();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('textbox', { name: 'Título interno', exact: true }).fill('Teste local do editor direto');
  await page.getByRole('button', { name: 'Gerar artigo', exact: true }).click();
  await page.waitForURL(/\/productions\/[^/]+\/article$/);
}

for (const viewport of VIEWPORTS) {
  test.describe(`pauta direto ao editor em ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test('mostra a prévia, preserva a revisão e libera o artigo final para edição', async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page), replay = await workspace(page);
      try {
        await confirmPauta(page);
        await expect(page.getByRole('progressbar', { name: 'Preparando o artigo' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Material', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Parar', exact: true })).toBeVisible();
        await expect(page.getByText('Selecionar evidências e citações. Você pode acompanhar a prévia; a edição será liberada após a validação.', { exact: true })).toHaveCount(0);
        expect(replay.counts()).toEqual({ creates: 1, starts: 1 });
        replay.preview();
        await expect(page.getByRole('textbox', { name: 'Prévia do artigo em tempo real' })).toContainText('Primeiro parágrafo chegando em tempo real.');
        await expect(page.getByRole('progressbar', { name: 'Preparando o artigo' })).toHaveCount(0);
        replay.preview('Texto de uma revisão que não deve fazer o artigo voltar para o início.');
        await expect(page.getByRole('textbox', { name: 'Prévia do artigo em tempo real' })).toContainText('Primeiro parágrafo chegando em tempo real.');
        replay.complete();
        const article = page.getByRole('textbox', { name: 'Texto do artigo' });
        await expect(article).toContainText('Artigo final validado e pronto para edição.');
        await expect(article).toHaveAttribute('aria-readonly', 'false');
        await expect(page.getByRole('progressbar', { name: 'Preparando o artigo' })).toHaveCount(0);
        await expect(page.getByText('Nenhuma foto pertinente em alta resolução foi encontrada. O texto está preservado.', { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Adicionar imagem de destaque' })).toBeVisible();
        await expectNoHorizontalOverflow(page);
        expect(errors).toEqual([]);
      } finally { replay.engine.store.dispose(); }
    });
    test('preserva a produção no editor se a fila recusar e redireciona links antigos', async ({ page }) => {
      test.setTimeout(120_000);
      const replay = await workspace(page, true);
      try {
        await confirmPauta(page);
        await expect(page.getByRole('button', { name: 'Gerar artigo', exact: true })).toBeVisible();
        expect(replay.counts()).toEqual({ creates: 1, starts: 1 });
        const id = new URL(page.url()).pathname.split('/')[2];
        await page.goto('/productions/new?producao=' + id, { waitUntil: 'domcontentloaded' });
        await page.waitForURL(new RegExp('/productions/' + id + '/article$'));
        await expect(page.getByRole('button', { name: 'Gerar artigo', exact: true })).toBeVisible();
        expect(replay.counts()).toEqual({ creates: 1, starts: 1 });
        await expectNoHorizontalOverflow(page);
      } finally { replay.engine.store.dispose(); }
    });
  });
}
