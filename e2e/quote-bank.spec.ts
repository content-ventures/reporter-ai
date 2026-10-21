import { expect, test } from '@playwright/test';
import type { CitationLibraryView, CitationView } from '../src/domain/citation-library.ts';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { VIEWPORTS, expectHeadingOutline, expectNoHorizontalOverflow, watchErrors } from './support';

/**
 * Citações on the R1 citation library: a quote whose author is confirmed, one waiting for its author
 * and one the outline suggested. A suggestion reads "Sugerida", never as confirmed, until a person
 * confirms it with the source.
 */
function citation(id: string, text: string, patch: Partial<CitationView> = {}): CitationView {
  return {
    id, revision: 1, text, sourceHash: 'h-1', productionId: 'p-1', origin: 'article',
    ref: { kind: 'source', sourceId: 's-1', sourceVersion: 1, locator: { type: 'segment', segmentId: `seg-${id}` } },
    createdAt: '2026-10-19T10:00:00.000Z', updatedAt: '2026-10-19T10:00:00.000Z', personId: 'person-1', authorConfirmed: true,
    relevance: '', speaker: 'Ricardo Lemos', podcast: 'Podcast não informado', sourceTitle: 'Entrevista no estande',
    evidence: text, authorized: true, ready: false, participants: [{ id: 'person-1', name: 'Ricardo Lemos' }], uses: [], ...patch,
  };
}

const SUGGESTION = 'O cliente quer levar uma refeição para duas pessoas, não um quilo de peixe.';

function library(): CitationLibraryView {
  return {
    items: [
      citation('c-checked', 'Dobramos a capacidade de defumação em março.', { relevance: 'Capacidade da fábrica.', ready: true }),
      citation('c-pending', 'O pedido de habilitação sanitária sai ainda este ano.', { authorConfirmed: false, speaker: 'Autoria a confirmar' }),
      citation('c-suggested', SUGGESTION, { origin: 'outline', revision: 0, authorConfirmed: false }),
    ],
    sources: [{ id: 's-1', version: 1, title: 'Entrevista no estande', productionId: 'p-1' }],
  };
}

for (const viewport of VIEWPORTS) {
  test.describe(`citações em ${viewport.name}`, () => {
    test.use(
      viewport.width < 768
        ? { viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true }
        : { viewport: { width: viewport.width, height: viewport.height } },
    );

    test('a suggested citation reads Sugerida, never confirmed, until a person confirms it', async ({ page }) => {
      const errors = watchErrors(page);
      const checkpoint = emptyEditorialCheckpoint();
      let view = library();
      const saves: unknown[] = [];
      await page.route('**/api/reporter/workspace', (route) => route.fulfill({ json: { state: checkpoint.state, jobs: {}, revision: 0, model: 'openai/gpt-4.1', workerOnline: true } }));
      await page.route('**/api/reporter/citations', async (route) => {
        if (route.request().method() !== 'POST') return route.fulfill({ json: view });
        const payload = route.request().postDataJSON();
        saves.push(payload);
        const confirmed = { ...view.items[2], revision: 1, authorConfirmed: true };
        view = { ...view, items: [view.items[0], view.items[1], confirmed] };
        return route.fulfill({ json: confirmed });
      });
      await page.goto('/quotes');
      await expect(page.getByRole('heading', { name: 'Citações', level: 1 })).toBeVisible();
      await page.getByRole('radio', { name: 'Cartões', exact: true }).click();
      const cards = page.getByRole('list', { name: 'Citações' }).getByRole('listitem');
      await expect(cards).toHaveCount(3);
      const suggestion = cards.filter({ hasText: SUGGESTION });
      await expect(suggestion.getByText('Sugerida', { exact: true })).toBeVisible();
      await expect(suggestion.getByText('Autoria a conferir', { exact: true })).toHaveCount(0);
      await expect(suggestion.getByRole('button', { name: 'Copiar fala com atribuição' })).toHaveCount(0);
      await expect(cards.filter({ hasText: 'Dobramos' }).getByRole('button', { name: 'Copiar fala com atribuição' })).toBeVisible();
      // A suggestion is neither confirmed nor waiting for a fact check: it has its own tab.
      await expect(page.getByRole('tab', { name: /^Pendentes/ })).toContainText('2');
      await expect(page.getByRole('tab', { name: /^Sugeridas/ })).toContainText('1');
      await page.getByRole('tab', { name: /^Sugeridas/ }).click();
      await expect(cards).toHaveCount(1);
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: test.info().outputPath('suggested.png'), fullPage: true });

      await suggestion.getByRole('button', { name: 'Abrir a fala de Ricardo Lemos' }).click();
      const drawer = page.getByRole('dialog', { name: 'Ricardo Lemos' });
      await expect(drawer.getByText('Sugerida pela estrutura. Confira com a fonte antes de usar.')).toBeVisible();
      const check = drawer.getByRole('switch', { name: 'Autoria conferida' });
      await expect(check).not.toBeChecked();
      await expectNoHorizontalOverflow(page);
      await check.click();
      await expect(drawer.getByText('Pode entrar nos artigos.')).toBeVisible();
      await drawer.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(page.getByText('Citação salva')).toBeVisible();
      expect(saves).toHaveLength(1);
      expect(saves[0]).toMatchObject({ id: 'c-suggested', baseRevision: 0, input: { authorConfirmed: true, personId: 'person-1', text: SUGGESTION } });

      // Confirmed, it is a quote like any other; with no suggestion left, the tab goes once another is chosen.
      await page.getByRole('tab', { name: /^Todas/ }).click();
      await expect(cards.filter({ hasText: SUGGESTION }).getByText('Sugerida', { exact: true })).toHaveCount(0);
      await expect(cards.filter({ hasText: SUGGESTION }).getByRole('button', { name: 'Copiar fala com atribuição' })).toBeVisible();
      await expect(page.getByRole('tab', { name: /^Sugeridas/ })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(errors, 'erros no console').toEqual([]);
    });
  });
}
