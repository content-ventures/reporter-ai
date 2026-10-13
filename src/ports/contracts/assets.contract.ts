import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AssetChange, AssetStore } from '../assets.ts';

/**
 * AssetStore contract (article images): what the picker, the checks, the review and the package
 * rely on. The memory and IndexedDB adapters pass it now; a server-backed store (signed upload,
 * CDN URLs) must pass it unchanged.
 */

export type AssetsUnderTest = {
  store: AssetStore;
  /** A new store over the same persisted data (a page reload); `reset` = `?reset=1`. */
  reopen?(options?: { reset?: boolean }): AssetStore;
  /** Limits stored bytes, to exercise the "cota cheia" path; `undefined` lifts the limit. */
  setQuota?(bytes: number | undefined): void;
  dispose?(): void | Promise<void>;
};

export type AssetsFactory = () => AssetsUnderTest | Promise<AssetsUnderTest>;

const PRODUCTION = 'prod-contrato';
const OTHER = 'prod-outra';

/** A PNG header with its size (IHDR) followed by `extra` bytes: enough for type and dimensions. */
export function pngBytes(width: number, height: number, extra = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

export function pngFile(width = 1600, height = 900, extra = 64): Blob {
  return new Blob([pngBytes(width, height, extra)], { type: 'image/png' });
}

async function using(make: AssetsFactory, test: (sut: AssetsUnderTest) => Promise<void>): Promise<void> {
  const sut = await make();
  try {
    await sut.store.ready();
    await test(sut);
  } finally {
    await sut.dispose?.();
  }
}

function code(result: { ok: boolean; refusal?: { code: string } }): string | undefined {
  return result.ok ? undefined : result.refusal?.code;
}

export function assetStoreContract(name: string, make: AssetsFactory): void {
  describe(`${name} · asset store contract`, () => {
    it('stores an uploaded image with origin, type, size, credit and rights, and serves it', () =>
      using(make, async ({ store }) => {
        const changes: AssetChange[] = [];
        const off = store.subscribe((change) => changes.push(change));
        const file = pngFile(1600, 900);
        const put = await store.put({ type: 'upload', file, fileName: 'fachada.png' }, { productionId: PRODUCTION, authorized: true, credit: '  Ana   Prado ', note: 'Uso no site' });
        assert.ok(put.ok, put.ok ? '' : put.refusal.message);
        const asset = put.value;
        assert.equal(asset.kind, 'image');
        assert.deepEqual(asset.origin, { type: 'upload', fileName: 'fachada.png' });
        assert.equal(asset.mime, 'image/png');
        assert.equal(asset.bytes, file.size);
        assert.deepEqual([asset.width, asset.height], [1600, 900]);
        assert.equal(asset.credit, 'Ana Prado');
        assert.deepEqual(asset.rights, { authorized: true, note: 'Uso no site' });
        assert.ok(asset.createdAt && asset.createdBy && asset.workspaceId);
        assert.deepEqual(store.get(asset.id), asset);
        assert.deepEqual(store.list(PRODUCTION).map((entry) => entry.id), [asset.id]);
        assert.deepEqual(store.list(OTHER), []);
        const url = await store.objectUrl(asset.id);
        assert.ok(url, 'an object URL to show the image');
        assert.equal(await store.objectUrl(asset.id), url, 'one URL per asset');
        const blob = await store.blob(asset.id);
        assert.equal(blob?.size, file.size);
        assert.deepEqual(new Uint8Array(await (blob as Blob).arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
        assert.ok(changes.some((change) => change.kind === 'put' && change.assetIds.includes(asset.id) && change.productionIds.includes(PRODUCTION)));
        off();
      }));

    it('refuses empty, oversized, unsupported and disguised files with a pt-BR reason', () =>
      using(make, async ({ store }) => {
        const meta = { productionId: PRODUCTION, authorized: true };
        const cases: [Blob, string, string][] = [
          [new Blob([]), 'vazia.png', 'empty'],
          [new Blob([new Uint8Array(store.limits.maxBytes + 1)], { type: 'image/png' }), 'enorme.png', 'too_large'],
          [new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'logo.svg', 'unsupported_type'],
          [new Blob(['não sou imagem'], { type: 'image/png' }), 'texto.png', 'unsupported_type'],
        ];
        for (const [file, fileName, expected] of cases) {
          const result = await store.put({ type: 'upload', file, fileName }, meta);
          assert.equal(code(result), expected, fileName);
          assert.ok(!result.ok && result.refusal.message.length > 0);
        }
        assert.deepEqual(store.list(PRODUCTION), [], 'nothing stored after a refusal');
        assert.equal(store.health().status, 'ok', 'a refused file is not a storage problem');
      }));

    it('keeps linked images as links: http/https only, no bytes, the address as URL', () =>
      using(make, async ({ store }) => {
        const put = await store.put({ type: 'url', url: 'https://cdn.exemplo.com/colecao.webp' }, { productionId: PRODUCTION, authorized: false });
        assert.ok(put.ok);
        assert.deepEqual(put.value.origin, { type: 'url', url: 'https://cdn.exemplo.com/colecao.webp' });
        assert.equal(put.value.rights.authorized, false);
        assert.equal(await store.objectUrl(put.value.id), 'https://cdn.exemplo.com/colecao.webp');
        assert.equal(await store.blob(put.value.id), undefined);
        assert.equal(code(await store.put({ type: 'url', url: 'javascript:alert(1)' }, { productionId: PRODUCTION, authorized: true })), 'invalid_url');
        assert.equal(code(await store.put({ type: 'url', url: '' }, { productionId: PRODUCTION, authorized: true })), 'empty');
        const measured = await store.put({ type: 'url', url: 'https://cdn.exemplo.com/retrato.jpg', width: 900, height: 1600 }, { productionId: PRODUCTION, authorized: true });
        assert.ok(measured.ok);
        assert.deepEqual([measured.value.width, measured.value.height], [900, 1600], 'the size measured by the preview is kept');
      }));

    it('lists and deletes the images no draft or version uses ("Liberar espaço")', () =>
      using(make, async (sut) => {
        const { store } = sut;
        const kept = await store.put({ type: 'upload', file: pngFile(), fileName: 'usada.png' }, { productionId: PRODUCTION, authorized: true });
        const dropped = await store.put({ type: 'upload', file: pngFile(1600, 900, 500), fileName: 'solta.png' }, { productionId: PRODUCTION, authorized: true });
        const link = await store.put({ type: 'url', url: 'https://exemplo.com/solta.jpg' }, { productionId: OTHER, authorized: true });
        assert.ok(kept.ok && dropped.ok && link.ok);
        const referenced = new Set([kept.value.id]);
        const unused = store.unused(referenced);
        assert.deepEqual(unused.assetIds.sort(), [dropped.value.id, link.value.id].sort());
        assert.equal(unused.count, 2);
        assert.equal(unused.bytes, dropped.value.bytes, 'a link holds no bytes here');
        const changes: AssetChange[] = [];
        store.subscribe((change) => changes.push(change));
        const collected = await store.collect(referenced);
        assert.ok(collected.ok);
        assert.equal(collected.value.count, 2);
        assert.equal(store.get(dropped.value.id), undefined);
        assert.equal(await store.blob(dropped.value.id), undefined);
        assert.ok(store.get(kept.value.id), 'a used image stays');
        assert.ok(await store.blob(kept.value.id));
        assert.ok(changes.some((change) => change.kind === 'collect' && change.productionIds.includes(PRODUCTION) && change.productionIds.includes(OTHER)));
        assert.equal(store.unused(referenced).count, 0);
        if (sut.reopen) {
          const again = sut.reopen();
          await again.ready();
          assert.equal(again.get(dropped.value.id), undefined, 'deleted from storage too');
          assert.ok(again.get(kept.value.id));
          again.dispose();
        }
      }));

    it('updates credit and rights only, notifying the production', () =>
      using(make, async ({ store }) => {
        const put = await store.put({ type: 'upload', file: pngFile(), fileName: 'a.png' }, { productionId: PRODUCTION, authorized: false });
        assert.ok(put.ok);
        const changes: AssetChange[] = [];
        store.subscribe((change) => changes.push(change));
        const updated = await store.update(put.value.id, { credit: 'Bia Lins', rights: { authorized: true } });
        assert.ok(updated.ok);
        assert.equal(updated.value.credit, 'Bia Lins');
        assert.deepEqual(updated.value.rights, { authorized: true });
        assert.equal(updated.value.bytes, put.value.bytes);
        assert.deepEqual(store.get(put.value.id), updated.value);
        assert.ok(changes.some((change) => change.kind === 'update' && change.productionIds.includes(PRODUCTION)));
        const cleared = await store.update(put.value.id, { credit: '  ' });
        assert.ok(cleared.ok && cleared.value.credit === undefined, 'a blank credit removes it');
        assert.equal(code(await store.update('img-nada', { credit: 'x' })), 'not_found');
      }));

    it('lists the images of a production newest first', () =>
      using(make, async ({ store }) => {
        const first = await store.put({ type: 'upload', file: pngFile(), fileName: 'um.png' }, { productionId: PRODUCTION, authorized: true });
        const other = await store.put({ type: 'upload', file: pngFile(), fileName: 'outra.png' }, { productionId: OTHER, authorized: true });
        const second = await store.put({ type: 'url', url: 'https://exemplo.com/dois.jpg' }, { productionId: PRODUCTION, authorized: true });
        assert.ok(first.ok && other.ok && second.ok);
        assert.deepEqual(store.list(PRODUCTION).map((asset) => asset.id).sort(), [first.value.id, second.value.id].sort());
        assert.deepEqual(store.list(OTHER).map((asset) => asset.id), [other.value.id]);
      }));

    it('reset drops every image', () =>
      using(make, async ({ store }) => {
        const put = await store.put({ type: 'upload', file: pngFile(), fileName: 'a.png' }, { productionId: PRODUCTION, authorized: true });
        assert.ok(put.ok);
        await store.reset();
        assert.equal(store.get(put.value.id), undefined);
        assert.deepEqual(store.list(PRODUCTION), []);
        assert.equal(await store.objectUrl(put.value.id), undefined);
        assert.equal(await store.blob(put.value.id), undefined);
      }));

    it('keeps images across a reload, and `?reset=1` starts without them', () =>
      using(make, async (sut) => {
        if (!sut.reopen) return;
        const put = await sut.store.put({ type: 'upload', file: pngFile(800, 450), fileName: 'a.png' }, { productionId: PRODUCTION, authorized: true, credit: 'Ana' });
        assert.ok(put.ok);
        const again = sut.reopen();
        await again.ready();
        assert.deepEqual(again.get(put.value.id), put.value);
        assert.equal((await again.blob(put.value.id))?.size, put.value.bytes);
        again.dispose();
        const fresh = sut.reopen({ reset: true });
        await fresh.ready();
        assert.equal(fresh.get(put.value.id), undefined);
        fresh.dispose();
      }));

    it('a full storage refuses the upload with `quota` and turns the save status into an error, never silently', () =>
      using(make, async (sut) => {
        if (!sut.setQuota) return;
        sut.setQuota(10);
        const refused = await sut.store.put({ type: 'upload', file: pngFile(), fileName: 'a.png' }, { productionId: PRODUCTION, authorized: true });
        assert.equal(code(refused), 'quota');
        assert.equal(sut.store.list(PRODUCTION).length, 0);
        const health = sut.store.health();
        assert.equal(health.status === 'error' && health.code, 'quota');
        sut.setQuota(undefined);
        assert.equal((await sut.store.retry()).status, 'ok', 'retry clears the error once space is back');
        const stored = await sut.store.put({ type: 'upload', file: pngFile(), fileName: 'a.png' }, { productionId: PRODUCTION, authorized: true });
        assert.ok(stored.ok);
      }));
  });
}
