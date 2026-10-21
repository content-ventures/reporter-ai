import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { defaultPipelineDefinition, pipelineRevision, type PipelineDefinition, type PipelineView } from '../src/domain/pipeline.ts';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

for (const viewport of VIEWPORTS) {
  test.describe(`prompt management at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });

    test('searches, edits, validates, retries activation and restores history as a draft', async ({ page }) => {
      const errors = watchErrors(page);
      const definition = defaultPipelineDefinition();
      const previous = structuredClone(definition);
      previous.systemPrompt += '\nRevisão anterior de teste.';
      let view: PipelineView = { active: pipelineRevision(definition, 2), history: [pipelineRevision(previous, 1)], runs: [], providers: { openai: true, groq: true, anthropic: true } };
      let saves = 0;
      const checkpoint = emptyEditorialCheckpoint();
      await page.route('**/api/reporter/pipeline', route => route.fulfill({ json: view }));
      await page.route('**/api/reporter/workspace', async route => {
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          expect(payload.method).toBe('pipeline.save');
          expect(payload.args[1]).toBe(2);
          saves++;
          if (saves === 1) return route.fulfill({ json: { ok: false, refusal: { code: 'conflict', message: 'Falha simulada; tente novamente.' } } });
          view = { ...view, active: pipelineRevision(payload.args[0] as PipelineDefinition, 3), history: [...view.history, view.active] };
          return route.fulfill({ json: { ok: true, value: view } });
        }
        return route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } });
      });
      await page.goto('/config');
      await expect(page.getByRole('button', { name: 'Recarregar', exact: true })).toHaveCount(0);
      // The active revision already runs this build's defaults: nothing to upgrade.
      await expect(page.getByText('Prompts padrão 3.0')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('workers.png'), fullPage: true });
      await page.getByRole('button', { name: 'Abrir worker Gerar artigo' }).click();
      await expect(page.getByRole('heading', { name: 'Gerar artigo', level: 1 })).toBeVisible();
      await expect(page).toHaveURL(/\?worker=article$/);
      await expect(page.getByRole('tab', { name: /^Workers/ })).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('heading', { name: 'Prompts', level: 1 })).toBeVisible();
      await page.goForward();
      await expect(page.getByRole('heading', { name: 'Gerar artigo', level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Recarregar', exact: true })).toBeVisible();
      const flow = page.getByRole('list', { name: 'Fluxo do worker Gerar artigo' });
      await expect(flow.getByTestId('worker-node-facts')).toBeVisible();
      await expect(flow.getByTestId('worker-node-images')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('article-flow.png'), fullPage: true });
      await flow.getByRole('button', { name: 'Editar Estrutura do artigo' }).click();
      await expect(page.getByRole('dialog', { name: 'Estrutura do artigo', exact: true })).toBeVisible();
      await page.getByRole('dialog', { name: 'Estrutura do artigo', exact: true }).getByRole('button', { name: 'Fechar edição' }).click();
      await page.getByRole('navigation', { name: 'Trilha de navegação' }).getByRole('link', { name: 'Prompts', exact: true }).click();
      await page.getByRole('button', { name: 'Abrir worker Gerar carrossel' }).click();
      await expect(page.getByTestId('worker-node-carousel')).toBeVisible();
      await expect(page.getByTestId('worker-node-outline')).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      // An event format has its own worker: its AI blocks open the format's own prompts.
      await page.getByRole('navigation', { name: 'Trilha de navegação' }).getByRole('link', { name: 'Prompts', exact: true }).click();
      await page.getByRole('button', { name: 'Abrir worker Gerar cobertura de estande' }).click();
      await expect(page.getByRole('heading', { name: 'Gerar cobertura de estande', level: 1 })).toBeVisible();
      const stand = page.getByRole('list', { name: 'Fluxo do worker Gerar cobertura de estande' });
      await expect(stand.getByTestId('worker-node-grounding')).toBeVisible();
      await expect(stand.getByText('IA · editável')).toHaveCount(5);
      await expect(stand.getByTestId('worker-node-images')).toHaveCount(0);
      // Default funnel prompts are not stored in the revision; they must not read as edited.
      await expect(stand.getByText('Alterado', { exact: true })).toHaveCount(0);
      await stand.getByRole('button', { name: 'Editar Estrutura do formato' }).click();
      const funnel = page.getByRole('dialog', { name: 'Cobertura de estande · Estrutura', exact: true });
      await expect(funnel.getByRole('textbox', { name: 'Instruções do prompt' })).toHaveValue(/COBERTURA DE ESTANDE/);
      await funnel.getByRole('button', { name: 'Fechar edição' }).click();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('stand-flow.png'), fullPage: true });
      await page.getByRole('navigation', { name: 'Trilha de navegação' }).getByRole('link', { name: 'Prompts', exact: true }).click();
      await page.getByRole('tab', { name: /^Todos os prompts/ }).click();
      await expect(page.getByRole('heading', { name: 'Prompts', level: 1 })).toBeVisible();
      await expect(page).toHaveURL(/\?tab=prompts$/);
      const search = page.getByRole('searchbox', { name: 'Buscar prompts' });
      await expect(search).toBeVisible();
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('prompts.png'), fullPage: true });
      await search.fill('nao-existe');
      await expect(page.getByText('Nenhum prompt encontrado', { exact: true })).toBeVisible();
      await search.fill('estrutura do artigo');
      await expect(page.getByRole('button', { name: /^Editar / })).toHaveCount(1);
      await page.getByRole('button', { name: 'Editar Estrutura do artigo', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Estrutura do artigo', exact: true });
      const prompt = editor.getByRole('textbox', { name: 'Instruções do prompt' });
      await expect(prompt).toHaveValue(definition.steps.outline.prompt);
      await prompt.fill('Sem variáveis');
      await expect(editor.getByRole('button', { name: 'Salvar e ativar tudo', exact: true })).toBeDisabled();
      const edited = definition.steps.outline.prompt + '\nUse linguagem clara.';
      await prompt.fill(edited);
      await editor.getByRole('button', { name: 'Fechar edição' }).click();
      await page.getByRole('button', { name: 'Editar Estrutura do artigo', exact: true }).click();
      await expect(prompt).toHaveValue(edited);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('prompt-editor.png'), fullPage: true });
      await editor.getByRole('button', { name: 'Salvar e ativar tudo', exact: true }).click();
      await expect(editor.getByText('Falha simulada; tente novamente.')).toBeVisible();
      await expect(editor.getByRole('button', { name: 'Salvar e ativar tudo', exact: true })).toBeEnabled();
      await editor.getByRole('button', { name: 'Salvar e ativar tudo', exact: true }).click();
      await expect(editor.getByText('Revisão 3 ativa', { exact: true })).toBeVisible();
      expect(saves).toBe(2);
      expect(view.active.definition.steps.outline.prompt).toBe(edited);
      await editor.getByRole('button', { name: 'Fechar edição' }).click();
      await page.getByRole('tab', { name: /^Histórico/ }).click();
      await page.getByRole('combobox', { name: 'Revisão anterior' }).click();
      await page.getByRole('option', { name: /^Revisão 1/ }).click();
      await page.getByRole('button', { name: 'Carregar para edição' }).click();
      await expect(page.getByText('Alterações não ativadas', { exact: true })).toBeVisible();
      expect(saves).toBe(2);
      await page.getByRole('tab', { name: /^Workers/ }).click();
      await page.getByRole('button', { name: 'Abrir worker Gerar artigo' }).click();
      await page.getByRole('navigation', { name: 'Trilha de navegação' }).getByRole('link', { name: 'Prompts', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Prompts', level: 1 })).toBeVisible();
      await expect(page.getByText('Alterações não ativadas', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Sair sem ativar os prompts?' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Abrir worker Gerar artigo' }).click();
      await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Descartar as alterações?', exact: true });
      await confirm.getByRole('button', { name: 'Continuar editando' }).click();
      await expect(confirm).not.toBeVisible();
      await expect(page.getByText('Alterações não ativadas', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
      await confirm.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
      await expect(page.getByText('Revisão 3 ativa', { exact: true }).first()).toBeVisible();
      expect(errors).toEqual([]);
    });

    test('offers the 3.0 prompts over an untouched revision 1 and activates them as revision 2', async ({ page }) => {
      const errors = watchErrors(page);
      const revisionOne = JSON.parse(readFileSync('tests/fixtures/pipeline-revision-1.json', 'utf8')) as PipelineDefinition;
      let view: PipelineView = { active: pipelineRevision(revisionOne, 1), history: [], runs: [], providers: { openai: true, groq: true, anthropic: true } };
      let saves = 0;
      const checkpoint = emptyEditorialCheckpoint();
      await page.route('**/api/reporter/pipeline', route => route.fulfill({ json: view }));
      await page.route('**/api/reporter/workspace', async route => {
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON();
          expect(payload.method).toBe('pipeline.save');
          expect(payload.args[1]).toBe(1);
          const saved = payload.args[0] as PipelineDefinition;
          expect(saved.systemPrompt.startsWith('Reporter IA — prompts editoriais 3.0')).toBe(true);
          expect(saved.steps.intro.model).toBe('openai/gpt-6-astra');
          expect(saved.steps.material.maxTokens).toBe(2048);
          saves++;
          view = { ...view, active: pipelineRevision(saved, 2, new Date().toISOString()), history: [view.active] };
          return route.fulfill({ json: { ok: true, value: view } });
        }
        return route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } });
      });
      await page.goto('/config');
      await expect(page.getByText('11 prompts no padrão anterior passam para o 3.0.', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole('tab', { name: /^Todos os prompts/ }).click();
      await expect(page.getByText('Padrão anterior', { exact: true })).toHaveCount(11);
      await page.getByRole('button', { name: 'Ver mudanças', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Prompts padrão 3.0', exact: true });
      await expect(drawer.getByRole('button', { name: /Diretrizes gerais/ })).toBeVisible();
      await drawer.getByRole('button', { name: /Diretrizes gerais/ }).click();
      await expect(drawer.getByText('NOTÍCIA — O PADRÃO DE TODO TEXTO DA REDAÇÃO')).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('preset-upgrade.png'), fullPage: true });
      await drawer.getByRole('button', { name: 'Atualizar para 3.0', exact: true }).click();
      await expect(page.getByText('Prompts 3.0 ativados · revisão 2', { exact: true })).toBeVisible();
      await expect(page.getByText('Prompts padrão 3.0')).toHaveCount(0);
      await expect(page.getByText('Revisão 2 ativa', { exact: true })).toBeVisible();
      await expect(page.getByText('Padrão anterior', { exact: true })).toHaveCount(0);
      expect(saves).toBe(1);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  });
}
