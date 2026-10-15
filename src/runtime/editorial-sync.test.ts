import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendEditorialEvent, createEditorialEngine, emptyEditorialCheckpoint, LOCAL_OPERATOR } from './editorial-engine.ts';
import { applyWorkspaceDelta, assembleCheckpoint, diffRows, hasChanges, PART_KINDS, ScopeViolation, splitCheckpoint } from './editorial-sync.ts';
import type { EditorialRows, LoadedScope, WorkspaceDelta } from './editorial-sync.ts';
import type { ConnectedWorkspace, EditorialCheckpoint, EditorialJob } from '../ports/connected-workspace.ts';
import { stableStringify } from '../domain/text/hash.ts';

let sequence = 0;
const ids = { next: (prefix: string) => prefix + '-' + (++sequence) };
const material = 'Material sintético. A biblioteca oferecerá quatro oficinas gratuitas em novembro. As inscrições ainda não estão abertas.';
const input = { title: 'Produção do codec', material: { text: material, origin: 'podcast' as const, authorized: true },
  brief: { sections: 2, size: 'short' as const }, plan: ['article' as const] };
const everything: LoadedScope = { parts: PART_KINDS, items: ['person', 'member', 'activity', 'feedback', 'image_asset'], history: false };
const empty: EditorialRows = { seq: 0, workspace: null, productions: [], parts: [], sources: [], runs: [], events: [], items: [], pipelines: [] };

/** Rows as the database returns them: ordinals in insertion order, tombstones dropped. */
function stored(rows: EditorialRows): EditorialRows {
  let ordinal = 0;
  const number = <T,>(list: T[]) => list.map(row => ({ ...row, ordinal: ++ordinal }));
  return { ...rows, productions: number(rows.productions), parts: number(rows.parts.filter(row => !row.deleted)),
    sources: number(rows.sources), items: number(rows.items.filter(row => !row.deleted)) };
}

async function workspaceWithRun() {
  const checkpoint = emptyEditorialCheckpoint(), engine = createEditorialEngine(checkpoint, ids);
  const created = await engine.commands.createFromSource(input); assert.ok(created.ok);
  const pieceId = created.value.pieces.find(piece => piece.kind === 'article')!.pieceId;
  const begin = engine.runs.begin({ productionId: created.value.productionId, kind: 'article.generate', prompt: { key: 'test', version: '1', hash: 'prompt' },
    model: { alias: 'model', label: 'Modelo', engine: 'provider' }, steps: [{ id: 'generate', label: 'Gerar' }] });
  assert.ok(begin.ok);
  const run = begin.value.run;
  const job: EditorialJob = { kind: 'article.draft', input: { productionId: created.value.productionId, pieceId }, attempts: 0, availableAt: 0, events: [],
    meta: { runId: run.id, productionId: created.value.productionId, pieceId, label: 'Gerar', request: { kind: 'article.draft', input: { productionId: created.value.productionId, pieceId } } } };
  appendEditorialEvent(engine, job, { type: 'run.started', kind: run.kind, productionId: run.productionId, pieceId, model: run.model, prompt: run.prompt,
    inputs: run.inputs, steps: [{ id: 'generate', label: 'Gerar' }], createdBy: LOCAL_OPERATOR });
  checkpoint.state = engine.store.state;
  checkpoint.jobs[run.id] = job;
  return { checkpoint, engine, productionId: created.value.productionId, pieceId, runId: run.id };
}

test('splitting a checkpoint into rows and assembling it again loses nothing the engine reads', async () => {
  const { checkpoint, engine } = await workspaceWithRun();
  const rows = stored(splitCheckpoint(checkpoint, empty, everything));
  const assembled = assembleCheckpoint(rows, checkpoint.state.workspace, everything);
  const comparable = (value: EditorialCheckpoint) => stableStringify({ ...value, state: { ...value.state, sessionPersonId: '' } });
  assert.equal(comparable(assembled), comparable({ ...checkpoint, imageAssets: [] }));
  engine.store.dispose();
});

test('a change writes only the rows it touched, and new events only', async () => {
  const { checkpoint, engine, productionId, runId } = await workspaceWithRun();
  const before = stored(splitCheckpoint(checkpoint, empty, everything));
  const current = assembleCheckpoint(before, checkpoint.state.workspace, everything);
  const resumed = createEditorialEngine(current, ids);
  const renamed = await resumed.commands.rename(productionId, 'Título revisado');
  assert.ok(renamed.ok);
  current.state = resumed.store.state;
  appendEditorialEvent(resumed, current.jobs[runId], { type: 'step.started', stepId: 'generate' });
  current.state = resumed.store.state;
  const changes = diffRows(before, splitCheckpoint(current, before, everything), everything);
  assert.deepEqual(changes.productions.map(row => row.id), [productionId]);
  assert.deepEqual(changes.events.map(row => row.event.type), ['step.started']);
  assert.deepEqual(changes.runs.map(row => row.id), [runId]);
  assert.ok(changes.items.every(row => row.kind === 'activity'), 'only the new activity entry is written among items');
  assert.equal(changes.sources.length, 0);
  assert.equal(hasChanges(diffRows(before, splitCheckpoint(assembleCheckpoint(before, checkpoint.state.workspace, everything), before, everything), everything)), false);
  engine.store.dispose(); resumed.store.dispose();
});

test('a command that adds a part kind it did not load is refused instead of silently numbering it', async () => {
  const { checkpoint, engine, pieceId } = await workspaceWithRun();
  const scope: LoadedScope = { ...everything, parts: ['piece', 'review', 'decision'] };
  const loaded = stored(splitCheckpoint(checkpoint, empty, everything));
  const before = { ...loaded, parts: loaded.parts.filter(row => scope.parts.includes(row.kind)) };
  const current = assembleCheckpoint(before, checkpoint.state.workspace, scope);
  const resumed = createEditorialEngine(current, ids);
  const drafted = await resumed.commands.saveDraft(pieceId, { type: 'article', title: 'Rascunho', blocks: [{ id: 'p1', type: 'paragraph', inlines: [{ text: material }], ai: 'reviewed' }] }, 0);
  assert.ok(drafted.ok, JSON.stringify(drafted));
  const saved = await resumed.commands.createVersion(pieceId);
  assert.ok(saved.ok, JSON.stringify(saved));
  current.state = resumed.store.state;
  assert.throws(() => diffRows(before, splitCheckpoint(current, before, scope), scope), ScopeViolation);
  engine.store.dispose(); resumed.store.dispose();
});

test('a delta merged into the browser workspace equals a fresh snapshot of the same rows', async () => {
  const { checkpoint, engine, productionId, runId } = await workspaceWithRun();
  const before = stored(splitCheckpoint(checkpoint, empty, everything));
  const browser: ConnectedWorkspace = { ...assembleCheckpoint(before, checkpoint.state.workspace, everything), revision: 1, model: 'model', workerOnline: true };
  const current = assembleCheckpoint(before, checkpoint.state.workspace, everything);
  const resumed = createEditorialEngine(current, ids);
  assert.ok((await resumed.commands.rename(productionId, 'Título do delta')).ok);
  current.state = resumed.store.state;
  appendEditorialEvent(resumed, current.jobs[runId], { type: 'step.started', stepId: 'generate' });
  current.state = resumed.store.state;
  const after = splitCheckpoint(current, before, everything);
  const changes = diffRows(before, after, everything);
  const delta: WorkspaceDelta = { seq: 2, productions: changes.productions, parts: changes.parts, sources: changes.sources,
    runs: changes.runs.map(row => ({ id: row.id, productionId: row.productionId, status: row.status, job: { meta: row.job!.meta, kind: row.job!.kind }, fold: row.fold })),
    events: changes.events, items: changes.items };
  const untouched = browser.state.productions;
  const merged = applyWorkspaceDelta(browser, delta);
  assert.deepEqual(merged.productionIds, [productionId]);
  const fresh = assembleCheckpoint(stored(after), checkpoint.state.workspace, everything);
  assert.equal(stableStringify({ ...merged.workspace.state, sessionPersonId: '' }), stableStringify({ ...fresh.state, sessionPersonId: '' }));
  assert.deepEqual(merged.workspace.jobs[runId].events.map(event => event.seq), [1, 2]);
  assert.equal(merged.workspace.revision, 2);
  assert.notEqual(merged.workspace.state.productions, untouched);
  engine.store.dispose(); resumed.store.dispose();
});
