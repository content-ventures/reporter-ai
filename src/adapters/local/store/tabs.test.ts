import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paragraphBlock } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import type { ChangeNotice } from '../../../ports/common.ts';
import { newProductionInput } from '../../../ports/contracts/fixture.ts';
import { DRAFT_SLOT_KEY, SNAPSHOT_KEY } from './snapshot.ts';
import { memoryStorage } from './storage.ts';
import type { KeyValueStorage } from './storage.ts';
import { createTestPorts } from './testing.ts';
import type { TestPorts } from './testing.ts';

/** A10: two tabs of one browser on the same saved workspace never overwrite each other silently. */

function article(text: string): ArticleBody {
  return { type: 'article', title: 'Rascunho', blocks: [paragraphBlock('b-1', text)] };
}

function tab(storage: KeyValueStorage, tabId: string): TestPorts {
  return createTestPorts({ storage, tabId });
}

async function draftOf(ports: TestPorts, pieceId: string) {
  const draft = await ports.queries.draft(pieceId);
  assert.ok(draft.ok);
  return draft.value;
}

/** Everything saved in this browser (snapshot and the draft slot autosave writes). */
function savedText(storage: KeyValueStorage): string {
  return `${storage.getItem(SNAPSHOT_KEY) ?? ''}${storage.getItem(DRAFT_SLOT_KEY) ?? ''}`;
}

describe('two tabs on one saved workspace', () => {
  it('reloads what another tab saved and tells the screens', async () => {
    const storage = memoryStorage();
    const a = tab(storage, 'tab-a');
    const b = tab(storage, 'tab-b');
    const notices: ChangeNotice[] = [];
    b.queries.subscribe((notice) => notices.push(notice));

    const created = await a.commands.createFromSource(newProductionInput());
    assert.ok(created.ok);
    assert.equal(b.store.syncExternal(), 'reloaded');
    assert.ok((await b.queries.get(created.value.productionId)).ok, 'the other tab sees the new production');
    assert.equal(notices.at(-1)?.scope, 'external');
    assert.deepEqual(notices.at(-1)?.productionIds, [created.value.productionId]);
    assert.equal(b.store.syncExternal(), 'unchanged', 'nothing new the second time');
    assert.equal(b.store.tabState().status, 'active');
  });

  it('stops the older tab when the same draft is edited in both, and "Usar esta aba" reloads it', async () => {
    const storage = memoryStorage();
    const a = tab(storage, 'tab-a');
    const created = await a.commands.createFromSource(newProductionInput());
    assert.ok(created.ok);
    const b = tab(storage, 'tab-b');
    const pieceId = created.value.pieces[0].pieceId;

    // B writes first, then A (A saw B's write and is still in sync).
    const fromB = await b.commands.saveDraft(pieceId, article('Texto da aba B'), (await draftOf(b, pieceId)).revision);
    assert.ok(fromB.ok && fromB.value.persisted);
    assert.equal(a.store.syncExternal(), 'reloaded');
    a.clock.advance(1000);
    const fromA = await a.commands.saveDraft(pieceId, article('Texto da aba A'), (await draftOf(a, pieceId)).revision);
    assert.ok(fromA.ok && fromA.value.persisted);

    // B was editing that same draft: it stops instead of reloading over its own work.
    assert.equal(b.store.syncExternal(), 'conflict');
    assert.equal(b.store.tabState().status, 'elsewhere');
    const stale = await b.commands.saveDraft(pieceId, article('Mais texto da aba B'), (await draftOf(b, pieceId)).revision);
    assert.ok(stale.ok);
    assert.equal(stale.value.persisted, false, 'a read-only tab writes nothing');
    assert.ok(savedText(storage).includes('Texto da aba A'), "the other tab's text is kept");

    assert.ok(b.store.takeOver());
    assert.equal(b.store.tabState().status, 'active');
    const draft = await draftOf(b, pieceId);
    assert.equal(draft.body.type === 'article' && draft.body.blocks[0].type === 'paragraph' ? draft.body.blocks[0].inlines[0].text : '', 'Texto da aba A');
    const again = await b.commands.saveDraft(pieceId, article('Aba B de novo'), draft.revision);
    assert.ok(again.ok && again.value.persisted, 'after "Usar esta aba" the tab saves again');
  });

  it('never overwrites a write it has not seen yet (write race)', async () => {
    const storage = memoryStorage();
    const a = tab(storage, 'tab-a');
    const b = tab(storage, 'tab-b');
    const first = await a.commands.createFromSource(newProductionInput());
    assert.ok(first.ok);
    // B writes before the storage event of A's write reaches it.
    const second = await b.commands.createFromSource({ ...newProductionInput(), title: 'Produção da aba B' });
    assert.ok(second.ok);
    assert.equal(b.store.tabState().status, 'elsewhere');
    assert.ok(!savedText(storage).includes('Produção da aba B'), 'the saved workspace still has what A wrote');
    assert.ok(savedText(storage).includes(first.value.productionId));
  });
});
