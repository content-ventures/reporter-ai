import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fakeIndexedDb } from '../adapters/local/assets/fake-indexeddb.ts';
import { createIdGenerator, manualClock, memoryStorage } from '../adapters/local/store/index.ts';
import type { KeyValueStorage, ManualClock } from '../adapters/local/store/index.ts';
import { figureBlock, setCover } from '../domain/article.ts';
import type { ArticleBody } from '../domain/article.ts';
import { pngFile } from '../ports/contracts/assets.contract.ts';
import type { ChangeNotice } from '../ports/common.ts';
import { createRuntime } from './create-runtime.ts';
import type { CreateRuntimeOptions } from './create-runtime.ts';
import type { Runtime } from './runtime.ts';

/**
 * Images through the runtime: stored in IndexedDB next to the localStorage snapshot, cleared with
 * the workspace, refreshing checks and the package, and part of the save status.
 */

const NOW = '2026-10-07T12:00:00.000Z';
const DRAFT = 'prod-estudio-norte';
const APPROVED = 'prod-lume';

let loads = 0;

function instantSleep(clock: ManualClock) {
  return async (ms: number) => {
    clock.advance(Math.max(0, Math.round(ms)));
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
}

function open(options: Partial<CreateRuntimeOptions> = {}): Runtime {
  const clock = manualClock(NOW);
  return createRuntime({
    storage: memoryStorage(),
    ids: createIdGenerator({ salt: `img${(loads += 1)}` }),
    latency: false,
    sleep: instantSleep(clock),
    adoptLiveRuns: false,
    ...options,
    clock,
  });
}

async function articleOf(runtime: Runtime, productionId: string) {
  const found = await runtime.queries.get(productionId);
  assert.ok(found.ok);
  const piece = found.value.pieces.find((entry) => entry.kind === 'article');
  assert.ok(piece);
  return piece;
}

describe('runtime images', () => {
  const realIndexedDb = (globalThis as { indexedDB?: unknown }).indexedDB;
  before(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = fakeIndexedDb();
  });
  after(() => {
    (globalThis as { indexedDB?: unknown }).indexedDB = realIndexedDb;
  });

  it('a cover and a credit refresh the checks; screens hear about it as an `assets` change', async () => {
    const runtime = open();
    await runtime.assets.ready();
    const notices: ChangeNotice[] = [];
    runtime.subscribe((notice) => notices.push(notice));

    const before = await articleOf(runtime, DRAFT);
    assert.equal(before.checks.find((check) => check.id === 'article.cover')?.status, 'info');
    assert.equal(before.checks.find((check) => check.id === 'article.image-credits')?.status, 'na');

    const put = await runtime.assets.put({ type: 'upload', file: pngFile(), fileName: 'capa.png' }, { productionId: DRAFT, authorized: true });
    assert.ok(put.ok);
    assert.ok(notices.some((notice) => notice.scope === 'assets' && notice.productionIds.includes(DRAFT)));

    const draft = await runtime.queries.draft(before.id);
    assert.ok(draft.ok && draft.value.body.type === 'article');
    const body: ArticleBody = setCover(draft.value.body, { assetId: put.value.id, alt: 'Fachada' });
    const saved = await runtime.commands.saveDraft(before.id, body, draft.value.revision);
    assert.ok(saved.ok);

    const covered = await articleOf(runtime, DRAFT);
    assert.equal(covered.checks.find((check) => check.id === 'article.cover')?.status, 'pass');
    const credits = covered.checks.find((check) => check.id === 'article.image-credits');
    assert.equal(credits?.status, 'warn');
    assert.equal(credits?.detail, '1 sem crédito');

    const credited = await runtime.assets.update(put.value.id, { credit: 'Ana Prado' });
    assert.ok(credited.ok);
    const fixed = await articleOf(runtime, DRAFT);
    assert.equal(fixed.checks.find((check) => check.id === 'article.image-credits')?.status, 'pass', 'cached views rebuilt on image changes');
    assert.equal(fixed.readiness.blockers.length, 0, 'images never block approval');
    runtime.dispose();
  });

  it('images survive a reload with the snapshot; `?reset=1` and a workspace without snapshot start without them', async () => {
    const storage: KeyValueStorage = memoryStorage();
    const first = open({ storage });
    const put = await first.assets.put({ type: 'upload', file: pngFile(), fileName: 'capa.png' }, { productionId: DRAFT, authorized: true });
    assert.ok(put.ok);
    const piece = await articleOf(first, DRAFT);
    const draft = await first.queries.draft(piece.id);
    assert.ok(draft.ok && draft.value.body.type === 'article');
    assert.ok((await first.commands.saveDraft(piece.id, setCover(draft.value.body, { assetId: put.value.id }), draft.value.revision)).ok);
    first.dispose();

    const reloaded = open({ storage });
    await reloaded.assets.ready();
    assert.equal(reloaded.simulation?.loadedFrom, 'snapshot');
    assert.deepEqual(reloaded.assets.get(put.value.id), put.value);
    assert.ok(await reloaded.assets.objectUrl(put.value.id));
    reloaded.dispose();

    const reset = open({ storage, reset: true });
    await reset.assets.ready();
    assert.equal(reset.assets.get(put.value.id), undefined, '?reset=1 clears the images too');
    reset.dispose();

    const again = open({ storage });
    const second = await again.assets.put({ type: 'upload', file: pngFile(), fileName: 'b.png' }, { productionId: DRAFT, authorized: true });
    assert.ok(second.ok);
    again.dispose();
    const fresh = open({ storage: memoryStorage() });
    await fresh.assets.ready();
    assert.equal(fresh.assets.get(second.value.id), undefined, 'fixtures without a snapshot start without images');
    fresh.dispose();
  });

  it('an image that cannot be stored turns the save status into an error with retry', async () => {
    const indexedDB = fakeIndexedDb({ quotaBytes: 10 });
    (globalThis as { indexedDB?: unknown }).indexedDB = indexedDB;
    try {
      const runtime = open();
      await runtime.assets.ready();
      const states: string[] = [];
      runtime.saveStatus.subscribe((state) => states.push(state.status));
      const refused = await runtime.assets.put({ type: 'upload', file: pngFile(), fileName: 'capa.png' }, { productionId: DRAFT, authorized: true });
      assert.equal(!refused.ok && refused.refusal.code, 'quota');
      const status = runtime.saveStatus.current();
      assert.equal(status.status, 'error');
      assert.equal(status.error?.code, 'quota');
      assert.equal(runtime.saveStatus.current(), status, 'same snapshot while nothing changes');
      assert.ok(states.includes('error'));
      indexedDB.setQuota(undefined);
      const retried = await runtime.saveStatus.retry();
      assert.ok(retried.ok);
      assert.notEqual(runtime.saveStatus.current().status, 'error');
      runtime.dispose();
    } finally {
      (globalThis as { indexedDB?: unknown }).indexedDB = fakeIndexedDb();
    }
  });

  it('an approved article keeps its images and image checks; the updated carousel knows the article cover', async () => {
    const runtime = open();
    await runtime.assets.ready();
    const put = await runtime.assets.put({ type: 'upload', file: pngFile(1600, 900), fileName: 'capa.png' }, { productionId: APPROVED, authorized: true, credit: 'Ana Prado' });
    const link = await runtime.assets.put({ type: 'url', url: 'https://cdn.exemplo.com/a.jpg' }, { productionId: APPROVED, authorized: true });
    assert.ok(put.ok && link.ok);
    const piece = await articleOf(runtime, APPROVED);
    const draft = await runtime.queries.draft(piece.id);
    assert.ok(draft.ok && draft.value.body.type === 'article');
    const body: ArticleBody = {
      ...setCover(draft.value.body, { assetId: put.value.id, caption: 'Vitrine' }),
      blocks: [...draft.value.body.blocks, figureBlock('fig-teste', { assetId: link.value.id, caption: 'Coleção' })],
    };
    assert.ok((await runtime.commands.saveDraft(piece.id, body, draft.value.revision)).ok);
    const version = await runtime.commands.createVersion(piece.id);
    assert.ok(version.ok, version.ok ? '' : version.refusal.message);
    const ref = version.value.version.ref;
    const review = await runtime.queries.review(piece.id, ref.versionId);
    assert.ok(review.ok);
    const decided = await runtime.commands.decide({ pieceId: piece.id, subject: ref, decision: 'approved', displayedHash: ref.hash });
    assert.ok(decided.ok, decided.ok ? '' : decided.refusal.message);
    assert.ok(decided.value.checks.some((check) => check.id === 'article.image-credits'), 'the decision keeps the image checks');
    assert.deepEqual(
      decided.value.images,
      [
        { assetId: put.value.id, credit: 'Ana Prado', rights: { authorized: true } },
        { assetId: link.value.id, rights: { authorized: true } },
      ],
      'and the credit and rights of its images as approved',
    );

    const compare = await runtime.queries.compare(piece.id, draft.value.latestVersion?.id ?? '', ref.versionId);
    assert.ok(compare.ok);
    assert.ok(compare.value.blocks.some((block) => block.blockType === 'cover' && block.change === 'added'));
    assert.ok(compare.value.blocks.some((block) => block.blockType === 'figure' && block.change === 'added' && block.hunks[0]?.text === '[Imagem] Coleção'));

    const approved = await runtime.queries.version(ref.versionId);
    assert.ok(approved.ok && approved.value.body.type === 'article' && approved.value.body.cover?.assetId === put.value.id);

    // "Atualizar carrossel": the carousel now comes from the version with the cover.
    const rebased = await runtime.commands.derive({ productionId: APPROVED, kind: 'carousel', from: ref, rebase: true });
    assert.ok(rebased.ok, rebased.ok ? '' : rebased.refusal.message);
    const carouselDraft = await runtime.queries.draft(rebased.value.pieceId);
    assert.ok(carouselDraft.ok);
    assert.deepEqual(carouselDraft.value.articleCover, { assetId: put.value.id, caption: 'Vitrine' });
    assert.ok(carouselDraft.value.body.type === 'carousel');
    const rendered = await runtime.render.render({ body: carouselDraft.value.body, articleCover: carouselDraft.value.articleCover?.assetId });
    assert.ok(rendered.ok, 'Node has no canvas: the render still measures');
    const carousel = await runtime.queries.get(APPROVED);
    assert.ok(carousel.ok);
    const coverCheck = carousel.value.pieces.find((entry) => entry.kind === 'carousel')?.checks.find((check) => check.id === 'carousel.cover-image');
    assert.deepEqual([coverCheck?.status, coverCheck?.detail], ['pass', 'Foto: Ana Prado'], '"Imagem da capa" reads the article cover');
    runtime.dispose();
  });

  it('"Liberar espaço": images no draft or version uses are deleted, the rest stay', async () => {
    const runtime = open();
    await runtime.assets.ready();
    const used = await runtime.assets.put({ type: 'upload', file: pngFile(1600, 900, 400), fileName: 'capa.png' }, { productionId: DRAFT, authorized: true });
    const loose = await runtime.assets.put({ type: 'upload', file: pngFile(1600, 900, 900), fileName: 'solta.png' }, { productionId: DRAFT, authorized: true });
    const held = await runtime.assets.put({ type: 'upload', file: pngFile(), fileName: 'na-tela.png' }, { productionId: DRAFT, authorized: true });
    assert.ok(used.ok && loose.ok && held.ok);
    const piece = await articleOf(runtime, DRAFT);
    const draft = await runtime.queries.draft(piece.id);
    assert.ok(draft.ok && draft.value.body.type === 'article');
    assert.ok((await runtime.commands.saveDraft(piece.id, setCover(draft.value.body, { assetId: used.value.id }), draft.value.revision)).ok);
    assert.ok(runtime.usedAssetIds().has(used.value.id));
    const referenced = new Set([...runtime.usedAssetIds(), held.value.id]);
    const unused = runtime.assets.unused(referenced);
    assert.deepEqual(unused.assetIds, [loose.value.id]);
    assert.equal(unused.bytes, loose.value.bytes);
    const freed = await runtime.assets.collect(referenced);
    assert.ok(freed.ok && freed.value.count === 1);
    assert.equal(runtime.assets.get(loose.value.id), undefined);
    assert.ok(runtime.assets.get(used.value.id) && runtime.assets.get(held.value.id), 'what the text uses (saved or on screen) stays');
    runtime.dispose();
  });
});
