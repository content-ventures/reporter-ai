import { expect, test } from '@playwright/test';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

for (const viewport of VIEWPORTS) {
  test.describe(`integrated R2 UI at ${viewport.name}`, () => {
    test.beforeEach(async ({ page }) => {
      const checkpoint = emptyEditorialCheckpoint();
      await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
    });
    test.use({ viewport: { width: viewport.width, height: viewport.height }, ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });
    test('covers R2 screens in the shared shell without R2 backend requests', async ({ page }) => {
      const errors = watchErrors(page);
      const apiCalls: string[] = [];
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !(request.method() === 'GET' && new URL(request.url()).pathname === '/api/reporter/workspace')) apiCalls.push(request.url()); });
      for (const [screen, title] of [['/news', 'Notícias'], ['/settings/editorial-map', 'Mapa editorial'], ['/settings/writing-guide', 'Guia de escrita'], ['/images', 'Imagens'], ['/quotes', 'Banco de citações'], ['/archive', 'Acervo publicado'], ['/admin/integrations', 'CMS do portal'], ['/news/draft', 'Hard News']]) {
        await page.goto(screen);
        await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
        await expectHeadingOutline(page);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: test.info().outputPath(`${screen.replaceAll('/', '-')}.png`), fullPage: true });
      }
      expect(apiCalls).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('validates settings, CMS authorization and library safeguards', async ({ page }) => {
      const errors = watchErrors(page);
      const apiCalls: string[] = [];
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !(request.method() === 'GET' && new URL(request.url()).pathname === '/api/reporter/workspace')) apiCalls.push(request.url()); });
      async function navigate(label: string) {
        if (viewport.width < 1200) await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
        await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link', { name: `${label} — R2`, exact: true }).click();
      }
      await page.goto('/settings/editorial-map');
      await page.getByRole('textbox', { name: 'Para quem escrevemos' }).fill('Gestores de qualidade e distribuição.');
      await page.getByRole('button', { name: 'Salvar configuração', exact: true }).click();
      await navigate('Guia de escrita');
      await navigate('Mapa editorial');
      await expect(page.getByRole('textbox', { name: 'Para quem escrevemos' })).toHaveValue('Gestores de qualidade e distribuição.');
      await navigate('CMS do portal');
      await page.getByRole('button', { name: 'Simular verificação' }).click();
      await expect(page.getByText('Informe um endereço http ou https válido.')).toBeVisible();
      await page.getByRole('textbox', { name: 'Endereço do portal' }).fill('https://portal.example');
      await page.getByRole('button', { name: 'Simular verificação' }).click();
      await page.getByRole('button', { name: 'Confirmar conexão simulada' }).click();
      await expect(page.getByRole('combobox', { name: 'Categoria padrão' })).toBeVisible();
      await page.getByRole('button', { name: 'Simular sincronização' }).click();
      await expect(page.getByRole('button', { name: 'Dados de exemplo carregados' })).toBeDisabled();
      await navigate('Imagens');
      await page.getByRole('button', { name: 'Processamento de pescado', exact: true }).click();
      const image = page.getByRole('dialog', { name: 'Processamento de pescado', exact: true });
      await expect(image.getByRole('button', { name: 'Usar no rascunho de exemplo' })).toBeDisabled();
      await image.getByRole('textbox', { name: 'Crédito publicado' }).fill('Crédito de exemplo');
      await image.getByRole('button', { name: 'Salvar crédito', exact: true }).click();
      await expect(image.getByRole('button', { name: 'Usar no rascunho de exemplo' })).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(image).not.toBeVisible();
      await navigate('Citações');
      await page.getByRole('searchbox', { name: 'Buscar no acervo' }).fill('Ana Ribeiro');
      await page.getByRole('button', { name: 'Ana Ribeiro', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Citação e contexto' }).getByRole('button', { name: 'Selecionar citação' })).toBeDisabled();
      await page.keyboard.press('Escape');
      await navigate('Acervo');
      await page.getByRole('button', { name: 'Simular indexação', exact: true }).click();
      await page.getByRole('tab', { name: 'Perguntar ao acervo', exact: true }).click();
      await page.getByRole('textbox', { name: 'O que você quer encontrar?' }).fill('Rastreabilidade');
      await page.getByRole('button', { name: 'Simular consulta', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Referências da resposta' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(apiCalls).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('imports an example, selects a brief, reviews evidence and enriches a local draft', async ({ page }) => {
      const apiCalls: string[] = [];
      page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !(request.method() === 'GET' && new URL(request.url()).pathname === '/api/reporter/workspace')) apiCalls.push(request.url()); });
      await page.goto('/prototypes/r2');
      await expect(page).toHaveURL(/\/news$/);
      for (const name of ['Início', 'Produções', 'Modelos', 'Notícias — R2', 'Imagens — R2', 'Citações — R2', 'Acervo — R2', 'Mapa editorial — R2', 'Guia de escrita — R2', 'CMS do portal — R2']) {
        await expect(page.getByRole('navigation', { name: 'Menu principal', includeHidden: true }).getByRole('link', { name, exact: true, includeHidden: true })).toBeAttached();
      }
      await page.getByRole('button', { name: 'Importar URL', exact: true }).click();
      const importDialog = page.getByRole('dialog', { name: 'Importar notícia por URL' });
      await importDialog.getByRole('button', { name: 'Simular importação' }).click();
      await expect(importDialog.getByText('Informe uma URL válida', { exact: false })).toBeVisible();
      await importDialog.getByRole('textbox', { name: 'URL da notícia' }).fill('https://news.example/noticia');
      await importDialog.getByRole('button', { name: 'Simular importação' }).click();
      await expect(importDialog).not.toBeVisible();
      await expect(page.getByRole('button', { name: 'Notícia importada por URL · exemplo', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Simular classificação' }).click();
      await page.getByRole('button', { name: 'Cooperativas testam rastreabilidade na cadeia do pescado', exact: true }).click();
      await page.getByRole('button', { name: 'Selecionar pauta', exact: true }).click();
      await page.getByRole('tab', { name: /^Pautas selecionadas/ }).click();
      await page.getByRole('button', { name: 'Cooperativas testam rastreabilidade na cadeia do pescado', exact: true }).click();
      await page.getByRole('button', { name: 'Abrir Hard News', exact: true }).click();
      await expect(page).toHaveURL(/\/news\/draft$/);
      await page.getByRole('tab', { name: '2. Outline', exact: true }).click();
      const dependency = page.getByRole('dialog', { name: 'Selecione as fontes primeiro' });
      await expect(dependency).toBeVisible();
      await dependency.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(dependency).not.toBeVisible();
      await page.getByRole('button', { name: 'Simular pesquisa web' }).click();
      await page.getByRole('checkbox', { name: /Apresentação do projeto-piloto/ }).click();
      await page.getByRole('checkbox', { name: /Guia de controle de temperatura/ }).click();
      await page.getByRole('button', { name: 'Montar outline' }).click();
      await page.getByRole('button', { name: 'Carregar exemplo de Hard News' }).click();
      await page.getByRole('button', { name: 'Revisar evidências', exact: true }).click();
      await expect(page.getByText('Alegação sem evidência suficiente', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Remover alegação do exemplo' }).click();
      await page.getByRole('button', { name: 'Marcar conferência editorial' }).click();
      await page.getByRole('button', { name: 'Continuar para enriquecimento' }).click();
      await page.getByRole('checkbox', { name: /A rastreabilidade precisa acompanhar/ }).click();
      await page.getByRole('button', { name: 'Inserir citações selecionadas' }).click();
      await expect(page.getByRole('button', { name: 'Concluir revisão de exemplo' })).toBeDisabled();
      await page.getByRole('button', { name: 'Conferir texto enriquecido' }).click();
      await expect(page.getByRole('textbox', { name: 'Texto da notícia' })).toHaveValue(/Marina Costa/);
      await expectNoHorizontalOverflow(page);
      expect(apiCalls).toEqual([]);
    });
  });
}
