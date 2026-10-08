import { sliceText } from '../../../domain/article.ts';
import type { CarouselTemplate } from '../../../domain/carousel.ts';
import { SIMULATED_MODEL } from '../../../domain/run.ts';
import type { GenerationRun } from '../../../domain/run.ts';
import type { Suggestion } from '../../../domain/suggestion.ts';
import type { PortsUnderTest } from '../../../ports/contracts/fixture.ts';
import { createLocalPorts } from './index.ts';
import type { LocalPorts, LocalPortsOptions } from './index.ts';
import type { StoreSeed } from './state.ts';
import type { KeyValueStorage } from './storage.ts';
import { manualClock, sequentialIds } from './system.ts';
import type { ManualClock } from './system.ts';

/**
 * Test harness for the local store (used by `*.test.ts` only; fixtures for the product live in
 * src/fixtures). Neutral fictional people, a minimal carousel template, a manual clock.
 */

export const TEST_PEOPLE = {
  editor: 'person-editor',
  approver: 'person-approver',
  editorOnly: 'person-writer',
} as const;

export const TEST_TEMPLATE: CarouselTemplate = {
  id: 'tpl-test',
  name: 'Modelo de teste',
  width: 1080,
  height: 1350,
  minSlides: 3,
  maxSlides: 10,
  coverLayoutId: 'cover',
  layouts: [
    { id: 'cover', label: 'Capa', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 60, required: true }] },
    { id: 'quote', label: 'Citação', slots: [{ id: 'quote', label: 'Citação', role: 'quote', maxChars: 140, required: true }] },
    { id: 'closing', label: 'Conclusão', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 60 }] },
  ],
};

export const TEST_START = '2026-10-07T12:00:00.000Z';

export function testSeed(): StoreSeed {
  const workspaceId = 'ws-test';
  return {
    workspace: { id: workspaceId, name: 'Redação de teste', slug: 'teste', createdAt: '2026-01-01T00:00:00.000Z' },
    people: [
      { id: TEST_PEOPLE.editor, name: 'Clara Nogueira', title: 'editora' },
      { id: TEST_PEOPLE.approver, name: 'Rafael Moura', title: 'aprovador' },
      { id: TEST_PEOPLE.editorOnly, name: 'Bianca Teles', title: 'redatora' },
    ],
    members: [
      { workspaceId, personId: TEST_PEOPLE.editor, roles: ['editor', 'admin'] },
      { workspaceId, personId: TEST_PEOPLE.approver, roles: ['approver'] },
      { workspaceId, personId: TEST_PEOPLE.editorOnly, roles: ['editor'] },
    ],
    sessionPersonId: TEST_PEOPLE.editor,
  };
}

export type TestPorts = LocalPorts & { clock: ManualClock };

/** A generation run as a provider would record it (running, "Simulação local"). */
export function testRun(id: string, productionId: string, pieceId: string, createdBy: string, at: string): GenerationRun {
  return {
    id,
    kind: 'article.generate',
    productionId,
    pieceId,
    prompt: { key: 'test.prompt', version: '1', hash: 'test' },
    model: SIMULATED_MODEL,
    inputs: [],
    status: 'running',
    steps: [{ id: 'read', label: 'Lendo material', state: 'current', startedAt: at }],
    createdBy,
    createdAt: at,
    startedAt: at,
  };
}

export function createTestPorts(options: Partial<LocalPortsOptions> & { storage?: KeyValueStorage } = {}): TestPorts {
  const clock = manualClock(TEST_START);
  const local = createLocalPorts({
    seed: testSeed,
    clock,
    ids: sequentialIds(),
    templates: [TEST_TEMPLATE],
    scheduler: () => () => undefined,
    ...options,
  });
  return { ...local, clock };
}

/** Adapts the local ports to the contract fixture, including the run/suggestion hooks. */
export function toPortsUnderTest(local: TestPorts): PortsUnderTest {
  const productionOf = (pieceId: string) =>
    local.store.state.productions.find((entry) => entry.pieces.some((piece) => piece.id === pieceId))?.production.id ?? '';
  return {
    queries: local.queries,
    commands: local.commands,
    ingest: local.ingest,
    session: local.session,
    feedback: local.feedback,
    saveStatus: local.saveStatus,
    people: { ...TEST_PEOPLE },
    carouselTemplateId: TEST_TEMPLATE.id,
    async actAs(personId) {
      const result = await local.session.actAs?.(personId);
      if (!result?.ok) throw new Error(`actAs ${personId} refused`);
    },
    async advance(ms) {
      local.clock.advance(ms);
    },
    simulate: {
      async activeRun(pieceId) {
        const productionId = productionOf(pieceId);
        let runId = '';
        const started = local.records.apply(productionId, (record, ctx) => {
          runId = ctx.newId('run');
          return { ...record, runs: [...record.runs, testRun(runId, productionId, pieceId, ctx.actorId, ctx.now)] };
        });
        if (!started.ok) throw new Error(started.refusal.message);
        return async () => {
          local.records.apply(productionId, (record, ctx) => ({
            ...record,
            runs: record.runs.map((run) => (run.id === runId ? { ...run, status: 'cancelled', endedAt: ctx.now } : run)),
          }));
        };
      },
      async suggestion(pieceId, input) {
        const productionId = productionOf(pieceId);
        let id = '';
        const added = local.records.apply(productionId, (record, ctx) => {
          const piece = record.pieces.find((entry) => entry.id === pieceId);
          if (!piece || piece.draft.body.type !== 'article') return record;
          const body = piece.draft.body;
          id = ctx.newId('sug');
          const suggestion: Suggestion = {
            id,
            runId: 'run-test-assist',
            pieceId,
            baseRevision: piece.draft.revision,
            target: input.target,
            anchorText: input.target.map((range) => sliceText(body, range) ?? ''),
            proposal: input.proposal,
            state: 'ready',
            createdAt: ctx.now,
            ...(input.label ? { label: input.label } : {}),
          };
          return { ...record, suggestions: [...record.suggestions, suggestion] };
        });
        if (!added.ok || !id) throw new Error('suggestion not created');
        return id;
      },
    },
    dispose: () => local.store.dispose(),
  };
}
