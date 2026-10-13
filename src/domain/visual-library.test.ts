import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_STOCK_PROVIDER, SEAFOOD_SEARCHES, isCoverResolution, libraryImageSource, imageCreditUrl, publicationImageCredit, libraryImageNote, type LibraryImage } from './visual-library.ts';

test('the default photo search is the cover provider, never a silent no-key documentary fallback', () => {
  assert.equal(DEFAULT_STOCK_PROVIDER,'pixabay');
  assert.equal(SEAFOOD_SEARCHES[0].query,'seafood');
  assert.ok(SEAFOOD_SEARCHES.some(item => item.query === 'aquaculture'));
});
test('unchanged Unsplash photos stay on their CDN, while legacy sources retain local file URLs', () => {
  const image = { id: 'local-image',provider: 'unsplash',imageUrl: 'https://images.unsplash.com/photo-test?ixid=app&w=3840',previewUrl: 'https://images.unsplash.com/photo-test?ixid=app&w=1080' } as LibraryImage;
  assert.equal(libraryImageSource(image),image.imageUrl);assert.equal(libraryImageSource(image,true),image.previewUrl);
  assert.equal(libraryImageSource({ ...image,provider: 'openverse' }),'/api/reporter/visuals/images/local-image/file');
  assert.equal(libraryImageSource({ ...image,provider: 'pixabay' },true),'/api/reporter/visuals/images/local-image/file');
});
test('Pixabay publication credit is optional but internal provenance is preserved', () => {
  const image = { provider: 'pixabay',attribution: 'Contributor / Pixabay',sourceUrl: 'https://pixabay.com/photos/fish-1/',licenseUrl: 'https://pixabay.com/service/license-summary/' } as LibraryImage;
  assert.equal(publicationImageCredit(image),'');assert.match(libraryImageNote(image),/Contributor \/ Pixabay/);
  assert.equal(publicationImageCredit({ ...image,provider: 'openverse' }),'Contributor / Pixabay');
});
test('photographer links accept only safe Unsplash profiles', () => {
  const href = 'https://unsplash.com/@author?utm_source=reporter_ai&utm_medium=referral';
  assert.equal(imageCreditUrl(href),href);
  for (const value of [undefined,'javascript:alert(1)','https://unsplash.com.evil.test/@author','http://unsplash.com/@author','https://user:pass@unsplash.com/@author','https://unsplash.com/photos/id']) assert.equal(imageCreditUrl(value),undefined);
});
test('landscape covers have a minimum genuine width and height, not just a high pixel count', () => {
  assert.equal(isCoverResolution({ width: 2400,height: 1350 }),true);
  assert.equal(isCoverResolution({ width: 6000,height: 4000 }),true);
  for (const [width,height] of [[2399,1350],[2400,1349],[12000,900],[4000,6000],[3000,3000]]) {
    assert.equal(isCoverResolution({ width,height }),false);
  }
});
