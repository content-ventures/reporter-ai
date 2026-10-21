import { expect, test, type Page } from '@playwright/test';
import { defaultEditorialPolicy, reviseEditorialPolicy } from '../src/domain/editorial-policy.ts';
import { applyWritingGuideSuggestions } from '../src/domain/writing-guide-suggestions.ts';
import { defaultPipelineDefinition, pipelineRevision, type PipelineDefinition, type PipelineView } from '../src/domain/pipeline.ts';
import type { Role } from '../src/domain/workspace.ts';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

/** In-memory API boundary: reloads must read the acknowledged server state, not browser fixtures. */
async function settingsServer(page: Page, roles: Role[] = ['admin']) {
  const checkpoint = emptyEditorialCheckpoint();
  checkpoint.state.members[0].roles = roles;
  const editorial = defaultEditorialPolicy();
  editorial.map = { ...editorial.map, version: 1, audience: 'Profissionais da cadeia do pescado', updatedAt: '2026-10-21T12:00:00.000Z', updatedBy: 'Editora' };
  editorial.guide = { ...editorial.guide, version: 1, voice: 'Direta e informativa', updatedAt: '2026-10-21T12:00:00.000Z', updatedBy: 'Editora' };
  let view: PipelineView = { active: pipelineRevision({ ...defaultPipelineDefinition(), editorial }, 2), history: [], runs: [] };
  const saves: { definition: PipelineDefinition; baseRevision: number }[] = [];
  const unexpected: string[] = [];
  let failure: string | undefined;
  await page.route('**/api/**', route => {
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/reporter/pipeline', route => route.fulfill({ json: view }));
  await page.route('**/api/reporter/workspace', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: {
      state: checkpoint.state, jobs: {}, revision: view.active.revision, model: 'openai/gpt-4.1', workerOnline: true,
    } });
    const payload = route.request().postDataJSON();
    expect(payload.method).toBe('pipeline.save');
    const [definition, baseRevision] = payload.args as [PipelineDefinition, number];
    saves.push({ definition, baseRevision });
    if (failure) return route.fulfill({ json: { ok: false, refusal: { code: 'invalid_config', message: failure } } });
    if (baseRevision !== view.active.revision) return route.fulfill({ json: {
      ok: false, refusal: { code: 'conflict', message: 'A configuração mudou em outra sessão.' },
    } });
    const policy = reviseEditorialPolicy(view.active.definition.editorial, definition.editorial, { at: '2026-10-21T15:00:00.000Z', by: 'Editora' });
    view = { ...view, history: [view.active, ...view.history], active: pipelineRevision({ ...definition, editorial: policy }, baseRevision + 1) };
    return route.fulfill({ json: { ok: true, value: view } });
  });
  return {
    saves, unexpected,
    view: () => view,
    fail: (message?: string) => { failure = message; },
    changeElsewhere: () => {
      const policy = structuredClone(view.active.definition.editorial!);
      policy.guide = { ...policy.guide, version: policy.guide.version + 1, voice: 'Guia salvo em outra sessão' };
      view = { ...view, history: [view.active, ...view.history], active: pipelineRevision({ ...view.active.definition, editorial: policy }, view.active.revision + 1) };
    },
  };
}

for (const viewport of VIEWPORTS) {
  test.describe(`editorial settings at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });

    test('previews guide suggestions without overwriting custom settings and saves only after editing the draft', async ({ page }) => {
      const errors = watchErrors(page);
      const server = await settingsServer(page);
      const original = structuredClone(server.view().active.definition.editorial!);
      const suggested = applyWritingGuideSuggestions(original.guide);
      await page.goto('/settings/writing-guide');
      const voice = page.getByRole('textbox', { name: 'Voz', exact: true });
      await expect(voice).toHaveValue(original.guide.voice);
      await page.getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Sugestões para o guia', exact: true });
      const voiceComparison = dialog.getByRole('region', { name: 'Sugestão de Voz', exact: true });
      await expect(voiceComparison.getByRole('deletion')).toHaveText(['Removido: Direta', 'Removido: informativa']);
      await expectNoHorizontalOverflow(page);
      await dialog.screenshot({ path: `test-results/guide-suggestions-${viewport.width}.png` });
      await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(voice).toHaveValue(original.guide.voice);
      expect(server.saves).toHaveLength(0);
      await page.getByRole('button', { name: 'Revisar sugestões', exact: true }).click();
      await dialog.getByRole('button', { name: 'Aplicar ao rascunho', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(voice).toHaveValue(suggested.voice);
      await expect(page.getByRole('textbox', { name: 'Atribuição', exact: true })).toHaveValue(suggested.attribution);
      await expect(page.getByRole('textbox', { name: 'Parágrafos', exact: true })).toHaveValue(suggested.composition!.paragraphs!);
      expect(server.saves).toHaveLength(0);
      const customVoice = `${suggested.voice} Preferência adicional da redação.`;
      await voice.fill(customVoice);
      await expect(voice).toHaveValue(customVoice);
      await page.getByRole('button', { name: 'Salvar versão 2', exact: true }).click();
      await expect(page.getByText('Guia de escrita v2 salvo', { exact: true })).toBeVisible();
      expect(server.saves).toHaveLength(1);
      expect(server.saves[0].definition.editorial!.guide.voice).toBe(customVoice);
      expect(server.view().active.definition.editorial!.map).toEqual(original.map);
      await page.reload();
      await expect(voice).toHaveValue(customVoice);
      await expect(page.getByRole('textbox', { name: 'Linha fina', exact: true })).toHaveValue(suggested.dek!);
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      expect(server.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('saves guide composition and references, reloads them, and preserves the guide when saving the map', async ({ page }) => {
      const errors = watchErrors(page);
      const server = await settingsServer(page);
      await page.goto('/settings/writing-guide');
      const voice = page.getByRole('textbox', { name: 'Voz', exact: true });
      await expect(voice).toHaveValue('Direta e informativa');
      await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'O guia em ação', exact: true })).toHaveCount(0);
      await voice.fill('Direta, específica e sem adjetivos promocionais.');
      await page.getByRole('textbox', { name: 'Linha fina', exact: true }).fill('Acrescente informação ao título.');
      await page.getByRole('textbox', { name: 'Parágrafos', exact: true }).fill('Uma ideia por parágrafo, sem quantidade fixa.');
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: 'Adicionar referência', exact: true }).click();
      await page.getByRole('textbox', { name: 'Título da referência 1', exact: true }).fill('Hecke estreou no mercado de pescado com merluza na APAS Show');
      await page.getByRole('textbox', { name: 'URL da referência 1', exact: true }).fill('https://www.seafoodbrasil.com.br/varejo/hecke-estreou-no-mercado-de-pescado-com-merluza-na-apas-show/');
      await page.getByRole('textbox', { name: 'Observação editorial 1', exact: true }).fill('Apresente o movimento comercial e os detalhes do produto antes das avaliações da empresa.');
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: 'Salvar versão 2', exact: true }).click();
      await expect(page.getByText('Guia de escrita v2 salvo', { exact: true })).toBeVisible();
      expect(server.saves).toHaveLength(1);
      expect(server.saves[0].baseRevision).toBe(2);
      const guide = structuredClone(server.view().active.definition.editorial!.guide);
      expect(guide.composition?.paragraphs).toBe('Uma ideia por parágrafo, sem quantidade fixa.');
      expect(guide.examples).toHaveLength(1);
      expect(server.view().history[0].definition.editorial!.guide.version).toBe(1);
      expect(server.view().active.definition.steps).toEqual(defaultPipelineDefinition().steps);
      await page.reload();
      await expect(voice).toHaveValue(guide.voice);
      await expect(page.getByRole('textbox', { name: 'Linha fina', exact: true })).toHaveValue(guide.dek!);
      await expect(page.getByRole('textbox', { name: 'URL da referência 1', exact: true })).toHaveValue(guide.examples[0].url);
      await page.screenshot({ path: `test-results/editorial-guide-${viewport.width < 768 ? 'mobile' : 'desktop'}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Versões', exact: true }).click();
      await expect(page.getByText('Versão 1 · Editora', { exact: true })).toBeVisible();
      await expect(page.getByText('Versão 2 · Editora', { exact: true })).toBeVisible();
      await page.goto('/settings/editorial-map');
      const audience = page.getByRole('textbox', { name: 'Público', exact: true });
      await expect(audience).toHaveValue('Profissionais da cadeia do pescado');
      await audience.fill('Compradores, produtores e gestores da cadeia do pescado.');
      await page.getByRole('button', { name: 'Salvar versão 2', exact: true }).click();
      await expect(page.getByText('Mapa editorial v2 salvo', { exact: true })).toBeVisible();
      expect(server.saves).toHaveLength(2);
      expect(server.saves[1].baseRevision).toBe(3);
      expect(server.view().active.definition.editorial!.guide).toEqual(guide);
      await page.reload();
      await expect(audience).toHaveValue('Compradores, produtores e gestores da cadeia do pescado.');
      await expect(page.getByText('Demo', { exact: true })).toHaveCount(0);
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `test-results/editorial-map-${viewport.width < 768 ? 'mobile' : 'desktop'}.png`, fullPage: true });
      expect(server.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test('failed saves retain the draft; a stale revision requires explicit reload instead of overwrite', async ({ page }) => {
  const errors = watchErrors(page);
  const server = await settingsServer(page);
  await page.goto('/settings/writing-guide');
  const voice = page.getByRole('textbox', { name: 'Voz', exact: true });
  await expect(voice).toHaveValue('Direta e informativa');
  await voice.fill('Minha alteração ainda não salva.');
  server.fail('Confira a referência antes de salvar.');
  await page.getByRole('button', { name: 'Salvar versão 2', exact: true }).click();
  await expect(page.getByText('Confira a referência antes de salvar.', { exact: true })).toBeVisible();
  await expect(voice).toHaveValue('Minha alteração ainda não salva.');
  await expect(page.getByText('Guia de escrita v2 salvo', { exact: true })).toHaveCount(0);
  expect(server.view().active.definition.editorial!.guide.voice).toBe('Direta e informativa');
  server.fail();
  server.changeElsewhere();
  await page.getByRole('button', { name: 'Salvar versão 2', exact: true }).click();
  await expect(page.getByText(/Outra pessoa alterou a configuração/)).toBeVisible();
  await expect(voice).toHaveValue('Minha alteração ainda não salva.');
  await expect(page.getByRole('button', { name: 'Salvar versão 2', exact: true })).toBeDisabled();
  expect(server.saves.map(save => save.baseRevision)).toEqual([2, 2]);
  expect(server.view().active.definition.editorial!.guide.voice).toBe('Guia salvo em outra sessão');
  await page.getByRole('button', { name: 'Descartar e carregar versão atual', exact: true }).click();
  await expect(voice).toHaveValue('Guia salvo em outra sessão');
  expect(server.saves).toHaveLength(2);
  expect(server.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('an editor reads the policy but cannot edit it or create versions', async ({ page }) => {
  const server = await settingsServer(page, ['editor']);
  await page.goto('/settings/writing-guide');
  await expect(page.getByRole('textbox', { name: 'Voz', exact: true })).toHaveValue('Direta e informativa');
  await expect(page.getByRole('textbox', { name: 'Voz', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Adicionar referência', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revisar sugestões', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Salvar versão/ })).toHaveCount(0);
  await page.goto('/settings/editorial-map');
  await expect(page.getByRole('textbox', { name: 'Público', exact: true })).toBeDisabled();
  expect(server.saves).toHaveLength(0);
  expect(server.unexpected).toEqual([]);
});
