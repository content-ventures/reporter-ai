import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { VIEWPORTS, expectNoHorizontalOverflow } from './support';

const text = 'Material sintético para testar oficinas gratuitas de leitura na biblioteca.';
const insights = { title: 'Oficinas de leitura',participants: [],pipelineRevision: 1 };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise,resolve };
}

for (const viewport of VIEWPORTS) {
  test.describe(`progresso do material em ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width,height: viewport.height },
      ...(viewport.width < 768 ? { hasTouch: true,isMobile: true } : {}) });

    test('colar texto abre a análise e respeita movimento reduzido', async ({ page,context }) => {
      const response = deferred();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await context.grantPermissions(['clipboard-read','clipboard-write']);
      await page.route('**/api/reporter/material/analysis', async route => { await response.promise;await route.fulfill({ json: insights }); });
      await page.goto('/productions/new');
      await page.evaluate(value => navigator.clipboard.writeText(value),text);
      await page.getByRole('textbox', { name: 'Transcrição',exact: true }).focus();
      await page.keyboard.press('ControlOrMeta+V');
      await expect(page.getByRole('dialog', { name: 'Preparando material' })).toBeVisible();
      await expect(page.getByRole('dialog').getByText('Identificando o tema e os participantes.', { exact: true })).toBeVisible();
      response.resolve();
      await expect(page.getByRole('dialog', { name: 'Material pronto' })).toBeVisible();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page.getByRole('textbox', { name: 'Transcrição',exact: true })).toHaveValue(text);
    });

    test('arquivo abre o acompanhamento, permite fechar e reabrir e conclui antes da pauta', async ({ page }) => {
      const response = deferred();
      await page.route('**/api/reporter/material/analysis', async route => {
        await response.promise;
        await route.fulfill({ json: insights });
      });
      await page.goto('/productions/new');
      await page.getByRole('radio', { name: 'Arquivo',exact: true }).click();
      await page.locator('input[type="file"]').setInputFiles({ name: 'transcricao.txt',mimeType: 'text/plain',buffer: Buffer.from(text) });
      const dialog = page.getByRole('dialog', { name: 'Preparando material' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Identificando o tema e os participantes.', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
      await expectNoHorizontalOverflow(page);
      await dialog.getByRole('button', { name: 'Acompanhar na página' }).click();
      await expect(dialog).toBeHidden();
      await page.getByRole('button', { name: 'Acompanhar análise' }).click();
      await expect(dialog).toBeVisible();
      response.resolve();
      await expect(page.getByRole('dialog', { name: 'Material pronto' })).toBeVisible();
      await expect(page.getByRole('dialog')).toBeHidden();
      await page.getByRole('checkbox', { name: 'Os falantes autorizaram o uso' }).check();
      await page.getByRole('button', { name: 'Continuar',exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Título interno',exact: true })).toHaveValue(insights.title);
    });

    test('digitar não interrompe o foco e uma falha pode ser tentada novamente', async ({ page }) => {
      const response = deferred();
      let calls = 0;
      await page.route('**/api/reporter/material/analysis', async route => {
        await response.promise;
        await route.fulfill(++calls === 1 ? { status: 502,json: { message: 'Limite temporário. Tente novamente.' } } : { json: insights });
      });
      await page.goto('/productions/new');
      const input = page.getByRole('textbox', { name: 'Transcrição',exact: true });
      await input.fill(text);
      await expect(page.getByRole('button', { name: 'Acompanhar análise' })).toBeVisible();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(input).toBeFocused();
      await page.getByRole('button', { name: 'Acompanhar análise' }).click();
      response.resolve();
      const failure = page.getByRole('dialog', { name: 'Material não concluído' });
      await expect(failure.getByText('Limite temporário. Tente novamente.', { exact: true })).toBeVisible();
      expect(calls).toBe(1);
      await failure.getByRole('button', { name: 'Tentar novamente' }).click();
      await expect(page.getByRole('dialog', { name: 'Material pronto' })).toBeVisible();
      await page.getByRole('button', { name: 'Revisar material' }).click();
      await expect(input).toHaveValue(text);
      expect(calls).toBe(2);
    });

    test('link passa da importação de legendas à análise, sem inventar transcrição de áudio', async ({ page }) => {
      const imported = deferred(),analyzed = deferred();
      await page.route('**/api/reporter/links', async route => {
        await imported.promise;
        await route.fulfill({ json: { kind: 'ready',provider: 'youtube',sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          fileName: 'legendas.txt',text,bytes: Buffer.byteLength(text) } });
      });
      await page.route('**/api/reporter/material/analysis', async route => {
        await analyzed.promise;
        await route.fulfill({ json: insights });
      });
      await page.goto('/productions/new');
      await page.getByRole('radio', { name: 'Link',exact: true }).click();
      await page.getByRole('textbox', { name: 'Transcrição',exact: true }).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      await page.getByRole('button', { name: 'Importar link',exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Preparando material' });
      await expect(dialog.getByText('Localizando episódio', { exact: true })).toBeVisible();
      imported.resolve();
      await expect(dialog.getByText('Identificando o tema e os participantes.', { exact: true })).toBeVisible();
      await expect(dialog.getByText('Transcrever áudio', { exact: true })).toHaveCount(0);
      analyzed.resolve();
      await expect(page.getByRole('dialog', { name: 'Material pronto' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test('arquivo grande mantém nome, aviso e ações dentro do modal', async ({ page }) => {
      const directory = await mkdtemp(join(tmpdir(), 'reporter-progress-'));
      const name = `YTDown.com_YouTube_Media_${'PodcastSeafoodBrasil'.repeat(7)}_001_1080p.mp4`;
      const path = join(directory, name);
      const upload = deferred();
      try {
        await writeFile(path, '');
        await truncate(path, 101 * 1024 ** 2);
        await page.route('**/api/reporter/uploads', async route => {
          await upload.promise;
          await route.abort();
        });
        await page.goto('/productions/new');
        await page.getByRole('radio', { name: 'Arquivo', exact: true }).click();
        await page.locator('input[type="file"]').setInputFiles(path);
        const dialog = page.getByRole('dialog', { name: 'Preparando material' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(name, { exact: false })).toBeVisible();
        await expect(dialog.getByText('O envio depende da sua conexão. Mantenha esta página aberta até terminar.')).toBeVisible();
        const overflow = await dialog.evaluate(element => [element, ...element.querySelectorAll<HTMLElement>('*')]
          .filter(node => !node.closest('[aria-hidden="true"]') && getComputedStyle(node).clipPath === 'none' && node.clientWidth > 1 && node.scrollWidth > node.clientWidth + 1)
          .map(node => ({ tag: node.tagName, text: node.textContent, className: node.className, width: node.clientWidth, scroll: node.scrollWidth })));
        expect(overflow, 'nenhum conteúdo cortado ou com rolagem horizontal no modal').toEqual([]);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: test.info().outputPath('material-progress.png') });
        await dialog.getByRole('button', { name: 'Acompanhar na página' }).click();
        await expect(dialog).toBeHidden();
      } finally {
        upload.resolve();
        await rm(directory, { recursive: true, force: true });
      }
    });

    test('upload mostra bytes reais e passa à espera da transcrição', async ({ page }) => {
      const secondPart = deferred(),analysis = deferred();
      await page.route('**/api/reporter/uploads', route => route.fulfill({ json: {
        mode: 'cloud',id: 'transcript-test',source_id: '550e8400-e29b-41d4-a716-446655440000',upload_endpoint: 'https://worker.test',
      } }));
      await page.route('https://worker.test/**', route => route.fulfill({ headers: { 'access-control-allow-origin': '*' },json:
        route.request().url().endsWith('/uploads/start') ? { partSize: 5 * 1024 ** 2,parts: [
          { number: 1,url: 'https://storage.test/part-1' },{ number: 2,url: 'https://storage.test/part-2' },
        ] } : { accepted: true } }));
      await page.route('https://storage.test/**', async route => {
        if (route.request().url().endsWith('part-2')) await secondPart.promise;
        await route.fulfill({ status: 200,headers: { 'access-control-allow-origin': '*' },body: '' });
      });
      let ready = false;
      await page.route('**/api/reporter/transcripts/transcript-test', route => route.fulfill({ json: { worker_online: true,
        transcript: { id: 'transcript-test',status: ready ? 'ready' : 'processing',content: ready ? text : null,segments: null,
          job: { progress: { phase: 'transcribing',done: 0,total: 1 } } },
      } }));
      await page.route('**/api/reporter/material/analysis', async route => { await analysis.promise;await route.fulfill({ json: insights }); });
      await page.goto('/productions/new');
      await page.getByRole('radio', { name: 'Arquivo',exact: true }).click();
      await page.locator('input[type="file"]').setInputFiles({ name: 'entrevista.mp3',mimeType: 'audio/mpeg',buffer: Buffer.alloc(6 * 1024 ** 2) });
      const dialog = page.getByRole('dialog', { name: 'Preparando material' });
      await expect(dialog.getByRole('progressbar', { name: 'Envio do arquivo' })).toHaveAttribute('aria-valuenow','83');
      await expect(dialog.getByText(/5,0 MB de 6,0 MB.*83%/)).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancelar envio' }).focus();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Acompanhar na página' })).toBeFocused();
      secondPart.resolve();
      await expect(dialog.getByText('Transcrevendo áudio', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
      await expect(dialog.getByRole('button', { name: 'Cancelar importação' })).toHaveCount(0);
      ready = true;
      await expect(dialog.getByText('Identificando o tema e os participantes.', { exact: true })).toBeVisible();
      analysis.resolve();
      await expect(page.getByRole('dialog', { name: 'Material pronto' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}
