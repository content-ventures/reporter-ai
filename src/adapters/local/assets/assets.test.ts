import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { assetStoreContract, pngFile } from '../../../ports/contracts/assets.contract.ts';
import { manualClock, sequentialIds } from '../store/system.ts';
import { createAssetStore } from './asset-store.ts';
import type { AssetStoreOptions } from './asset-store.ts';
import { memoryBackend } from './backend.ts';
import type { AssetBackend } from './backend.ts';
import { fakeIndexedDb } from './fake-indexeddb.ts';
import { sniffImage } from './image-sniff.ts';
import { createIndexedDbAssetStore, createMemoryAssetStore } from './index.ts';
import { ASSET_DB_NAME } from './indexeddb.ts';
import { sha256Hex, sha256Sync } from './sha256.ts';

const START = '2026-10-07T12:00:00.000Z';

function options(reset = false): Omit<AssetStoreOptions, 'backend'> {
  return { clock: manualClock(START), ids: sequentialIds(), workspaceId: 'ws-teste', actorId: () => 'p-joao', reset };
}

assetStoreContract('memory asset store', () => {
  const backend = memoryBackend();
  const store = createAssetStore({ ...options(), backend });
  return {
    store,
    reopen: (reopen) => createAssetStore({ ...options(reopen?.reset), backend }),
    setQuota: (bytes) => backend.setQuota(bytes),
    dispose: () => store.dispose(),
  };
});

assetStoreContract('IndexedDB asset store', () => {
  const indexedDB = fakeIndexedDb();
  const store = createIndexedDbAssetStore({ ...options(), indexedDB });
  return {
    store,
    reopen: (reopen) => createIndexedDbAssetStore({ ...options(reopen?.reset), indexedDB }),
    setQuota: (bytes) => indexedDB.setQuota(bytes),
    dispose: () => store.dispose(),
  };
});

describe('IndexedDB asset store', () => {
  it('writes the record and its bytes to `reporter-sim-assets` in one transaction', async () => {
    const indexedDB = fakeIndexedDb();
    const store = createIndexedDbAssetStore({ ...options(), indexedDB });
    const put = await store.put({ type: 'upload', file: pngFile(), fileName: 'a.png' }, { productionId: 'prod-1', authorized: true });
    assert.ok(put.ok);
    const dump = indexedDB.dump(ASSET_DB_NAME);
    assert.equal(dump?.assets.length, 1);
    assert.equal(dump?.blobs.length, 1);
    assert.deepEqual(dump?.assets[0], { id: put.value.id, productionId: 'prod-1', asset: put.value });
    assert.equal(store.scope, 'local');
    store.dispose();
  });

  it('when the browser blocks storage, images live in this tab and the save status says so', async () => {
    const store = createIndexedDbAssetStore({ ...options(), indexedDB: fakeIndexedDb({ blocked: true }) });
    await store.ready();
    assert.equal(store.health().status, 'ok', 'no error before an image is used');
    const put = await store.put({ type: 'upload', file: pngFile(), fileName: 'a.png' }, { productionId: 'prod-1', authorized: true });
    assert.ok(put.ok, 'the image still works in this tab');
    assert.equal(store.scope, 'memory');
    const health = store.health();
    assert.equal(health.status === 'error' && health.code, 'unavailable');
    assert.ok(await store.objectUrl(put.value.id));
    store.dispose();
  });
});

describe('asset store persistence errors', () => {
  /** A backend whose metadata writes fail while `failing` is set. */
  function flaky(): AssetBackend & { failing: boolean } {
    const inner = memoryBackend();
    const backend = {
      ...inner,
      failing: false,
      async write(record: Parameters<AssetBackend['write']>[0], blob?: Blob) {
        if (backend.failing) {
          const error = new Error('Quota');
          error.name = 'QuotaExceededError';
          throw error;
        }
        return inner.write(record, blob);
      },
    };
    return backend;
  }

  it('a credit change that cannot be saved stays in this tab, shows the error and is written on retry', async () => {
    const backend = flaky();
    const store = createAssetStore({ ...options(), backend });
    const put = await store.put({ type: 'upload', file: pngFile(), fileName: 'a.png' }, { productionId: 'prod-1', authorized: true });
    assert.ok(put.ok);
    const healthChanges: string[] = [];
    store.subscribe((change) => {
      if (change.kind === 'health') healthChanges.push(store.health().status);
    });
    backend.failing = true;
    const updated = await store.update(put.value.id, { credit: 'Ana Prado' });
    assert.ok(updated.ok, 'the change applies in this tab');
    assert.equal(store.get(put.value.id)?.credit, 'Ana Prado');
    assert.equal(store.health().status, 'error');
    assert.equal((await store.retry()).status, 'error', 'still failing');
    backend.failing = false;
    assert.equal((await store.retry()).status, 'ok');
    const reopened = createAssetStore({ ...options(), backend });
    await reopened.ready();
    assert.equal(reopened.get(put.value.id)?.credit, 'Ana Prado', 'written on retry');
    assert.deepEqual(healthChanges, ['error', 'ok']);
  });

  it('dispose revokes the object URLs it created', async () => {
    const revoked: string[] = [];
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
      original.call(URL, url);
    };
    try {
      const store = createMemoryAssetStore(options());
      const put = await store.put({ type: 'upload', file: pngFile(), fileName: 'a.png' }, { productionId: 'prod-1', authorized: true });
      assert.ok(put.ok);
      const url = await store.objectUrl(put.value.id);
      assert.ok(url?.startsWith('blob:'));
      store.dispose();
      assert.deepEqual(revoked, [url]);
    } finally {
      URL.revokeObjectURL = original;
    }
  });

  it('reads the size from the header and decodes (createImageBitmap) only when the header lacks it', async () => {
    let decoded = 0;
    const store = createMemoryAssetStore({
      ...options(),
      measure: async () => {
        decoded += 1;
        return { width: 4000, height: 3000 };
      },
    });
    const fromHeader = await store.put({ type: 'upload', file: pngFile(1200, 800), fileName: 'a.png' }, { productionId: 'prod-1', authorized: true });
    assert.ok(fromHeader.ok);
    assert.deepEqual([fromHeader.value.width, fromHeader.value.height], [1200, 800]);
    assert.equal(decoded, 0, 'never decoded');
    // A JPEG whose frame header is past the bytes read: the size comes from decoding.
    const noFrame = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xd9])], { type: 'image/jpeg' });
    const decodedPut = await store.put({ type: 'upload', file: noFrame, fileName: 'b.jpg' }, { productionId: 'prod-1', authorized: true });
    assert.ok(decodedPut.ok);
    assert.deepEqual([decodedPut.value.width, decodedPut.value.height], [4000, 3000]);
    assert.equal(decoded, 1);
  });

  it('stores a mislabelled image with the type read from its bytes', async () => {
    const store = createMemoryAssetStore(options());
    const file = new Blob([await pngFile().arrayBuffer()], { type: 'image/jpeg' });
    const put = await store.put({ type: 'upload', file, fileName: 'foto.jpg' }, { productionId: 'prod-1', authorized: true });
    assert.ok(put.ok);
    assert.equal(put.value.mime, 'image/png');
    assert.equal((await store.blob(put.value.id))?.type, 'image/png');
  });
});

describe('image sniffing', () => {
  it('reads type and size of JPEG, GIF and WebP headers', () => {
    // JPEG: SOI, APP0 (16 bytes), SOF0 with 600×400.
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x58, 0x03]);
    assert.deepEqual(sniffImage(jpeg), { mime: 'image/jpeg', width: 600, height: 400 });
    const gif = new Uint8Array([...'GIF89a'].map((char) => char.charCodeAt(0)).concat([0x40, 0x01, 0xf0, 0x00]));
    assert.deepEqual(sniffImage(gif), { mime: 'image/gif', width: 320, height: 240 });
    const webp = new Uint8Array(30);
    webp.set([...'RIFF'].map((char) => char.charCodeAt(0)), 0);
    webp.set([...'WEBPVP8X'].map((char) => char.charCodeAt(0)), 8);
    webp.set([0x7f, 0x07, 0x00, 0x37, 0x04, 0x00], 24);
    assert.deepEqual(sniffImage(webp), { mime: 'image/webp', width: 1920, height: 1080 });
    assert.equal(sniffImage(new TextEncoder().encode('não é imagem')), undefined);
  });

  it('turns the size of a JPEG whose EXIF orientation turns it a quarter (portrait phone photos)', () => {
    // APP1 "Exif\0\0", TIFF little endian, IFD0 with one entry: Orientation (0x0112) = 6.
    const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    const exif = [...'Exif'].map((char) => char.charCodeAt(0)).concat([0, 0], tiff);
    const app1 = [0xff, 0xe1, 0x00, exif.length + 2, ...exif];
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xb8, 0x0f, 0xa0, 0x03];
    const rotated = new Uint8Array([0xff, 0xd8, ...app1, ...sof]);
    assert.deepEqual(sniffImage(rotated), { mime: 'image/jpeg', width: 3000, height: 4000 });
    const upright = new Uint8Array([0xff, 0xd8, ...sof]);
    assert.deepEqual(sniffImage(upright), { mime: 'image/jpeg', width: 4000, height: 3000 });
  });
});

describe('sha256', () => {
  it('matches node:crypto for the pure version and for Web Crypto', async () => {
    for (const size of [0, 3, 55, 56, 64, 1000, 70_000]) {
      const bytes = new Uint8Array(size).map((_, index) => (index * 31 + 7) & 0xff);
      const expected = createHash('sha256').update(bytes).digest('hex');
      assert.equal(sha256Sync(bytes), expected, `pure, ${size} bytes`);
      assert.equal(await sha256Hex(bytes), expected, `web crypto, ${size} bytes`);
    }
    assert.equal(sha256Sync(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('seeded images (the example workspace)', () => {
  const seeded = {
    productionId: 'prod-exemplo',
    src: '/samples/exemplo.jpg',
    asset: {
      id: 'img-exemplo',
      workspaceId: 'ws-teste',
      kind: 'image' as const,
      origin: { type: 'upload' as const, fileName: 'exemplo.jpg' },
      mime: 'image/jpeg',
      width: 1200,
      height: 800,
      bytes: 4,
      credit: 'Divulgação',
      rights: { authorized: true },
      createdAt: START,
      createdBy: 'p-joao',
    },
  };

  it('lists them at once, serves them from the app and reads their bytes only when asked', async () => {
    const reads: string[] = [];
    const backend = memoryBackend();
    const store = createAssetStore({
      ...options(),
      backend,
      seed: [seeded],
      fetchSeed: async (src) => {
        reads.push(src);
        return new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
      },
    });
    assert.equal(store.get('img-exemplo')?.credit, 'Divulgação', 'readable before the stored index opens');
    await store.ready();
    assert.deepEqual(store.list('prod-exemplo').map((asset) => asset.id), ['img-exemplo']);
    assert.equal(await store.objectUrl('img-exemplo'), '/samples/exemplo.jpg');
    assert.deepEqual(reads, []);
    assert.equal((await store.blob('img-exemplo'))?.size, 4);
    await store.blob('img-exemplo');
    assert.deepEqual(reads, ['/samples/exemplo.jpg'], 'read once');
    assert.equal(backend.records().size, 0, 'never stored');
    assert.equal(store.unused(new Set()).count, 0, '"Liberar espaço" never lists them');
    await store.reset();
    assert.ok(store.get('img-exemplo'), 'the example comes back with "Restaurar exemplo"');
    store.dispose();
  });

  it('a credit changed in this browser wins over the example on reload', async () => {
    const backend = memoryBackend();
    const first = createAssetStore({ ...options(), backend, seed: [seeded], fetchSeed: async () => undefined });
    const updated = await first.update('img-exemplo', { credit: 'Ana Prado' });
    assert.ok(updated.ok);
    first.dispose();
    const again = createAssetStore({ ...options(), backend, seed: [seeded], fetchSeed: async () => undefined });
    await again.ready();
    assert.equal(again.get('img-exemplo')?.credit, 'Ana Prado');
    assert.equal(await again.blob('img-exemplo'), undefined, 'bytes it cannot read are missing, never invented');
    again.dispose();
  });
});
