import { expect, test, type Page } from '@playwright/test';
import { appendEditorialEvent, createEditorialEngine, emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import type { EditorialJob } from '../src/ports/connected-workspace.ts';
import type { NewProductionInput } from '../src/ports/production-commands.ts';
import { expectNoHorizontalOverflow, VIEWPORTS, watchErrors } from './support';

const material = 'A biblioteca oferecerá quatro oficinas gratuitas em novembro. As inscrições ainda não estão abertas e a programação depende da confirmação dos voluntários.';
const input: NewProductionInput = {
  title: 'Teste local do carregamento de carrossel',
  material: { text: material, origin: 'podcast', authorized: true, transcriptId: '00000000-0000-0000-0000-000000000999' },
  brief: { sections: 2, size: 'short' },
  plan: ['article', 'carousel'],
};

/** A synthetic, isolated backend holds the start reply so the preparation screen can be checked. */
async function approvedArticle(page: Page) {
  const checkpoint = emptyEditorialCheckpoint();
  let sequence = 0;
  const engine = createEditorialEngine(checkpoint, { next: (prefix) => `${prefix}-${++sequence}` });
  const created = await engine.commands.createFromSource(input);
  if (!created.ok) throw new Error(created.refusal.message);
  const articleId = created.value.pieces.find((piece) => piece.kind === 'article')!.pieceId;
  const body = { type: 'article' as const, title: input.title, blocks: [{ id: 'p', type: 'paragraph' as const, inlines: [{ text: material }], ai: 'reviewed' as const }] };
  const saved = await engine.commands.saveDraft(articleId, body, 0);
  if (!saved.ok) throw new Error(saved.refusal.message);
  const requested = await engine.commands.requestReview(articleId, { assigneeId: engine.store.state.sessionPersonId });
  if (!requested.ok) throw new Error(requested.refusal.message);
  const subject = requested.value.request.subject;
  const approved = await engine.commands.decide({ pieceId: articleId, subject, decision: 'approved', displayedHash: subject.hash });
  if (!approved.ok) throw new Error(approved.refusal.message);

  let revision = 0;
  let resolvePreparation!: () => void;
  let observePreparation!: () => void;
  let resolveGeneration!: () => void;
  let observeGeneration!: () => void;
  const preparationGate = new Promise<void>((resolve) => { resolvePreparation = resolve; });
  const preparationSeen = new Promise<void>((resolve) => { observePreparation = resolve; });
  const generationGate = new Promise<void>((resolve) => { resolveGeneration = resolve; });
  const generationSeen = new Promise<void>((resolve) => { observeGeneration = resolve; });
  await page.route('**/api/reporter/workspace', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { state: engine.store.state, jobs: checkpoint.jobs, revision, model: 'openai/gpt-4.1', workerOnline: true } });
      return;
    }
    const { method, args } = route.request().postDataJSON();
    if (method === 'derive') {
      observePreparation();
      await preparationGate;
      const result = await engine.commands.derive(args[0] as Parameters<typeof engine.commands.derive>[0]);
      revision++;
      await route.fulfill({ json: result });
      return;
    }
    if (method === 'generation.start') {
      observeGeneration();
      await generationGate;
      const request = args[1] as { productionId: string; pieceId: string };
      const prompt = { key: 'test.carousel', version: '1', hash: 'test' };
      const model = { alias: 'openai/gpt-4.1', label: 'Modelo sintético', engine: 'provider' as const };
      const steps = [{ id: 'source', label: 'Preparando o artigo aprovado' }, { id: 'carousel', label: 'Escrevendo os slides' }];
      const started = engine.runs.begin({ productionId: request.productionId, kind: 'carousel.generate', prompt, model, steps });
      if (!started.ok) throw new Error(started.refusal.message);
      const run = started.value.run;
      const job: EditorialJob = {
        meta: { runId: run.id, productionId: request.productionId, pieceId: request.pieceId, label: 'Gerar textos do carrossel', request: { kind: 'carousel.copy', input: request } },
        kind: 'carousel.copy', input: request, events: [], attempts: 0, availableAt: Date.now(),
      };
      checkpoint.jobs[run.id] = job;
      appendEditorialEvent(engine, job, { type: 'run.started', productionId: request.productionId, pieceId: request.pieceId, kind: run.kind, prompt, model, inputs: run.inputs, steps, createdBy: engine.store.state.sessionPersonId });
      appendEditorialEvent(engine, job, { type: 'step.started', stepId: 'source' });
      revision++;
      await route.fulfill({ json: { ok: true, value: { runId: run.id } } });
      return;
    }
    throw new Error(`Comando inesperado no teste: ${method}`);
  });

  return {
    productionId: created.value.productionId,
    engine,
    preparationSeen,
    releasePreparation: resolvePreparation,
    generationSeen,
    releaseGeneration: resolveGeneration,
  };
}

for (const viewport of VIEWPORTS) {
  test.describe(`geração do carrossel em ${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test('leva ao estúdio imediatamente e mostra o progresso até a geração assumir', async ({ page }) => {
      test.setTimeout(90_000);
      const errors = watchErrors(page);
      const replay = await approvedArticle(page);
      try {
        await page.goto(`/productions/${replay.productionId}/carousel`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('button', { name: /^Gerar textos/ }).first()).toBeEnabled();
        await page.getByRole('button', { name: /^Gerar textos/ }).first().click();

        await expect(page.getByRole('heading', { name: 'Preparando seu carrossel' })).toBeVisible();
        await expect(page.getByRole('progressbar', { name: 'Preparando o estúdio do carrossel' })).toBeVisible();
        await expect(page.getByText('5 slides', { exact: true })).toBeVisible();
        await replay.preparationSeen;
        replay.releasePreparation();
        await replay.generationSeen;
        await expect(page.getByRole('heading', { name: 'Conectando a geração' })).toBeVisible();
        await expect(page.getByText('Conectando ao modelo selecionado.', { exact: true })).toBeVisible();

        replay.releaseGeneration();
        await expect(page.getByText('Escrevendo os slides', { exact: true })).toBeVisible();
        await expect(page.getByRole('progressbar', { name: 'Preparando o estúdio do carrossel' })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        expect(errors).toEqual([]);
      } finally {
        replay.releasePreparation();
        replay.releaseGeneration();
        replay.engine.store.dispose();
      }
    });
  });
}
