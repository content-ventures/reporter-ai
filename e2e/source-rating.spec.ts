import { expect, test, type Page } from '@playwright/test';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import type { NewsFeed } from '../src/domain/hard-news.ts';
import type { SourceRatingInput } from '../src/domain/news-source-rating.ts';
import { VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

const AT = '2026-10-21T16:00:00.000Z';
const TARGET = '22222222-2222-4222-8222-222222222222';
const RATIONALE = 'Cobertura própria e especializada da cadeia de aquicultura, com fontes identificadas.';
const source = (id: string, name: string): NewsFeed => ({ id, name, url: `https://${name.toLowerCase().replaceAll(' ', '')}.example/feed/`, everyMinutes: 60, state: 'active', lastDay: 0, kind: 'rss' });

async function choose(page: Page, name: string, value: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  const label = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option', { name: new RegExp(`^${label}(?:\\s|$)`) }).click();
}

for (const viewport of VIEWPORTS) {
  test.describe(`avaliação editorial das fontes em ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test('salva, consulta, filtra e remove a avaliação sem confundir agregadores ou dar edição ao leitor', async ({ page }) => {
      const checkpoint = emptyEditorialCheckpoint();
      const feeds = [
        { ...source('11111111-1111-4111-8111-111111111111', 'Fonte complementar'), rating: { tier: 'B' as const, relevance: 'medium' as const, rationale: 'Contextualiza decisões regulatórias.', updatedAt: AT } },
        source(TARGET, 'Fonte especializada'),
        { ...source('33333333-3333-4333-8333-333333333333', 'Alerta pescado'), kind: 'google-alerts' as const, keyword: 'pescado' },
      ];
      const writes: Array<{ rating: SourceRatingInput | null }> = [];
      let failNext = false;
      await page.route('https://www.google.com/s2/favicons?**', route => route.fulfill({ status: 404 }));
      await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
      const snapshot = () => ({ at: new Date().toISOString(), sources: feeds, items: [], rssApp: false });
      await page.route('**/api/reporter/news?**', route => route.fulfill({ json: snapshot() }));
      await page.route('**/api/reporter/news', route => route.fulfill({ json: snapshot() }));
      await page.route(`**/api/reporter/news/sources/${TARGET}`, async route => {
        const patch = route.request().postDataJSON() as { rating: SourceRatingInput | null };
        writes.push(patch);
        if (failNext) {
          failNext = false;
          await route.fulfill({ status: 503, json: { error: 'UNAVAILABLE', message: 'Tente salvar novamente.' } });
          return;
        }
        feeds[1] = { ...feeds[1], rating: patch.rating ? { ...patch.rating, updatedAt: AT } : undefined };
        await route.fulfill({ json: feeds[1] });
      });
      const errors = watchErrors(page, [/503.*\/api\/reporter\/news\/sources\//, /404.*google\.com\/s2\/favicons/]);
      await page.clock.install();
      await page.goto('/news/sources');
      const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /^Fonte especializada\s*Ativa$/ }) });
      const aggregator = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: /^Alerta pescado\s*Ativa$/ }) });
      await expect(card.getByText('Não avaliada', { exact: true })).toBeVisible();
      await expect(aggregator.getByText('Agregador', { exact: true })).toBeVisible();
      await expect(aggregator.getByRole('button', { name: 'Avaliar fonte', exact: true })).toHaveCount(0);
      await card.getByRole('button', { name: 'Avaliar fonte', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Avaliação editorial', exact: true });
      await expect(dialog.getByRole('button', { name: 'Salvar avaliação' })).toBeDisabled();
      await choose(page, 'Força editorial', 'A1 · Referência');
      await choose(page, 'Relevância para o veículo', 'Alta');
      await dialog.getByRole('textbox', { name: 'Justificativa', exact: true }).fill('   ');
      await expect(dialog.getByRole('button', { name: 'Salvar avaliação' })).toBeDisabled();
      await dialog.getByRole('textbox', { name: 'Justificativa', exact: true }).fill(RATIONALE);
      await dialog.getByRole('button', { name: 'Salvar avaliação' }).click();
      await expect(dialog).toHaveCount(0);
      expect(writes).toEqual([{ rating: { tier: 'A1', relevance: 'high', rationale: RATIONALE } }]);
      await expect(card.getByText('A1 · Referência', { exact: true })).toBeVisible();
      await expect(card.getByText('Relevância alta', { exact: true })).toBeVisible();
      await page.reload();
      await card.getByRole('button', { name: 'Ver avaliação', exact: true }).click();
      await expect(dialog.getByText(RATIONALE, { exact: true })).toBeVisible();
      await expect(dialog.getByText(/21\/10\/2026/)).toBeVisible();
      // Another editor updates the assessment while this dialog is still in read mode.
      const updatedRationale = 'Avaliação atualizada por outro editor durante a consulta.';
      feeds[1] = { ...feeds[1], rating: { tier: 'C', relevance: 'low', rationale: updatedRationale, updatedAt: AT } };
      await page.clock.fastForward(60_000);
      await expect(dialog.getByText(updatedRationale, { exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Editar avaliação' }).click();
      await expect(dialog.getByRole('combobox', { name: 'Força editorial', exact: true })).toHaveText('C · Monitoramento');
      await expect(dialog.getByRole('textbox', { name: 'Justificativa', exact: true })).toHaveValue(updatedRationale);
      await choose(page, 'Força editorial', 'A2 · Especializada');
      await choose(page, 'Relevância para o veículo', 'Alta');
      await dialog.getByRole('textbox', { name: 'Justificativa', exact: true }).fill(RATIONALE);
      failNext = true;
      await dialog.getByRole('button', { name: 'Salvar avaliação' }).click();
      await expect(dialog.getByText('Tente salvar novamente.')).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: 'Justificativa' })).toHaveValue(RATIONALE);
      await dialog.getByRole('button', { name: 'Salvar avaliação' }).click();
      await expect(dialog).toHaveCount(0);
      await choose(page, 'Ordenar fontes', 'Força editorial');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([/^Fonte especializada\s*Ativa$/, /^Fonte complementar\s*Ativa$/, /^Alerta pescado\s*Ativa$/]);
      await page.getByRole('button', { name: 'Filtros', exact: true }).click();
      await choose(page, 'Força editorial', 'A2 · Especializada');
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([/^Fonte especializada\s*Ativa$/]);
      await expectNoHorizontalOverflow(page);
      await page.getByRole('button', { name: 'Limpar', exact: true }).click();
      await card.getByRole('button', { name: 'Ver avaliação', exact: true }).click();
      await dialog.getByRole('button', { name: 'Editar avaliação' }).click();
      await dialog.getByRole('button', { name: 'Remover avaliação' }).click();
      await expect(dialog).toHaveCount(0);
      await expect(card.getByText('Não avaliada', { exact: true })).toBeVisible();
      expect(writes.at(-1)).toEqual({ rating: null });

      // The same saved assessment remains readable after a reload with read-only permissions.
      feeds[1] = { ...feeds[1], rating: { tier: 'A2', relevance: 'high', rationale: RATIONALE, updatedAt: AT } };
      checkpoint.state.members[0].roles = ['approver'];
      await page.reload();
      await card.getByRole('button', { name: 'Ver avaliação', exact: true }).click();
      await expect(dialog.getByText(RATIONALE, { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Editar avaliação' })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Remover avaliação' })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await dialog.getByRole('button', { name: 'Fechar', exact: true }).last().click();
      await expectHeadingOutline(page);
      expect(writes).toHaveLength(4);
      expect(errors).toEqual([]);
    });
  });
}

test('o radar exibe e filtra a força da fonte sem transformar a avaliação em prioridade da notícia', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const checkpoint = emptyEditorialCheckpoint();
  const rated: NewsFeed = { ...source(TARGET, 'Fonte referencia'), rating: { tier: 'A1', relevance: 'high', rationale: RATIONALE, updatedAt: AT } };
  const unrated = source('33333333-3333-4333-8333-333333333333', 'Fonte nova');
  const items = [rated, unrated].map((feed, index) => ({ id: `rating-story-${index}`, title: `Pauta recebida ${index}`, source: feed.name,
    url: feed.url.replace('/feed/', '/noticia/'), feedId: feed.id, via: 'rss', status: 'new',
    publishedAt: new Date().toISOString(), importedAt: new Date().toISOString(), excerpt: 'Informação recebida da fonte.', body: ['Informação recebida da fonte.'], duplicates: [] }));
  await page.route('https://www.google.com/s2/favicons?**', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/api/reporter/workspace', route => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
  const snapshot = () => ({ at: new Date().toISOString(), sources: [rated, unrated], items, rssApp: false });
  await page.route('**/api/reporter/news?**', route => route.fulfill({ json: snapshot() }));
  await page.route('**/api/reporter/news', route => route.fulfill({ json: snapshot() }));
  const errors = watchErrors(page);
  await page.goto('/news');
  const reference = page.getByTestId('news-card-rating-story-0');
  const other = page.getByTestId('news-card-rating-story-1');
  await expect(reference.getByText('A1 · Referência', { exact: true })).toBeVisible();
  await expect(other.getByText('Não avaliada', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Selecionar para redação', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await choose(page, 'Força editorial da fonte', 'A1 · Referência');
  await expect(reference).toBeVisible();
  await expect(other).toHaveCount(0);
  await choose(page, 'Força editorial da fonte', 'C · Monitoramento');
  await expect(page.getByText('Nenhuma notícia encontrada', { exact: true })).toBeVisible();
  await choose(page, 'Força editorial da fonte', 'Não avaliadas');
  await expect(other).toBeVisible();
  await expect(reference).toHaveCount(0);
  await choose(page, 'Força editorial da fonte', 'A1 · Referência');
  await reference.click();
  await expect(page).toHaveURL(/\/news\?item=rating-story-0$/);
  await expect(page.getByTestId('news-headlines')).toHaveCount(0);
  await expect(page.locator('[data-ws-stop="main"]').getByText('A1 · Referência', { exact: true })).toBeVisible();
  await expect(page.getByText('Relevância alta', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Selecionar para redação', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
