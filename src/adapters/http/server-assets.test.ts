import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withServerAssets } from './server-assets.ts';
import { createMemoryAssetStore } from '../local/assets/index.ts';
import type { ServerImageAsset } from '../../ports/connected-workspace.ts';
test('server photos resolve in a fresh browser without a prior IndexedDB record and emit asset changes', async () => {
  const local = createMemoryAssetStore({ clock: { now: () => '2026-10-13T12:00:00Z' },ids: { next: () => 'local' },workspaceId: 'workspace',actorId: () => 'editor' });
  let entries: ServerImageAsset[] = [];
  const assets = withServerAssets(local,() => entries),changes: string[] = [];
  assets.subscribe(change => changes.push(change.kind));await assets.ready();
  entries = [{ productionId: 'production',asset: { id: 'server-photo',kind: 'image',workspaceId: 'workspace',origin: { type: 'archive',archiveId: 'library' },rights: { authorized: true },createdAt: '2026-10-13T12:00:00Z',createdBy: 'editor',
    provenance: { libraryId: 'library',provider: 'pixabay',providerId: '1',title: 'Synthetic photo metadata',creator: 'Test',sourceUrl: 'https://example.com/photo',imageUrl: 'https://example.com/photo.jpg',previewUrl: 'https://example.com/preview.jpg',width: 3000,height: 2000,license: 'Pixabay Content License',licenseUrl: 'https://pixabay.com/service/license-summary/',attribution: 'Test / Pixabay' } } }];
  assets.adoptSnapshot();
  assert.equal(assets.get('server-photo')?.rights.authorized,true);assert.equal(assets.list('production').length,1);
  assert.equal(await assets.objectUrl('server-photo'),'/api/reporter/visuals/images/library/file');
  assert.ok(changes.includes('loaded'));
  assets.dispose();
});
