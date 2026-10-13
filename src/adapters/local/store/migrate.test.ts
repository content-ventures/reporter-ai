import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { briefHash } from '../../../domain/production.ts';
import type { GenerationRun } from '../../../domain/run.ts';
import { contentHash } from '../../../domain/text/hash.ts';
import { newProductionInput } from '../../../ports/contracts/fixture.ts';
import { migrateV1 } from './migrate.ts';
import { readSnapshot, SNAPSHOT_KEY, SNAPSHOT_SCHEMA } from './snapshot.ts';
import type { StoreState } from './state.ts';
import { memoryStorage } from './storage.ts';
import type { KeyValueStorage } from './storage.ts';
import { createTestPorts, TEST_PEOPLE, testRun, TEST_START } from './testing.ts';

/** `briefHash` as schema 1 computed it, over the old `length` field. */
const legacyHash = (brief: { angle?: string; sections: number; length: string }) =>
  contentHash({ angle: brief.angle?.trim() || undefined, sections: brief.sections, length: brief.length });

type LegacySnapshot = { productionId: string; storage: KeyValueStorage; runs: { current: string; older: string } };

/**
 * A schema 1 snapshot as the app wrote it before the lauda rule: one production whose brief has
 * `length: 'short'` (≈ 500 words), a finished run that used that very brief, and an older run
 * that used an earlier brief (another number of sections).
 */
async function legacySnapshot(): Promise<LegacySnapshot> {
  const storage = memoryStorage();
  const ports = createTestPorts({ storage });
  const created = await ports.commands.createFromSource(newProductionInput({ brief: { angle: 'Foco no cooperado', sections: 3, size: 'standard' } }));
  assert.ok(created.ok);
  const { productionId } = created.value;
  const pieceId = created.value.pieces[0].pieceId;
  const envelope = JSON.parse(storage.getItem(SNAPSHOT_KEY) ?? '{}') as { schema: number; savedAt: string; state: StoreState };
  assert.equal(envelope.schema, SNAPSHOT_SCHEMA);

  const state = envelope.state as unknown as { productions: { production: { id: string; brief: Record<string, unknown> }; runs: GenerationRun[] }[]; runFolds: Record<string, unknown> };
  const entry = state.productions.find((candidate) => candidate.production.id === productionId);
  assert.ok(entry);
  const legacyBrief = { angle: 'Foco no cooperado', sections: 3, length: 'short', revision: 2 };
  entry.production.brief = legacyBrief;
  const finished = (id: string, revision: number, hash: string): GenerationRun => ({
    ...testRun(id, productionId, pieceId, TEST_PEOPLE.editor, TEST_START),
    status: 'completed',
    endedAt: TEST_START,
    steps: [{ id: 'read', label: 'Lendo material', state: 'done', startedAt: TEST_START, endedAt: TEST_START }],
    inputs: [{ kind: 'brief', productionId, revision, hash }],
  });
  const current = finished('run-legacy-current', 2, legacyHash(legacyBrief));
  const older = finished('run-legacy-older', 1, legacyHash({ ...legacyBrief, sections: 4 }));
  entry.runs = [older, current];
  state.runFolds = { [current.id]: { run: current, seq: 1, outline: [], blocks: [], slides: [], sourcesUsed: [], suggestions: [] } };
  storage.setItem(SNAPSHOT_KEY, JSON.stringify({ schema: 1, savedAt: envelope.savedAt, state }));
  return { productionId, storage, runs: { current: current.id, older: older.id } };
}

describe('snapshot schema 1 → 2 (article size by lauda)', () => {
  it('reads a schema 1 snapshot: every old length becomes Padrão, and the brief refs of the unchanged brief are rehashed', async () => {
    const legacy = await legacySnapshot();
    const loaded = readSnapshot(legacy.storage);
    assert.equal(loaded.kind, 'loaded');
    if (loaded.kind !== 'loaded') return;
    const entry = loaded.state.productions.find((candidate) => candidate.production.id === legacy.productionId);
    assert.ok(entry);
    const { brief } = entry.production;
    assert.deepEqual(brief, { angle: 'Foco no cooperado', sections: 3, size: 'standard', revision: 2 });
    assert.equal('length' in brief, false);

    const refOf = (run: GenerationRun | undefined) => run?.inputs.find((ref) => ref.kind === 'brief');
    const current = entry.runs.find((run) => run.id === legacy.runs.current);
    const older = entry.runs.find((run) => run.id === legacy.runs.older);
    assert.equal(refOf(current)?.kind === 'brief' && refOf(current)?.hash, briefHash(brief), 'no false "A pauta mudou depois deste texto"');
    assert.equal(
      refOf(older)?.kind === 'brief' && refOf(older)?.hash,
      legacyHash({ angle: 'Foco no cooperado', sections: 4, length: 'short' }),
      'a run of an earlier brief still reads as written for another brief',
    );
    const fold = loaded.state.runFolds[legacy.runs.current];
    assert.equal(refOf(fold?.run)?.kind === 'brief' && refOf(fold?.run)?.hash, briefHash(brief), 'the stream snapshot agrees with the run');
  });

  it('loads into the store and writes schema 2 on the next save', async () => {
    const legacy = await legacySnapshot();
    const ports = createTestPorts({ storage: legacy.storage });
    assert.equal(ports.store.loadReport.source, 'snapshot');
    const detail = await ports.queries.get(legacy.productionId);
    assert.ok(detail.ok);
    assert.equal(detail.value.brief.size, 'standard');
    const saved = await ports.commands.updateBrief(legacy.productionId, { sections: 2, size: 'short' }, detail.value.brief.revision);
    assert.ok(saved.ok, saved.ok ? '' : saved.refusal.message);
    const envelope = JSON.parse(legacy.storage.getItem(SNAPSHOT_KEY) ?? '{}') as { schema: number };
    assert.equal(envelope.schema, 2);
  });

  it('leaves a schema 2 state untouched', () => {
    const state = { productions: [{ production: { brief: { sections: 2, size: 'short', revision: 1 } }, runs: [] }], runFolds: {} } as unknown as StoreState;
    const migrated = migrateV1(state);
    assert.equal(migrated.productions[0], state.productions[0]);
  });
});
