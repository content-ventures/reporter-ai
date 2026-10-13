import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONTRACT_TRANSCRIPT, newProductionInput } from '../../../ports/contracts/fixture.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import { paragraphBlock } from '../../../domain/article.ts';
import type { PersonSummary } from '../../../ports/common.ts';
import { activitySummary } from './activity-text.ts';
import { DRAFT_SLOT_KEY, SNAPSHOT_KEY } from './snapshot.ts';
import { memoryStorage } from './storage.ts';
import { createTestPorts } from './testing.ts';
import type { TestPorts } from './testing.ts';

function article(text: string): ArticleBody {
  return { type: 'article', title: 'Rascunho', blocks: [paragraphBlock('b-1', text)] };
}

async function created(ports: TestPorts) {
  const result = await ports.commands.createFromSource(newProductionInput());
  assert.ok(result.ok);
  return result.value;
}

async function revisionOf(ports: TestPorts, pieceId: string): Promise<number> {
  const draft = await ports.queries.draft(pieceId);
  assert.ok(draft.ok);
  return draft.value.revision;
}

describe('local store persistence', () => {
  it('writes the workspace under reporter:sim:v1 and reloads it', async () => {
    const storage = memoryStorage();
    const first = createTestPorts({ storage });
    const { productionId } = await created(first);
    assert.ok(storage.getItem(SNAPSHOT_KEY), 'commands persist immediately');
    assert.equal(first.saveStatus.current().status, 'saved');

    const reloaded = createTestPorts({ storage });
    assert.equal(reloaded.store.loadReport.source, 'snapshot');
    const detail = await reloaded.queries.get(productionId);
    assert.ok(detail.ok);
    assert.equal(detail.value.title, 'Cooperativa Vale Verde');
  });

  it('autosaves into one overwritten draft slot, never growing the snapshot', async () => {
    const storage = memoryStorage();
    const ports = createTestPorts({ storage });
    const { pieces } = await created(ports);
    const pieceId = pieces[0].pieceId;
    const snapshot = storage.getItem(SNAPSHOT_KEY);

    for (const text of ['Primeira frase.', 'Segunda frase.', 'Terceira frase.']) {
      const saved = await ports.commands.saveDraft(pieceId, article(text), await revisionOf(ports, pieceId));
      assert.ok(saved.ok && saved.value.persisted);
    }
    assert.equal(storage.getItem(SNAPSHOT_KEY), snapshot, 'autosave does not rewrite the snapshot');
    const slot = JSON.parse(storage.getItem(DRAFT_SLOT_KEY) ?? '{}') as { drafts: Record<string, { body: ArticleBody }> };
    assert.deepEqual(Object.keys(slot.drafts), [pieceId], 'one slot entry per piece, overwritten');
    assert.equal(slot.drafts[pieceId].body.blocks.length, 1);

    const reloaded = createTestPorts({ storage });
    assert.equal(reloaded.store.loadReport.draftsApplied, 1);
    const draft = await reloaded.queries.draft(pieceId);
    assert.ok(draft.ok && draft.value.body.type === 'article');
    assert.equal(JSON.stringify(draft.value.body).includes('Terceira frase.'), true);

    const version = await reloaded.commands.createVersion(pieceId);
    assert.ok(version.ok);
    assert.equal(storage.getItem(DRAFT_SLOT_KEY), null, 'a full snapshot absorbs the slot');
  });

  it('surfaces a quota error as a save error, keeps working in memory and retries', async () => {
    const storage = memoryStorage();
    const ports = createTestPorts({ storage });
    const { pieces, productionId } = await created(ports);
    const pieceId = pieces[0].pieceId;
    const states: string[] = [];
    ports.saveStatus.subscribe((state) => states.push(state.status));

    storage.setQuota(10);
    const saved = await ports.commands.saveDraft(pieceId, article('Texto que não cabe.'), await revisionOf(ports, pieceId));
    assert.ok(saved.ok, 'the edit is kept in memory');
    assert.equal(saved.value.persisted, false);
    const failed = ports.saveStatus.current();
    assert.equal(failed.status, 'error');
    assert.equal(failed.error?.code, 'quota');
    assert.ok(failed.error?.message.includes('espaço'));

    const retryFailed = await ports.saveStatus.retry();
    assert.equal(retryFailed.ok, false);
    storage.setQuota(undefined);
    const retried = await ports.saveStatus.retry();
    assert.ok(retried.ok);
    assert.equal(retried.value.status, 'saved');
    assert.deepEqual(states.slice(-1), ['saved']);

    const reloaded = createTestPorts({ storage });
    const draft = await reloaded.queries.draft(pieceId);
    assert.ok(draft.ok && JSON.stringify(draft.value.body).includes('Texto que não cabe.'));
    assert.ok((await reloaded.queries.get(productionId)).ok);
  });

  it('reports memory-only mode honestly when there is no storage', async () => {
    const ports = createTestPorts();
    await created(ports);
    assert.deepEqual(ports.saveStatus.current(), { status: 'idle', scope: 'memory' });
  });

  it('restores the fixtures on reset (?reset=1) and on demand', async () => {
    const storage = memoryStorage();
    const ports = createTestPorts({ storage });
    await created(ports);
    const reopened = createTestPorts({ storage, reset: true });
    assert.equal(reopened.store.loadReport.source, 'seed');
    assert.equal((await reopened.queries.list()).total, 0);
    assert.equal(storage.getItem(SNAPSHOT_KEY), null);

    await created(ports);
    let resetNotices = 0;
    ports.queries.subscribe((notice) => {
      if (notice.scope === 'reset') resetNotices += 1;
    });
    ports.store.reset();
    assert.equal((await ports.queries.list()).total, 0);
    assert.equal(resetNotices, 1);
  });

  it('falls back to the fixtures when the snapshot is corrupt or from another schema', () => {
    const corrupt = memoryStorage();
    corrupt.setItem(SNAPSHOT_KEY, '{not json');
    assert.deepEqual(createTestPorts({ storage: corrupt }).store.loadReport, { source: 'seed', issue: 'corrupt', draftsApplied: 0 });

    const other = memoryStorage();
    other.setItem(SNAPSHOT_KEY, JSON.stringify({ schema: 99, state: {} }));
    assert.equal(createTestPorts({ storage: other }).store.loadReport.issue, 'schema');

    const broken = memoryStorage();
    broken.setItem(SNAPSHOT_KEY, JSON.stringify({ schema: 1, state: { workspace: {} } }));
    assert.equal(createTestPorts({ storage: broken }).store.loadReport.issue, 'corrupt');
  });

  it('returns copies: mutating a read model never changes the store', async () => {
    const ports = createTestPorts();
    const { productionId } = await created(ports);
    const detail = await ports.queries.get(productionId);
    assert.ok(detail.ok);
    detail.value.production.title = 'alterado por engano';
    detail.value.pieces[0].versions.push({} as never);
    const again = await ports.queries.get(productionId);
    assert.ok(again.ok);
    assert.equal(again.value.production.title, 'Cooperativa Vale Verde');
    assert.equal(again.value.pieces[0].versions.length, 0);
  });

  it('applies the configured read latency before each query', async () => {
    const operations: string[] = [];
    const ports = createTestPorts({
      delay: async (operation) => {
        operations.push(operation);
      },
    });
    await ports.queries.list();
    await ports.queries.overview('30d');
    assert.deepEqual(operations, ['list', 'overview']);
  });

  it('keeps speakers mapped to people and reuses a duplicate source', async () => {
    const ports = createTestPorts();
    const first = await created(ports);
    const mapped = await ports.commands.updateSpeakers(first.sourceId, [{ label: 'Helena Duarte', personId: null, newPerson: { name: 'Helena Duarte' } }]);
    assert.ok(mapped.ok);
    assert.ok(mapped.value.speakers.find((speaker) => speaker.label === 'Helena Duarte')?.person);
    const unknown = await ports.commands.updateSpeakers(first.sourceId, [{ label: 'Ninguém', personId: null }]);
    assert.equal(unknown.ok, false);

    const analysis = await ports.ingest.analyze(CONTRACT_TRANSCRIPT);
    assert.ok(analysis.ok && analysis.value.duplicate);
    const reused = await ports.commands.createFromSource(newProductionInput({ title: 'Segunda pauta', reuseSourceId: analysis.value.duplicate.sourceId }));
    assert.ok(reused.ok);
    assert.equal(reused.value.sourceId, first.sourceId);
    const source = await ports.queries.source(first.sourceId);
    assert.ok(source.ok);
    assert.equal(source.value.productions.length, 2);
  });
});

describe('the review of the whole text in the activity feed', () => {
  const aiArticle = (state: 'unreviewed' | 'reviewed', second = 'Dois.'): ArticleBody => ({
    type: 'article',
    title: 'Rascunho',
    blocks: [paragraphBlock('b-1', 'Um.', { ai: state }), paragraphBlock('b-2', second, { ai: state })],
  });

  it('logs it when a save flips the AI blocks, never for typing, and persists it with the snapshot', async () => {
    const storage = memoryStorage();
    const ports = createTestPorts({ storage });
    const { pieces } = await created(ports);
    const pieceId = pieces[0].pieceId;
    const reviewTypes = () => ports.store.state.activity.map((event) => event.type).filter((type) => type.startsWith('text.'));
    const save = async (body: ArticleBody) => {
      const saved = await ports.commands.saveDraft(pieceId, body, await revisionOf(ports, pieceId));
      assert.ok(saved.ok);
    };

    await save(aiArticle('unreviewed'));
    await save(aiArticle('unreviewed', 'Dois, com mais texto.'));
    assert.deepEqual(reviewTypes(), [], 'typing and AI text are not a click on the review');

    await save(aiArticle('reviewed', 'Dois, com mais texto.'));
    assert.deepEqual(reviewTypes(), ['text.reviewed']);
    await save(aiArticle('reviewed', 'Dois, ainda mais texto.'));
    assert.deepEqual(reviewTypes(), ['text.reviewed'], 'typing in a reviewed text keeps it reviewed and logs nothing');

    await save(aiArticle('unreviewed', 'Dois, ainda mais texto.'));
    assert.deepEqual(reviewTypes(), ['text.reviewed', 'text.review_reopened']);

    const reloaded = createTestPorts({ storage });
    assert.deepEqual(
      reloaded.store.state.activity.map((event) => event.type).filter((type) => type.startsWith('text.')),
      ['text.reviewed', 'text.review_reopened'],
      'the activity survives a reload',
    );
    const ana = { id: 'p-ana', name: 'Ana Prado' } as PersonSummary;
    const [marked, reopened] = ports.store.state.activity.filter((event) => event.type.startsWith('text.'));
    assert.equal(activitySummary(marked, ana), 'Ana Prado marcou o texto como revisado');
    assert.equal(activitySummary(reopened, ana), 'Ana Prado desfez a revisão do texto');
  });
});
