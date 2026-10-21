import { expect, test, type Page } from '@playwright/test';
import { defaultEditorialPolicy } from '../src/domain/editorial-policy.ts';
import { defaultPipelineDefinition, pipelineModelLabel, pipelineRevision, type PipelineView } from '../src/domain/pipeline.ts';
import { defaultWritingOrchestration, WRITING_EDITORIAL_CHECK_KEYS, WRITING_EDITORIAL_CHECK_LABELS, WRITING_REVIEW_CRITERIA_KEYS, WRITING_REVIEW_CRITERIA_LABELS, WRITING_STAGES, WRITING_STAGE_LABELS, type WritingTrace } from '../src/domain/writing-orchestration.ts';
import { defaultWritingResearch, type WritingResearchSnapshot } from '../src/domain/writing-research.ts';
import type { WritingRunDetails } from '../src/ports/pipeline-settings.ts';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

function fixture() {
  const definition = defaultPipelineDefinition();
  definition.editorial = defaultEditorialPolicy();
  definition.editorial.map = { ...definition.editorial.map, version: 2, audience: 'Compradores e produtores de pescado.' };
  definition.editorial.guide = { ...definition.editorial.guide, version: 3, voice: 'Use voz objetiva e atribua as alegações.' };
  definition.writing = defaultWritingOrchestration();
  return { active: pipelineRevision(definition, 2), history: [], runs: [], providers: { openai: true, groq: true, anthropic: true, gemini: true } } satisfies PipelineView;
}

type Scenario = {
  view: PipelineView; details: Record<string, WritingRunDetails>; commands: { method: string; args: unknown[] }[];
  unexpected: string[]; conflictOnce?: boolean;
};

/** Every Reporter endpoint is intercepted: these checks never generate a paid model call. */
async function mockReporter(page: Page, scenario: Scenario) {
  const checkpoint = emptyEditorialCheckpoint();
  await page.route('**/api/reporter/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/reporter/pipeline') return route.fulfill({ json: scenario.view });
    if (path.startsWith('/api/reporter/pipeline/runs/')) {
      const run = scenario.details[decodeURIComponent(path.split('/').at(-1)!)];
      if (run) return route.fulfill({ json: run });
    }
    if (path === '/api/reporter/workspace') {
      if (request.method() === 'GET') return route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } });
      const payload = request.postDataJSON();
      scenario.commands.push({ method: payload.method, args: payload.args });
      if (payload.method === 'pipeline.save') {
        expect(payload.args[1]).toBe(scenario.view.active.revision);
        if (scenario.conflictOnce) {
          scenario.conflictOnce = false;
          return route.fulfill({ json: { ok: false, refusal: { code: 'conflict', message: 'Outra revisão foi salva. Seu rascunho continua nesta página.' } } });
        }
        scenario.view = { ...scenario.view, history: [...scenario.view.history, scenario.view.active], active: pipelineRevision(payload.args[0], scenario.view.active.revision + 1) };
        return route.fulfill({ json: { ok: true, value: scenario.view } });
      }
      if (payload.method === 'generation.retry') {
        expect(payload.args).toEqual(['run-failed']);
        const previous = scenario.details['run-failed'];
        scenario.details['run-retry'] = { ...previous, runId: 'run-retry', status: 'running', error: undefined,
          pipeline: scenario.view.active, traces: [{ ...previous.traces[0], id: 'trace-new', status: 'running', completedAt: undefined, output: undefined }] };
        return route.fulfill({ json: { ok: true, value: { runId: 'run-retry' } } });
      }
      if (payload.method === 'generation.cancel') {
        expect(payload.args).toEqual(['run-retry']);
        scenario.details['run-retry'].status = 'cancelled';
        return route.fulfill({ json: { ok: true, value: {} } });
      }
    }
    scenario.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { message: 'Unexpected mock request' } });
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`writing orchestration at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });

    test('configures every stage, previews policy composition and preserves changes across a save conflict', async ({ page }) => {
      const errors = watchErrors(page);
      const scenario: Scenario = { view: fixture(), details: {}, commands: [], unexpected: [], conflictOnce: true };
      delete scenario.view.active.definition.writing!.minimumQuotes;
      await mockReporter(page, scenario);
      await page.goto('/config?tab=writing');
      await expect(page.getByRole('heading', { name: 'Redação', level: 1 })).toBeVisible();
      const minimumQuotes = page.getByRole('combobox', { name: 'Mínimo de citações diretas', exact: true });
      await expect(minimumQuotes).toContainText('Padrão do formato');
      await minimumQuotes.click();
      await page.getByRole('option', { name: '2 citações', exact: true }).click();
      await expect(minimumQuotes).toContainText('2 citações');
      await minimumQuotes.click();
      await page.getByRole('option', { name: 'Sem mínimo obrigatório (0)', exact: true }).click();
      await expect(minimumQuotes).toContainText('Sem mínimo obrigatório (0)');
      await page.getByRole('switch', { name: 'Usar planejamento, redação e revisão' }).click();
      await page.getByRole('textbox', { name: 'Instruções compartilhadas da redação' }).fill('Priorize o fato novo com evidência identificada.');
      const researchEnabled = page.getByRole('switch', { name: 'Pesquisar contexto com Tavily', exact: true });
      await expect(researchEnabled).not.toBeChecked();
      await researchEnabled.click();
      await page.getByRole('textbox', { name: 'Orientações para a pesquisa', exact: true }).fill('Busque documentação primária sobre os produtos citados.');
      for (const [name, value] of [['Máximo de consultas por artigo', '3'], ['Resultados por consulta', '4'], ['Máximo de fontes externas por artigo', '8'], ['Tempo limite por consulta', '15']]) {
        const input = page.getByRole('spinbutton', { name, exact: true });
        await input.fill(value); await input.press('Tab');
      }
      await page.getByRole('combobox', { name: 'Se a pesquisa falhar', exact: true }).click();
      await page.getByRole('option', { name: 'Continuar com o conteúdo original', exact: true }).click();
      await page.getByRole('textbox', { name: 'Domínios excluídos da pesquisa', exact: true }).fill('example.com\nexample.org');
      await page.getByRole('textbox', { name: 'URLs excluídas da pesquisa', exact: true }).fill('https://example.net/benchmark');
      await page.getByRole('textbox', { name: 'URLs excluídas da pesquisa', exact: true }).press('Tab');
      const chosen = ['google/gemini-3.8-flash', 'anthropic/claude-opus-5-5', 'openai/gpt-6-astra', 'google/gemini-4-argon'] as const;
      for (const [index, stage] of WRITING_STAGES.entries()) {
        const label = WRITING_STAGE_LABELS[stage];
        await page.getByRole('combobox', { name: `Modelo · ${label}`, exact: true }).click();
        const listId = await page.getByRole('combobox', { name: `Modelo · ${label}`, exact: true }).getAttribute('aria-controls');
        await page.locator(`[id="${listId}"]`).getByRole('option', { name: pipelineModelLabel(chosen[index]), exact: true }).click();
        await page.getByRole('textbox', { name: `Instruções · ${label}`, exact: true }).fill(`Tarefa ${stage}: preserve a origem de cada fato.`);
      }
      for (const key of WRITING_REVIEW_CRITERIA_KEYS) await page.getByRole('textbox', { name: `Critério · ${WRITING_REVIEW_CRITERIA_LABELS[key]}`, exact: true }).fill(`Critério ${key}: confira fatos e trechos após cada correção.`);
      await page.getByRole('combobox', { name: 'Esforço de raciocínio · Redigir artigo completo', exact: true }).click();
      await page.getByRole('option', { name: 'Alto', exact: true }).click();
      await expect(page.getByRole('spinbutton', { name: 'Temperatura · Redigir artigo completo', exact: true })).toHaveCount(0);
      const limit = page.getByRole('spinbutton', { name: 'Limite de conteúdo por geração' });
      await limit.click();
      await limit.fill('80000');
      await expect(limit).toHaveAttribute('aria-valuenow', '80000');
      await limit.press('Tab');
      await page.getByRole('combobox', { name: 'Correção após a revisão' }).click();
      await page.getByRole('option', { name: 'Parar e analisar pendências', exact: true }).click();
      await page.getByRole('textbox', { name: 'Conteúdo para prévia' }).fill('A cooperativa informou crescimento de 12% na produção.');
      await page.getByLabel('Data da fonte na prévia', { exact: true }).fill('2026-05-18');
      await page.getByLabel('Data de execução na prévia', { exact: true }).fill('2026-10-21');
      await page.getByRole('button', { name: 'Ver instruções efetivas', exact: true }).click();
      const prompt = page.getByRole('textbox', { name: 'Prévia do prompt de sistema' });
      await expect(prompt).toHaveValue(/Compradores e produtores de pescado/);
      await expect(prompt).toHaveValue(/Use voz objetiva e atribua as alegações/);
      await expect(prompt).toHaveValue(/Priorize o fato novo com evidência identificada/);
      await expect(prompt).toHaveValue(/Tarefa plan: preserve a origem de cada fato/);
      await expect(prompt).toHaveValue(/Busque documentação primária sobre os produtos citados/);
      await page.getByRole('button', { name: 'Ver contrato de saída · Preparar e planejar', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Contrato de saída · Preparar e planejar', exact: true })).toHaveValue(/"research"/);
      await expect(prompt).toHaveValue(/MÍNIMO DE CITAÇÕES\n\n0: sem quota/);
      await page.getByRole('combobox', { name: 'Etapa da prévia', exact: true }).click();
      await page.getByRole('option', { name: 'Revisar artigo', exact: true }).click();
      for (const key of WRITING_REVIEW_CRITERIA_KEYS) await expect(prompt).toHaveValue(new RegExp(`Critério ${key}: confira fatos e trechos após cada correção`));
      await page.getByRole('button', { name: 'Ver entrada composta', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Prévia da entrada' })).toHaveValue(/crescimento de 12%/);
      const previewInput = page.getByRole('textbox', { name: 'Prévia da entrada' });
      await expect(previewInput).toHaveValue(/"recordedOn":"2026-05-18"/);
      await expect(previewInput).toHaveValue(/"executionDate":"2026-10-21"/);
      await page.getByLabel('Data da fonte na prévia', { exact: true }).fill('');
      await expect(previewInput).toHaveValue(/"recordedOn":null/);
      expect(scenario.commands).toHaveLength(0);
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: 'Salvar e ativar', exact: true }).click();
      await expect(page.getByText('Outra revisão foi salva. Seu rascunho continua nesta página.')).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Instruções · Redigir artigo completo', exact: true })).toHaveValue('Tarefa write: preserve a origem de cada fato.');
      await expect(page.getByRole('switch', { name: 'Usar planejamento, redação e revisão' })).toBeChecked();
      await page.getByRole('button', { name: 'Salvar e ativar', exact: true }).click();
      await expect(page.getByText('Revisão 3 ativa', { exact: true })).toBeVisible();
      expect(scenario.view.active.definition.writing?.enabled).toBe(true);
      expect(scenario.view.active.definition.writing?.maxCorrections).toBe(0);
      expect(scenario.view.active.definition.writing?.maxSourceCharacters).toBe(80000);
      expect(scenario.view.active.definition.writing?.minimumQuotes).toBe(0);
      expect(scenario.view.active.definition.writing?.research).toEqual({ ...defaultWritingResearch(), enabled: true,
        instructions: 'Busque documentação primária sobre os produtos citados.', maxQueries: 3, maxResults: 4, maxSources: 8,
        timeoutMs: 15000, failureMode: 'continue_original', excludeDomains: ['example.com', 'example.org'], excludeUrls: ['https://example.net/benchmark'] });
      expect(scenario.view.active.definition.writing?.stages.write.effort).toBe('high');
      for (const key of WRITING_REVIEW_CRITERIA_KEYS) expect(scenario.view.active.definition.writing?.reviewCriteria?.[key]).toBe(`Critério ${key}: confira fatos e trechos após cada correção.`);
      for (const [index, stage] of WRITING_STAGES.entries()) expect(scenario.view.active.definition.writing?.stages[stage].model).toBe(chosen[index]);
      await page.reload();
      await expect(page.getByLabel('Data da fonte na prévia', { exact: true })).toHaveValue('');
      await expect(page.getByRole('switch', { name: 'Usar planejamento, redação e revisão' })).toBeChecked();
      await expect(researchEnabled).toBeChecked();
      await expect(page.getByRole('textbox', { name: 'Orientações para a pesquisa', exact: true })).toHaveValue('Busque documentação primária sobre os produtos citados.');
      await expect(page.getByRole('textbox', { name: 'Domínios excluídos da pesquisa', exact: true })).toHaveValue('example.com\nexample.org');
      await expect(page.getByRole('combobox', { name: 'Se a pesquisa falhar', exact: true })).toContainText('Continuar com o conteúdo original');
      await expect(minimumQuotes).toContainText('Sem mínimo obrigatório (0)');
      await expect(page.getByRole('textbox', { name: 'Instruções compartilhadas da redação' })).toHaveValue('Priorize o fato novo com evidência identificada.');
      await expect(page.getByRole('combobox', { name: 'Esforço de raciocínio · Redigir artigo completo', exact: true })).toContainText('Alto');
      for (const key of WRITING_REVIEW_CRITERIA_KEYS) await expect(page.getByRole('textbox', { name: `Critério · ${WRITING_REVIEW_CRITERIA_LABELS[key]}`, exact: true })).toHaveValue(`Critério ${key}: confira fatos e trechos após cada correção.`);
      for (const [index, stage] of WRITING_STAGES.entries()) await expect(page.getByRole('combobox', { name: `Modelo · ${WRITING_STAGE_LABELS[stage]}`, exact: true })).toContainText(pipelineModelLabel(chosen[index]));
      await page.getByRole('button', { name: 'Usar instrução recomendada · Revisar artigo', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Instruções · Revisar artigo', exact: true })).toHaveValue(defaultWritingOrchestration().stages.review.prompt);
      await expect(page.getByRole('textbox', { name: 'Instruções · Redigir artigo completo', exact: true })).toHaveValue('Tarefa write: preserve a origem de cada fato.');
      await page.getByRole('button', { name: 'Restaurar critérios recomendados', exact: true }).click();
      for (const key of WRITING_REVIEW_CRITERIA_KEYS) await expect(page.getByRole('textbox', { name: `Critério · ${WRITING_REVIEW_CRITERIA_LABELS[key]}`, exact: true })).toHaveValue(defaultWritingOrchestration().reviewCriteria![key]);
      await page.getByRole('textbox', { name: 'Instruções compartilhadas da redação' }).fill('Rascunho temporário');
      await page.getByRole('button', { name: 'Descartar alterações', exact: true }).click();
      await page.getByRole('dialog', { name: 'Descartar as alterações?', exact: true }).getByRole('button', { name: 'Descartar alterações', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Descartar as alterações?', exact: true })).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: 'Instruções compartilhadas da redação' })).toHaveValue('Priorize o fato novo com evidência identificada.');
      await expect(page.getByRole('textbox', { name: 'Instruções · Revisar artigo', exact: true })).toHaveValue('Tarefa review: preserve a origem de cada fato.');
      for (const key of WRITING_REVIEW_CRITERIA_KEYS) await expect(page.getByRole('textbox', { name: `Critério · ${WRITING_REVIEW_CRITERIA_LABELS[key]}`, exact: true })).toHaveValue(`Critério ${key}: confira fatos e trechos após cada correção.`);
      await minimumQuotes.click();
      await page.getByRole('option', { name: 'Padrão do formato', exact: true }).click();
      await page.getByRole('button', { name: 'Salvar e ativar', exact: true }).click();
      await expect(page.getByText('Revisão 4 ativa', { exact: true })).toBeVisible();
      expect(scenario.view.active.definition.writing?.minimumQuotes).toBeNull();
      await page.reload();
      await expect(minimumQuotes).toContainText('Padrão do formato');
      await page.getByRole('button', { name: 'Ver instruções efetivas', exact: true }).click();
      await expect(prompt).toHaveValue(/MÍNIMO DE CITAÇÕES\n\nPadrão do formato/);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('writing-settings.png'), fullPage: true, animations: 'disabled' });
      expect(scenario.commands.map(item => item.method)).toEqual(['pipeline.save', 'pipeline.save', 'pipeline.save']);
      expect(JSON.stringify(scenario.commands)).not.toContain('temporalContext');
      expect(scenario.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('shows essential fact coverage, original evidence and unresolved correction findings', async ({ page }) => {
      const errors = watchErrors(page), view = fixture();
      view.active.definition.writing!.minimumQuotes = null;
      const source = [{ id: 'source-cost', text: 'A palestra compara custos e as possibilidades de mudança no longo prazo.' }];
      const plan = { essentialFactIds: ['fact-product', 'fact-cost', 'fact-market'], facts: [
        { id: 'fact-product', text: 'A empresa apresentou a vacina.', evidenceIds: ['source-cost'] },
        { id: 'fact-cost', text: 'A palestra aborda custos e possibilidades de mudança no longo prazo.', evidenceIds: ['source-cost'] },
        { id: 'fact-market', text: 'A previsão é atribuída à fonte.', evidenceIds: ['source-cost'] },
      ] };
      const article = { title: 'Empresa debate custos', dek: '', blocks: [
        { id: 'lead', type: 'paragraph', text: 'A empresa apresentou a vacina e comparou custos.' },
        { id: 'note', type: 'paragraph', text: 'Declaração sem verificação no material disponível.' },
      ] };
      const previousArticle = { ...article, blocks: [{ id: 'note', type: 'paragraph', text: 'Informação ainda não verificada.' }] };
      const previous = { issues: [{ id: 'issue-note', blockId: 'note', message: 'A nota interna deve sair do artigo.', suggestion: 'Remova a nota e mantenha a informação atribuída.' }] };
      const trace: WritingTrace = { id: 'trace-audit', stage: 'review', attempt: 2, status: 'failed', startedAt: '2026-10-21T13:00:00.000Z', completedAt: '2026-10-21T13:00:02.000Z',
        model: 'anthropic/claude-opus-5-5', hash: 'audit-hash', parameters: { maxTokens: 8192, effort: 'high' },
        prompt: { system: 'Confira cada fato e apontamento.', user: 'DADOS DA EXECUÇÃO\n' + JSON.stringify({ brief: { limits: { minQuotes: 1 } }, source, plan, article, previousArticle, review: previous }) },
        error: 'Falta a verificação de um fato essencial.', output: { decision: 'revise', summary: 'A correção omitiu a finalidade de longo prazo.', issues: [], audit: {
          factualSummary: 'A comparação de custos está sustentada.', editorialSummary: 'A nota interna permanece no texto.',
          factChecks: [
            { factId: 'fact-product', status: 'preserved', articlePassages: [{ blockId: 'lead', text: 'A empresa apresentou a vacina' }], evidenceIds: ['source-cost'], reason: 'A ação foi preservada.' },
            { factId: 'fact-cost', status: 'partial', articlePassages: [{ blockId: 'lead', text: 'comparou custos' }], evidenceIds: ['source-cost'], reason: 'A finalidade de mudança no longo prazo foi removida.' },
          ],
          issueChecks: [{ issueId: 'issue-note', status: 'unresolved', articlePassages: [{ blockId: 'note', text: article.blocks[1].text }], reason: 'A frase foi reformulada, mas o problema continua.' }],
        } } };
      const details: WritingRunDetails = { runId: 'run-audit', productionId: 'production-fixture', status: 'failed', pipeline: structuredClone(view.active), traces: [trace] };
      const scenario: Scenario = { view: { ...view, runs: [{ runId: 'run-audit', productionId: 'production-fixture', label: 'Revisão com preservação', status: 'failed', pipelineRevision: 2, pipelineHash: view.active.hash, calls: [], writing: { stages: 1, decision: 'revise' } }] }, details: { 'run-audit': details }, commands: [], unexpected: [] };
      await mockReporter(page, scenario);
      await page.goto('/config?tab=runs');
      await page.getByRole('button', { name: /Revisão com preservação/ }).click();
      await page.getByRole('region', { name: /Revisão com preservação/ }).getByRole('button', { name: 'Ver execução', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Detalhes da redação', exact: true });
      await expect(drawer.getByText('Alto', { exact: true })).toBeVisible();
      await expect(drawer.getByText('8.192 tokens', { exact: true })).toBeVisible();
      await expect(drawer.getByText('1 · padrão do formato', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Verificação editorial por eixo não registrada', exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: /^Edição ·/ })).toHaveCount(0);
      await drawer.getByRole('button', { name: 'Ver revisão factual e editorial', exact: true }).click();
      await expect(drawer.getByText('A comparação de custos está sustentada.', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: /fact-product · Preservado/ })).toBeVisible();
      await expect(drawer.getByRole('button', { name: /fact-market · Não verificado/ })).toBeVisible();
      await drawer.getByRole('button', { name: /fact-cost · Parcial/ }).click();
      await expect(drawer.getByText('A palestra aborda custos e possibilidades de mudança no longo prazo.', { exact: true })).toBeVisible();
      const fact = drawer.getByRole('region', { name: /Fato essencial · fact-cost/ });
      await expect(fact.getByText(source[0].text, { exact: true })).toBeVisible();
      await expect(fact.getByText(article.blocks[0].text, { exact: true })).toBeVisible();
      await fact.screenshot({ path: test.info().outputPath('writing-essential-fact.png'), animations: 'disabled' });
      await drawer.getByRole('button', { name: /issue-note · Não resolvido/ }).click();
      await expect(drawer.getByText('A nota interna deve sair do artigo.', { exact: true })).toBeVisible();
      await expect(drawer.getByText(previousArticle.blocks[0].text, { exact: true })).toBeVisible();
      await expect(drawer.getByText('A frase foi reformulada, mas o problema continua.', { exact: true })).toBeVisible();
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await drawer.screenshot({ path: test.info().outputPath('writing-fact-audit.png'), animations: 'disabled' });
      expect(scenario.commands).toEqual([]);
      expect(scenario.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('shows each editorial axis with its actual passages and linked correction', async ({ page }) => {
      const errors = watchErrors(page), view = fixture();
      const article = { title: 'Empresa debate sanidade', dek: '', blocks: [
        { id: 'lead', type: 'paragraph', text: 'Segundo a empresa, os custos de sanidade foram discutidos no evento.' },
        { id: 'quote', type: 'paragraph', text: 'A empresa discutiu os custos. “Discutimos os custos”, afirmou a fonte.' },
      ] };
      const issue = { id: 'issue-repetition', severity: 'major', code: 'editorial_economy', blockId: 'quote', evidenceIds: [],
        message: 'A fala repete a informação da narração.', suggestion: 'Retire a repetição e preserve a informação sobre custos.' };
      const trace: WritingTrace = { id: 'trace-editorial', stage: 'review', attempt: 1, status: 'completed', startedAt: '2026-10-21T13:00:00.000Z', completedAt: '2026-10-21T13:00:02.000Z',
        model: 'openai/gpt-6-astra', hash: 'editorial-hash', parameters: { maxTokens: 8192, effort: 'low' },
        prompt: { system: 'Confira a qualidade editorial em cada eixo.', user: 'DADOS DA EXECUÇÃO\n' + JSON.stringify({ article, plan: { facts: [], essentialFactIds: [] }, source: [] }) },
        output: { decision: 'revise', summary: 'O texto exige edição na narração e na citação.', issues: [issue], audit: {
          factualSummary: 'A discussão dos custos está atribuída.', editorialSummary: 'A citação repete a narração.', factChecks: [], issueChecks: [],
          editorialChecks: WRITING_EDITORIAL_CHECK_KEYS.map(criterion => {
            const revise = criterion === 'economy' || criterion === 'quotes';
            return { criterion, status: revise ? 'revise' : 'pass', articlePassages: [{ blockId: revise ? 'quote' : 'lead', text: article.blocks[revise ? 1 : 0].text }],
              issueIds: revise ? [issue.id] : [], reason: revise ? 'A fala não acrescenta informação ao que a narração já explicou.' : `O eixo ${WRITING_EDITORIAL_CHECK_LABELS[criterion]} está atendido no trecho indicado.` };
          }),
        } } };
      const details: WritingRunDetails = { runId: 'run-editorial', productionId: 'production-fixture', status: 'failed', pipeline: structuredClone(view.active), traces: [trace] };
      const scenario: Scenario = { view: { ...view, runs: [{ runId: 'run-editorial', productionId: 'production-fixture', label: 'Revisão por eixo editorial', status: 'failed', pipelineRevision: 2, pipelineHash: view.active.hash, calls: [], writing: { stages: 1, decision: 'revise' } }] }, details: { 'run-editorial': details }, commands: [], unexpected: [] };
      await mockReporter(page, scenario);
      await page.goto('/config?tab=runs');
      await page.getByRole('button', { name: /Revisão por eixo editorial/ }).click();
      await page.getByRole('region', { name: /Revisão por eixo editorial/ }).getByRole('button', { name: 'Ver execução', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Detalhes da redação', exact: true });
      await expect(drawer.getByText('Sem mínimo obrigatório (0)', { exact: true })).toBeVisible();
      for (const criterion of WRITING_EDITORIAL_CHECK_KEYS) await expect(drawer.getByRole('button', { name: `Edição · ${WRITING_EDITORIAL_CHECK_LABELS[criterion]} · ${criterion === 'economy' || criterion === 'quotes' ? 'Revisar' : 'Atendido'}` })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Verificação editorial por eixo não registrada', exact: true })).toHaveCount(0);
      await drawer.getByRole('button', { name: `Edição · ${WRITING_EDITORIAL_CHECK_LABELS.economy} · Revisar` }).click();
      const axis = drawer.getByRole('region', { name: `Edição · ${WRITING_EDITORIAL_CHECK_LABELS.economy} · Revisar`, exact: false });
      await expect(axis.getByText('A fala não acrescenta informação ao que a narração já explicou.', { exact: true })).toBeVisible();
      await expect(axis.getByText('Texto do bloco nesta revisão', { exact: true })).toBeVisible();
      await expect(axis.getByText(article.blocks[1].text, { exact: true })).toHaveCount(2);
      await expect(axis.getByText('Apontamento · issue-repetition', { exact: true })).toBeVisible();
      await expect(axis.getByText(/Retire a repetição e preserve a informação sobre custos/)).toBeVisible();
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await axis.screenshot({ path: test.info().outputPath('writing-editorial-axis.png'), animations: 'disabled' });
      expect(scenario.commands).toEqual([]);
      expect(scenario.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('shows source dates, editorial progression and optional unresolved suggestions from the saved run', async ({ page }) => {
      const errors = watchErrors(page), view = fixture();
      const temporalContext = { executionDate: '2026-10-21', sources: [
        { sourceId: 'interview', title: 'Entrevista durante a feira', recordedOn: '2026-05-18' },
        { sourceId: 'notes', title: 'Anotações complementares', recordedOn: null },
      ] };
      const brief = { temporalContext, event: { name: 'Feira do pescado', dates: '18 a 21 de maio de 2026' } };
      const plan = { decision: 'ready', angle: 'Apresentação de produto e discussão dos custos de sanidade.',
        outline: ['Apresentar o produto e sua finalidade.', 'Explicar a comparação dos custos e sua finalidade de longo prazo.'],
        facts: [], essentialFactIds: [], issues: ['Confirmar o cargo da fonte antes de acrescentar uma função; a atribuição pelo nome permite seguir.'] };
      const article = { title: 'Empresa debate sanidade', dek: '', blocks: [
        { id: 'lead', type: 'paragraph', text: 'Na entrevista, a fonte avaliou os preços como estáveis.' },
        { id: 'cost-heading', type: 'heading', text: 'Custos de sanidade' },
      ] };
      const previousArticle = { ...article, blocks: [{ id: 'lead', type: 'paragraph', text: 'Os preços seguem estáveis.' }, article.blocks[1]] };
      const previous = { issues: [
        { id: 'date-scope', severity: 'major', blockId: 'lead', message: 'A avaliação foi apresentada como atual.', suggestion: 'Situe a afirmação no momento da entrevista.' },
        { id: 'heading-choice', severity: 'minor', blockId: 'cost-heading', message: 'O intertítulo poderia ser integrado à abertura.', suggestion: 'Considere manter apenas a divisão de mercado.' },
      ] };
      const planTrace: WritingTrace = { id: 'plan-temporal', stage: 'plan', attempt: 1, status: 'completed',
        startedAt: '2026-10-21T13:00:00.000Z', completedAt: '2026-10-21T13:00:01.000Z', model: 'openai/gpt-6-astra', hash: 'temporal-plan',
        prompt: { system: 'Planeje com o contexto das fontes.', user: 'DADOS DA EXECUÇÃO\n' + JSON.stringify({ brief }) }, output: plan };
      const reviewTrace: WritingTrace = { ...planTrace, id: 'review-temporal', stage: 'review', attempt: 2, hash: 'temporal-review',
        prompt: { system: 'Confira o escopo temporal.', user: 'DADOS DA EXECUÇÃO\n' + JSON.stringify({ brief, plan, article, previousArticle, review: previous }) },
        output: { decision: 'ready_for_human', summary: 'O escopo temporal foi corrigido; a sugestão de intertítulo continua opcional.', issues: [previous.issues[1]], audit: {
          factualSummary: 'A afirmação foi situada na entrevista.', editorialSummary: 'A divisão de assunto é uma escolha válida.', factChecks: [],
          editorialChecks: WRITING_EDITORIAL_CHECK_KEYS.map(criterion => ({ criterion, status: 'pass', articlePassages: [], issueIds: [], reason: 'O critério foi atendido.' })),
          issueChecks: [
            { issueId: 'date-scope', status: 'resolved', articlePassages: [{ blockId: 'lead', text: article.blocks[0].text }], reason: 'A redação deixou de afirmar que a avaliação permanece atual.' },
            { issueId: 'heading-choice', status: 'unresolved', articlePassages: [{ blockId: 'cost-heading', text: article.blocks[1].text }], reason: 'O intertítulo foi mantido; a preferência não impede a revisão humana.' },
          ],
        } } };
      const run: WritingRunDetails = { runId: 'run-temporal', productionId: 'production-fixture', status: 'completed', pipeline: structuredClone(view.active), traces: [planTrace, reviewTrace] };
      const scenario: Scenario = { view: { ...view, runs: [{ runId: run.runId, productionId: run.productionId, label: 'Redação com datas e sugestões', status: 'completed', pipelineRevision: 2, pipelineHash: view.active.hash, calls: [], writing: { stages: 2, decision: 'ready_for_human' } }] }, details: { [run.runId]: run }, commands: [], unexpected: [] };
      await mockReporter(page, scenario);
      await page.goto('/config?tab=runs');
      await page.getByRole('button', { name: /Redação com datas e sugestões/ }).click();
      await page.getByRole('region', { name: /Redação com datas e sugestões/ }).getByRole('button', { name: 'Ver execução', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Detalhes da redação', exact: true });
      await drawer.getByRole('button', { name: 'Ver datas e contexto · Preparar e planejar', exact: true }).click();
      const context = drawer.getByRole('region', { name: 'Ver datas e contexto · Preparar e planejar', exact: true });
      await expect(context.getByText('21/10/2026', { exact: true })).toBeVisible();
      await expect(context.getByText('18/05/2026', { exact: true })).toBeVisible();
      await expect(context.getByText('Não informada.', { exact: true })).toBeVisible();
      await expect(context.getByText('18 a 21 de maio de 2026', { exact: true })).toBeVisible();
      await expect(context.getByText('Anotações complementares', { exact: true })).toBeVisible();
      await context.screenshot({ path: test.info().outputPath('writing-temporal-context.png'), animations: 'disabled' });
      await drawer.getByRole('button', { name: 'Ver pauta e progressão', exact: true }).click();
      const planned = drawer.getByRole('region', { name: 'Ver pauta e progressão', exact: true });
      await expect(planned.getByText(plan.angle, { exact: true })).toBeVisible();
      for (const point of plan.outline) await expect(planned.getByText(point, { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: 'Ver apontamentos · Preparar e planejar', exact: true }).click();
      await expect(drawer.getByText(plan.issues[0], { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: 'Sugestão · heading-choice · Não resolvida · opcional', exact: true }).click();
      const optional = drawer.getByRole('region', { name: 'Sugestão · heading-choice · Não resolvida · opcional', exact: true });
      await expect(optional.getByText('Sugestão opcional', { exact: true })).toBeVisible();
      await expect(optional.getByText('Não resolvida · opcional', { exact: true })).toBeVisible();
      await expect(optional.getByText('O intertítulo foi mantido; a preferência não impede a revisão humana.', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Pronto para revisão humana', { exact: true })).toBeVisible();
      await optional.screenshot({ path: test.info().outputPath('writing-optional-finding.png'), animations: 'disabled' });
      await drawer.getByRole('button', { name: 'Correção · date-scope · Resolvido (concluído)', exact: true }).click();
      const required = drawer.getByRole('region', { name: 'Correção · date-scope · Resolvido (concluído)', exact: true });
      await expect(required.getByText('Relevante', { exact: true })).toBeVisible();
      await expect(required.getByText(previousArticle.blocks[0].text, { exact: true })).toBeVisible();
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      expect(scenario.commands).toEqual([]);
      expect(scenario.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('inspects recorded web provenance separately from originals and exposes failed queries', async ({ page }) => {
      const errors = watchErrors(page), view = fixture();
      view.active.definition.writing!.research = { ...defaultWritingResearch(), enabled: true, failureMode: 'continue_original' };
      const research: WritingResearchSnapshot = { status: 'completed', startedAt: '2026-10-21T13:00:00.000Z', completedAt: '2026-10-21T13:00:02.000Z',
        queries: [{ query: 'vacinação de tilápia documentação técnica', purpose: 'Esclarecer o conceito citado no material.', evidenceIds: ['original-1'], status: 'completed',
          startedAt: '2026-10-21T13:00:00.000Z', completedAt: '2026-10-21T13:00:02.000Z', sourceIds: ['web-1', 'web-2'], requestId: 'request-public-id', credits: 1 }],
        sources: [{ id: 'web-1', kind: 'external', provider: 'tavily', query: 'vacinação de tilápia documentação técnica', title: 'Documento técnico da instituição',
          url: 'https://example.org/technical', site: 'example.org', excerpt: 'O documento descreve o conceito de imunização.', publishedOn: '2026-09-10', retrievedAt: '2026-10-21T13:00:02.000Z' },
          { id: 'web-2', kind: 'external', provider: 'tavily', query: 'vacinação de tilápia documentação técnica', title: 'Página sem data de publicação',
            url: 'https://example.org/undated', site: 'example.org', excerpt: 'Um segundo trecho de contexto.', publishedOn: null, retrievedAt: '2026-10-21T13:00:02.000Z' }],
        excludedDomains: ['excluded.example'], excludedUrls: ['https://example.net/editorial-reference'] };
      const researchTrace: WritingTrace = { id: 'research-1', stage: 'research', attempt: 1, status: 'completed', startedAt: research.startedAt, completedAt: research.completedAt,
        model: 'tavily/search-basic', provider: 'tavily', hash: 'search-hash', cached: false, prompt: { system: '', user: JSON.stringify({ queries: research.queries }) }, research };
      const writeTrace: WritingTrace = { id: 'write-1', stage: 'write', attempt: 1, status: 'completed', startedAt: '2026-10-21T13:00:03.000Z', completedAt: '2026-10-21T13:00:04.000Z',
        model: 'anthropic/claude-opus-5-5', hash: 'write-hash', prompt: { system: 'Separe fontes originais e contexto web.', user: JSON.stringify({
          source: [{ id: 'original-1', text: 'A entrevista trata de vacinação de tilápia.' }], research,
        }) }, output: { title: 'Matéria com contexto', blocks: [] } };
      const failure: WritingResearchSnapshot = { ...research, status: 'failed', sources: [], reason: 'A pesquisa não forneceu contexto. O fluxo segue com o original.',
        queries: [{ ...research.queries[0], status: 'failed', sourceIds: [], requestId: undefined, credits: undefined, error: 'A consulta excedeu o tempo limite.' }] };
      const completed: WritingRunDetails = { runId: 'run-research', productionId: 'production-research', status: 'completed', pipeline: structuredClone(view.active), traces: [researchTrace, writeTrace] };
      const failed: WritingRunDetails = { ...completed, runId: 'run-research-failed', traces: [{ ...researchTrace, id: 'research-failed', status: 'failed', research: failure, error: 'A consulta excedeu o tempo limite.' }] };
      const scenario: Scenario = { view: { ...view, runs: [
        { runId: completed.runId, productionId: completed.productionId, label: 'Pesquisa com fontes', status: 'completed', pipelineRevision: 2, pipelineHash: view.active.hash, calls: [], writing: { stages: 2 } },
        { runId: failed.runId, productionId: failed.productionId, label: 'Pesquisa com falha', status: 'completed', pipelineRevision: 2, pipelineHash: view.active.hash, calls: [], writing: { stages: 1 } },
      ] }, details: { [completed.runId]: completed, [failed.runId]: failed }, commands: [], unexpected: [] };
      await mockReporter(page, scenario);
      await page.goto('/config?tab=runs');
      await page.getByRole('button', { name: /^Pesquisa com fontes/ }).click();
      await page.getByRole('region', { name: /^Pesquisa com fontes/ }).getByRole('button', { name: 'Ver execução', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Detalhes da redação', exact: true });
      const searchStage = drawer.getByRole('region', { name: 'Pesquisar contexto · tentativa 1', exact: true });
      await expect(searchStage.getByText('Tavily · Search Basic', { exact: true })).toBeVisible();
      await expect(searchStage.getByText('Tokens de entrada', { exact: true })).toHaveCount(0);
      const queryName = /^Consulta 1 · vacinação de tilápia documentação técnica/;
      await searchStage.getByRole('button', { name: queryName }).click();
      const query = searchStage.getByRole('region', { name: queryName });
      await expect(query.getByText('original-1', { exact: true })).toBeVisible();
      await expect(query.getByText('request-public-id', { exact: true })).toBeVisible();
      await expect(query.getByText('1', { exact: true })).toBeVisible();
      await searchStage.getByRole('button', { name: /^Fonte externa · web-1/ }).click();
      const source = searchStage.getByRole('region', { name: /^Fonte externa · web-1/ });
      await expect(source.getByText('10/09/2026', { exact: true })).toBeVisible();
      await expect(source.getByText(research.sources[0].excerpt, { exact: true })).toBeVisible();
      await expect(source.getByRole('link', { name: 'Abrir fonte original', exact: true })).toHaveAttribute('href', research.sources[0].url);
      await source.screenshot({ path: test.info().outputPath('writing-web-source.png'), animations: 'disabled' });
      await searchStage.getByRole('button', { name: /^Fonte externa · web-2/ }).click();
      await expect(searchStage.getByRole('region', { name: /^Fonte externa · web-2/ }).getByText('Não informada.', { exact: true })).toBeVisible();
      await expect(searchStage.getByText('https://example.net/editorial-reference', { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: 'Ver contexto web recebido · Redigir artigo completo', exact: true }).click();
      const webInput = drawer.getByRole('region', { name: 'Ver contexto web recebido · Redigir artigo completo', exact: true });
      await expect(webInput.getByText('Fonte externa · web-1', { exact: true })).toBeVisible();
      await expect(webInput.getByText(/Contexto web suplementar/)).toBeVisible();
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await drawer.getByRole('button', { name: 'Fechar execução', exact: true }).click();
      await expect(drawer).toBeHidden();
      await page.getByRole('button', { name: /^Pesquisa com falha/ }).click();
      await page.getByRole('region', { name: /^Pesquisa com falha/ }).getByRole('button', { name: 'Ver execução', exact: true }).click();
      await expect(drawer.getByText('Continuar com o conteúdo original', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Nenhuma fonte externa foi disponibilizada nesta pesquisa.', { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: queryName }).click();
      await expect(drawer.getByRole('region', { name: queryName }).getByText('A consulta excedeu o tempo limite.', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(scenario.commands).toEqual([]);
      expect(scenario.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('inspects actual traces and saved policy, then retries and cancels without losing the configuration draft', async ({ page }) => {
      const errors = watchErrors(page);
      const view = fixture();
      delete view.active.definition.writing!.minimumQuotes;
      const trace: WritingTrace = { id: 'trace-plan', stage: 'plan', attempt: 1, status: 'completed', startedAt: '2026-10-21T13:00:00.000Z', completedAt: '2026-10-21T13:00:02.500Z',
        model: 'google/gemini-3.8-flash', hash: 'trace-hash', prompt: { system: 'Prompt preservado com guia v3.', user: 'Conteúdo original: entrevista sobre tilápia.' },
        inputTokens: 1200, outputTokens: 120, cached: false, output: { decision: 'ready', angle: 'Crescimento da produção de tilápia.', facts: [], essentialFactIds: [], outline: [], issues: [] } };
      const details: Record<string, WritingRunDetails> = {
        'run-failed': { runId: 'run-failed', productionId: 'production-fixture', status: 'failed', pipeline: structuredClone(view.active), error: 'A revisão não foi concluída.', traces: [trace,
          { ...trace, id: 'trace-failure', stage: 'review', status: 'failed', model: 'anthropic/claude-sonnet-4-6', inputTokens: null, outputTokens: null, output: undefined, error: 'O provedor não respondeu a tempo.' }] },
        'run-review': { runId: 'run-review', productionId: 'production-fixture', status: 'failed', pipeline: structuredClone(view.active), traces: [
          { ...trace, id: 'trace-review', stage: 'review', output: { decision: 'needs_reporting', summary: 'O percentual exige atribuição à fonte.', issues: [
            { id: 'issue-1', severity: 'critical', code: 'attribution', blockId: 'lead', message: 'O dado de crescimento está sem atribuição.', evidenceIds: ['source-1'], suggestion: 'Confirme quem informou o dado.' },
          ] } },
        ] },
      };
      delete details['run-review'].pipeline.definition.writing;
      const scenario: Scenario = { view: { ...view, runs: [
        { runId: 'run-failed', productionId: 'production-fixture', label: 'Geração de tilápia', status: 'failed', pipelineRevision: 2, pipelineHash: view.active.hash, calls: [], writing: { stages: 2 } },
        { runId: 'run-review', productionId: 'production-fixture', label: 'Revisão para apuração', status: 'failed', pipelineRevision: 2, pipelineHash: view.active.hash, calls: [], writing: { stages: 1, decision: 'needs_reporting' } },
      ] }, details, commands: [], unexpected: [] };
      await mockReporter(page, scenario);
      await page.goto('/config?tab=writing');
      await page.getByRole('textbox', { name: 'Instruções compartilhadas da redação' }).fill('Manter este rascunho durante a consulta.');
      await page.getByRole('tab', { name: /^Execuções/ }).click();
      await page.getByRole('button', { name: /Revisão para apuração/ }).click();
      await page.getByRole('region', { name: /Revisão para apuração/ }).getByRole('button', { name: 'Ver execução', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Detalhes da redação', exact: true });
      await expect(drawer.getByText('Precisa de apuração', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Padrão do formato; quantidade não registrada.', { exact: true })).toBeVisible();
      await expect(drawer.getByText('O percentual exige atribuição à fonte.', { exact: true })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'Verificação estruturada não registrada', exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: 'Ver datas e contexto · Revisar artigo', exact: true }).click();
      await expect(drawer.getByText('Contexto temporal não registrado nesta execução.', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Data informada no conteúdo', { exact: true })).toHaveCount(0);
      await drawer.getByRole('button', { name: 'Ver apontamentos · Revisar artigo' }).click();
      await expect(drawer.getByRole('region', { name: 'Ver apontamentos · Revisar artigo' }).getByText(/O dado de crescimento está sem atribuição/)).toBeVisible();
      await drawer.getByRole('button', { name: 'Fechar execução' }).click();
      await page.getByRole('button', { name: /Geração de tilápia/ }).click();
      await page.getByRole('region', { name: /Geração de tilápia/ }).getByRole('button', { name: 'Ver execução', exact: true }).click();
      await expect(drawer.getByText('O provedor não respondeu a tempo.', { exact: true })).toBeVisible();
      await expect(drawer.getByText('1.200', { exact: true })).toBeVisible();
      await expect(drawer.getByText('Não informado', { exact: true })).toHaveCount(2);
      await expect(drawer.getByText('2,5 s', { exact: true })).toHaveCount(2);
      await drawer.getByRole('button', { name: 'Ver prompt e entrada · Preparar e planejar' }).click();
      await expect(drawer.getByRole('textbox', { name: 'Prompt de sistema · Preparar e planejar' })).toHaveValue(trace.prompt.system);
      await expect(drawer.getByRole('textbox', { name: 'Entrada enviada · Preparar e planejar' })).toHaveValue(trace.prompt.user);
      await drawer.getByRole('button', { name: 'Ver resultado · Preparar e planejar', exact: true }).click();
      await expect(drawer.getByRole('textbox', { name: 'Resultado registrado · Preparar e planejar' })).toHaveValue(/Crescimento da produção de tilápia/);
      await drawer.getByRole('button', { name: 'Ver mapa, guia e etapas desta execução' }).click();
      await expect(drawer.getByRole('textbox', { name: 'Configuração da execução' })).toHaveValue(/Use voz objetiva e atribua as alegações/);
      await expect(drawer.getByRole('textbox', { name: 'Configuração da execução' })).not.toHaveValue(/Manter este rascunho durante a consulta/);
      await expect(drawer.getByRole('link', { name: 'Abrir artigo' })).toHaveAttribute('href', '/productions/production-fixture/article');
      await expectNoHorizontalOverflow(page);
      await drawer.getByRole('heading', { name: 'Detalhes da redação', exact: true }).scrollIntoViewIfNeeded();
      await expect(drawer.getByRole('heading', { name: 'Detalhes da redação', exact: true })).toBeInViewport();
      await drawer.screenshot({ path: test.info().outputPath('writing-trace.png'), animations: 'disabled' });
      await drawer.getByRole('button', { name: 'Nova tentativa', exact: true }).click();
      await expect(drawer.getByRole('button', { name: 'Cancelar execução', exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: 'Cancelar execução', exact: true }).click();
      await expect(drawer.getByText('Cancelada', { exact: true })).toBeVisible();
      await drawer.getByRole('button', { name: 'Fechar execução' }).click();
      await page.getByRole('tab', { name: 'Redação', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Instruções compartilhadas da redação' })).toHaveValue('Manter este rascunho durante a consulta.');
      await expect(page.getByText('Alterações não ativadas', { exact: true })).toBeVisible();
      expect(scenario.commands.map(item => item.method)).toEqual(['generation.retry', 'generation.cancel']);
      expect(scenario.unexpected).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
