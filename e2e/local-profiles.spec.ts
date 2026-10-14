import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { createEditorialEngine, emptyEditorialCheckpoint, selectEditorialLocalRole } from '../src/runtime/editorial-engine.ts';
import { VIEWPORTS, expectNoHorizontalOverflow, watchErrors } from './support';

async function replay(page: Page, options: { ordinary?: boolean; refuse?: boolean } = {}) {
  const checkpoint = emptyEditorialCheckpoint();
  if (options.ordinary) delete checkpoint.state.members[0].localOperator;
  const engine = createEditorialEngine(checkpoint, { next: () => randomUUID() });
  let revision = 0;
  const selected: string[] = [], authRequests: string[] = [];
  page.on('request', request => { if (/\/api\/auth\//.test(request.url())) authRequests.push(request.url()); });
  await page.route('**/api/reporter/material/analysis', route => route.fulfill({ json: { title: 'Material sintético', participants: [], pipelineRevision: 1 } }));
  await page.route('**/api/reporter/workspace', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { state: engine.store.state, jobs: {}, revision, model: 'openai/gpt-4.1', workerOnline: true } });
      return;
    }
    const { method, args } = route.request().postDataJSON();
    expect(method).toBe('session.selectLocalRole');
    selected.push(args[0]);
    const result = options.refuse ? { ok: false, refusal: { code: 'unavailable', message: 'Não foi possível trocar o perfil.' } }
      : selectEditorialLocalRole(engine, args[0]);
    revision++;
    await route.fulfill({ json: result });
  });
  return { engine, selected, authRequests };
}

async function openMenu(page: Page, mobile: boolean) {
  await expect(page.getByRole('button', { name: /Operador local.*Menu da conta/, includeHidden: true })).toBeAttached();
  if (mobile) await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
}

async function choose(page: Page, profile: string) {
  const select = page.getByRole('combobox', { name: 'Perfil de teste', exact: true });
  await select.click();
  await page.getByRole('option', { name: profile, exact: true }).click();
  await expect(select).toHaveText(profile);
}

for (const viewport of VIEWPORTS) {
  test.describe(`perfis locais em ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    test('alterna permissões sem logout, preserva o formulário e mantém o perfil após recarga', async ({ page }) => {
      test.setTimeout(120_000);
      const runtime = await replay(page), errors = watchErrors(page), mobile = viewport.width < 768;
      try {
        await page.goto('/productions/new');
        await expect(page.getByRole('button', { name: /Operador local.*Menu da conta/, includeHidden: true })).toBeAttached();
        const material = page.getByRole('textbox', { name: 'Transcrição', exact: true });
        await material.fill('Material sintético mantido durante a troca de perfil.');
        await openMenu(page, mobile);
        const selector = page.getByRole('combobox', { name: 'Perfil de teste', exact: true });
        await expect(selector).toHaveText('Admin');
        await selector.click();
        await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Editor', 'Aprovador', 'Admin']);
        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
        await expect(selector).toHaveText('Editor');
        await expect(selector).toBeFocused();
        await expect(page.getByRole('link', { name: 'Logs', exact: true })).toHaveCount(0);
        await expect(material).toHaveValue('Material sintético mantido durante a troca de perfil.');
        await choose(page, 'Aprovador');
        await expect(page.getByRole('link', { name: /^Aprovações/ })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Logs', exact: true })).toHaveCount(0);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openMenu(page, mobile);
        await expect(selector).toHaveText('Aprovador');
        await choose(page, 'Admin');
        await expect(page.getByRole('link', { name: 'Logs', exact: true })).toBeVisible();
        expect(runtime.selected).toEqual(['editor', 'approver', 'admin']);
        expect(runtime.authRequests).toEqual([]);
        await expectNoHorizontalOverflow(page);
        expect(errors).toEqual([]);
      } finally { runtime.engine.store.dispose(); }
    });
    test('uma falha mantém o perfil anterior e o operador comum não vê o seletor', async ({ page }) => {
      const runtime = await replay(page, { refuse: true });
      try {
        await page.goto('/productions/new');
        await openMenu(page, viewport.width < 768);
        const selector = page.getByRole('combobox', { name: 'Perfil de teste', exact: true });
        await expect(selector).toHaveText('Admin');
        await selector.click();
        await page.getByRole('option', { name: 'Editor', exact: true }).click();
        await expect(page.getByText('Não foi possível trocar o perfil.', { exact: true })).toBeVisible();
        await expect(selector).toHaveText('Admin');
        expect(runtime.authRequests).toEqual([]);
      } finally { runtime.engine.store.dispose(); }
      await page.unroute('**/api/reporter/workspace');
      const ordinary = await replay(page, { ordinary: true });
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openMenu(page, viewport.width < 768);
        await expect(page.getByRole('button', { name: /Operador local.*Menu da conta/ })).toBeVisible();
        await expect(page.getByRole('combobox', { name: 'Perfil de teste', exact: true })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
      } finally { ordinary.engine.store.dispose(); }
    });
  });
}
