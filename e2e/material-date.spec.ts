import { expect, test, type Page } from '@playwright/test';
import { createEditorialEngine, emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { VIEWPORTS, expectNoHorizontalOverflow, watchErrors } from './support';

/** Isolated synthetic source: every API request stays inside the replay. */
async function materialServer(page: Page) {
  const checkpoint = emptyEditorialCheckpoint();
  let sequence = 0, revision = 0;
  const engine = createEditorialEngine(checkpoint, { next: prefix => `${prefix}-${++sequence}` });
  const created = await engine.commands.createFromSource({
    title: 'Material sintético com data editável',
    material: { text: 'A biblioteca anunciou oficinas de leitura gratuitas.', origin: 'interview', authorized: true },
    brief: { sections: 1, size: 'short' }, plan: ['article'],
  });
  if (!created.ok) throw new Error(created.refusal.message);
  const commands: unknown[][] = [], unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/reporter/workspace') {
      if (request.method() === 'GET') return route.fulfill({ json: {
        state: engine.store.state, jobs: {}, revision, model: 'openai/gpt-4.1', workerOnline: true,
      } });
      const { method, args } = request.postDataJSON();
      expect(method).toBe('updateSourceRecordedOn');
      commands.push(args);
      const result = await engine.commands.updateSourceRecordedOn(args[0], args[1], args[2]);
      revision++;
      return route.fulfill({ json: result });
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ json: {} });
  });
  return {
    engine, commands, unexpected, ...created.value,
    async changeElsewhere(recordedOn: string) {
      const result = await engine.commands.updateSourceRecordedOn(created.value.sourceId, recordedOn, engine.store.state.sources[0].recordedOn ?? null);
      expect(result.ok).toBe(true);
      revision++;
    },
  };
}

for (const viewport of VIEWPORTS) {
  test.describe(`material date at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height },
      ...(viewport.width < 768 ? { isMobile: true, hasTouch: true } : {}) });

    test('saves, validates and clears the source date while preserving the draft after a conflict', async ({ page }) => {
      const errors = watchErrors(page), server = await materialServer(page);
      const original = structuredClone(server.engine.store.state.sources[0]);
      try {
        await page.goto(`/productions/${server.productionId}/source`);
        const open = page.getByRole('button', { name: 'Editar contexto e falantes', exact: true });
        await open.click();
        const drawer = page.getByRole('dialog', { name: 'Contexto e falantes', exact: true });
        const date = drawer.getByRole('textbox', { name: /^Data do material/ });
        const save = drawer.getByRole('button', { name: 'Salvar alterações', exact: true });
        await expect(date).toHaveValue('');
        await date.fill('20/05/2026');
        await date.press('Tab');
        await save.click();
        await expect(drawer).toBeHidden();
        expect(server.commands).toEqual([[server.sourceId, '2026-05-20', null]]);
        expect(server.engine.store.state.sources[0]).toEqual({ ...original, recordedOn: '2026-05-20' });
        await page.reload();
        await open.click();
        await expect(date).toHaveValue('20/05/2026');
        await date.fill('31/02/2026');
        await date.press('Tab');
        await expect(drawer.getByText('Data inválida', { exact: true })).toBeVisible();
        await expect(save).toBeDisabled();
        expect(server.commands).toHaveLength(1);
        await date.fill('21/05/2026');
        await date.press('Tab');
        await server.changeElsewhere('2026-05-22');
        await save.click();
        await expect(drawer.getByText(/A data do material mudou depois/)).toBeVisible();
        await expect(date).toHaveValue('21/05/2026');
        expect(server.engine.store.state.sources[0].recordedOn).toBe('2026-05-22');
        await expectNoHorizontalOverflow(page);
        await drawer.screenshot({ path: test.info().outputPath(`material-date-conflict-${viewport.width}.png`) });
        await drawer.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await page.getByRole('dialog', { name: 'Descartar as alterações?', exact: true }).getByRole('button', { name: 'Descartar alterações', exact: true }).click();
        await expect(drawer).toBeHidden();
        await open.click();
        await expect(date).toHaveValue('22/05/2026');
        await date.fill('');
        await date.press('Tab');
        await save.click();
        await expect(drawer).toBeHidden();
        expect(server.commands.at(-1)).toEqual([server.sourceId, null, '2026-05-22']);
        expect(server.engine.store.state.sources[0]).toEqual(original);
        expect(server.engine.store.state.activity.filter(event => event.type === 'source.date_updated')).toHaveLength(3);
        expect(server.unexpected).toEqual([]);
        expect(errors).toEqual([]);
      } finally { server.engine.store.dispose(); }
    });
  });
}
