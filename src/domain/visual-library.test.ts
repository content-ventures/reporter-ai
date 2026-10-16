import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bankImages, photoBanks, isCoverResolution, libraryImageSource, imageCreditUrl, publicationImageCredit, libraryImageNote, type LibraryImage } from './visual-library.ts';

test('Pixabay and Openverse are never offered; a bank shows only with its key', () => {
  const providers = (configured: string[]) => ({ providers: (['pixabay','openverse','unsplash','pexels'] as const).map(id => ({ id,label: id,configured: configured.includes(id) })) });
  assert.deepEqual(photoBanks(providers(['pixabay','openverse'])),[]);
  assert.deepEqual(photoBanks(providers(['pixabay','openverse','pexels'])),['pexels']);
  assert.deepEqual(photoBanks(providers(['pexels','unsplash'])),['unsplash','pexels']);
  assert.deepEqual(photoBanks(undefined),[]);
  const saved = (['pixabay','unsplash'] as const).map(provider => ({ id: provider,provider }) as LibraryImage);
  assert.deepEqual(bankImages(saved).map(image => image.provider),['unsplash']);
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
