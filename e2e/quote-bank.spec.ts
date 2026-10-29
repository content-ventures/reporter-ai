import { expect, test } from '@playwright/test';
import type { CitationLibraryView, CitationView } from '../src/domain/citation-library.ts';
import { emptyEditorialCheckpoint } from '../src/runtime/editorial-engine.ts';
import { createEditorialEngine } from '../src/runtime/editorial-engine.ts';
import { randomUUID } from 'node:crypto';
import { memoryWritingFixture } from '../src/domain/testing/editorial-memory.ts';
import { paragraphBlock } from '../src/domain/article.ts';
import { segmentRef } from '../src/domain/refs.ts';
import { toSourceVersionRef } from '../src/domain/source.ts';
import { contentHash } from '../src/domain/text/hash.ts';
import type { MemorySelectedContext } from '../src/ports/editorial-memory.ts';
import { defaultPipelineDefinition, pipelineRevision } from '../src/domain/pipeline.ts';
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
      citation('c-checked', 'Dobramos a capacidade de defumação em março.', { relevance: 'Capacidade da fábrica.', ready: true, recordedOn: '2026-10-20' }),
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

    test('the selected-origin reader preserves recorded confidence and restores keyboard focus', async ({ page }) => {
      const checkpoint = emptyEditorialCheckpoint(), engine = createEditorialEngine(checkpoint, { next: () => randomUUID() });
      const ctx = { actorId: checkpoint.state.members[0].personId, now: '2026-10-29T03:00:00.000Z', newId: () => randomUUID() };
      const literal = 'Foram atendidas cerca de 240 pessoas em 2025, em um exemplo exclusivamente sintético.';
      const f = memoryWritingFixture('statistic', literal, ctx, checkpoint.state.workspace.id), source = f.source;
      const checked = { id: f.item.view.evidence.id, revision: 1 };
      source.memory[0].items[0].selected.check = checked; f.selection.items[0].check = checked; f.item.view.decision!.check = checked;
      const made = await engine.commands.createBlank({ title: 'QA sintético de origem', brief: { size: 'standard', sections: 3 } });
      expect(made.ok).toBe(true); if (!made.ok) return;
      const { productionId, pieceId } = made.value, body = { type: 'article' as const, title: 'QA sintético de origem',
        blocks: [paragraphBlock('observation', literal, { sourceRefs: [segmentRef(source.id, 1, 'memory-item-1', { from: 0, to: literal.length })] })] };
      engine.records.apply(productionId, record => ({ ...record, sources: [source], production: { ...record.production, sourceIds: [source.id] },
        pieces: record.pieces.map(piece => piece.id === pieceId ? { ...piece, draft: { ...piece.draft, body } } : piece) }));
      const record = engine.records.record(productionId)!, piece = record.pieces.find(piece => piece.id === pieceId)!;
      const evidence = f.item.view.evidence, binding = structuredClone(source.memory[0].items[0]), decision = structuredClone(f.item.view.decision!);
      const origin: MemorySelectedContext = { productionId, collection: toSourceVersionRef(source), segmentId: binding.segmentId, binding,
        selection: f.selection, snapshot: '1', evidence, material: { ...f.item.view.material, revision: 1, workspaceId: source.workspaceId,
          source: evidence.anchor.source, metadata: evidence.metadata, importedAt: ctx.now, importedBy: ctx.actorId, originalFileId: null }, policy: f.item.policy,
        check: { id: evidence.id, revision: 1, workspaceId: source.workspaceId, evidence: binding.selected.evidence, policyRevision: 1,
          checkedAt: ctx.now, verdict: 'not_validated', confidence: 87.5, claims: [], supports: [], strength: { score: 4, reason: 'Força sintética separada da confiança.' }, provider: 'synthetic', model: 'synthetic' },
        decision, checkRestricted: false, decisionRestricted: false, original: { ref: evidence.anchor.source, authorized: true, before: 'Contexto sintético anterior.', excerpt: literal, after: 'Contexto sintético posterior.' },
        current: { evidence: binding.selected.evidence, matchesSelection: true, usable: true }, readOnly: false };
      const unexpected: string[] = [], errors = watchErrors(page);
      await page.route('**/api/reporter/**', route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (request.method() === 'GET' && path.endsWith('/workspace')) return route.fulfill({ json: { state: engine.store.state, jobs: {}, revision: 1, model: 'openai/gpt-4.1', workerOnline: true } });
        if (request.method() === 'GET' && path.endsWith('/writing-status')) return route.fulfill({ json: { productionId, updatedAt: record.production.updatedAt,
          checkedAt: ctx.now, sources: [toSourceVersionRef(source)], issues: [], draft: { pieceId, revision: piece.draft.revision, hash: contentHash(body) }, draftIssues: [] } });
        if (request.method() === 'GET' && path.endsWith('/context')) return route.fulfill({ json: origin });
        if (request.method() === 'GET' && path.endsWith('/citations')) return route.fulfill({ json: { items: [], sources: [] } });
        if (request.method() === 'GET' && path.endsWith('/pipeline')) return route.fulfill({ json: { active: pipelineRevision(defaultPipelineDefinition()),
          history: [], runs: [], providers: { openai: false, groq: false, anthropic: false, gemini: false } } });
        unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 500, json: { error: 'UNEXPECTED_SYNTHETIC_REQUEST' } });
      });
      await page.goto(`/productions/${productionId}/article`);
      await expect(page.locator('[contenteditable="true"]')).toBeVisible();
      const material = page.getByRole('tab', { name: 'Material', exact: true });
      if (await material.isVisible()) await material.click(); else await page.getByRole('button', { name: 'Material', exact: true }).click();
      const trigger = page.getByRole('button', { name: 'Ver origem da evidência', exact: true });
      await trigger.click(); const reader = page.getByRole('dialog', { name: 'Origem da evidência selecionada', exact: true });
      await expect(reader.getByRole('textbox', { name: 'Trecho original selecionado', exact: true })).toHaveValue(literal);
      await expect(reader.getByText('87.5%', { exact: true })).toBeVisible();
      await expect(reader.getByText('4 — Força sintética separada da confiança.', { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page); await page.keyboard.press('Escape'); await expect(reader).not.toBeVisible(); await expect(trigger).toBeFocused();
      origin.check!.confidence = null; await trigger.click(); await expect(reader.getByText('Não calibrada', { exact: true })).toBeVisible();
      await expect(reader.getByText('87.5%', { exact: true })).toHaveCount(0); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
      expect(unexpected).toEqual([]); expect(errors).toEqual([]); expect(engine.records.record(productionId)!.pieces.find(piece => piece.id === pieceId)!.draft.body).toEqual(body);
    });

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
      // The recording date shows only when the source has one, never the day the text was written.
      await expect(cards.filter({ hasText: 'Dobramos' }).getByText('20/10/2026')).toBeVisible();
      await expect(page.getByText('19/10/2026')).toHaveCount(0);
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
