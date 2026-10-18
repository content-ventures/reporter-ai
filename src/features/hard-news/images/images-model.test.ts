import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ArchiveImage } from '../../../domain/hard-news.ts';
import { BANK_PHOTOS } from '../preview/image-bank.ts';
import { seedImages } from '../preview/library.ts';
import {
  appliedFilters,
  archiveCopy,
  bankSort,
  blockedReason,
  DEFAULT_IMAGE_PARAMS,
  distribute,
  effectiveSort,
  formatPixels,
  fromArchive,
  fromBank,
  interleave,
  licenseLabel,
  markName,
  matchScore,
  pageCount,
  pageSlice,
  parseImageParams,
  parsePhotoKey,
  photoHref,
  photoKey,
  photosFor,
  photoState,
  pressedSuggestion,
  queryWords,
  resolvePhoto,
  rightsBadge,
  searchPhotos,
  serializeImageParams,
  similarPhotos,
  sizedUrl,
  sourceCounts,
  suggestedSearches,
  tileNote,
} from './images-model.ts';
import type { ImageFilters, Photo, SourceResults, SourceTab } from './images-model.ts';

const archive = seedImages();
const own = archive.map(fromArchive);
const unsplash = BANK_PHOTOS.filter((photo) => photo.provider === 'unsplash').map(fromBank);
const pexels = BANK_PHOTOS.filter((photo) => photo.provider === 'pexels').map(fromBank);

function results(query = '', filters: ImageFilters = {}): SourceResults {
  return {
    own: searchPhotos(own, query, filters, effectiveSort(undefined, query)),
    unsplash: searchPhotos(unsplash, query, filters, bankSort(query)),
    pexels: searchPhotos(pexels, query, filters, bankSort(query)),
  };
}

function archived(patch: Partial<ArchiveImage>): Photo {
  return fromArchive({ id: 'img-x', src: '/x.jpg', width: 1200, height: 800, caption: 'Foto', credit: 'Ana/Portal', license: 'own', tags: [], uses: 0, ...patch });
}

describe('R2 · image bank model (F2.9)', () => {
  test('a photo key names its source and survives the page address', () => {
    assert.equal(photoKey('pexels', '123'), 'pexels:123');
    assert.deepEqual(parsePhotoKey('own:img-processing'), { source: 'own', id: 'img-processing' });
    assert.deepEqual(parsePhotoKey('unsplash:_BVh-uNZTaQ'), { source: 'unsplash', id: '_BVh-uNZTaQ' });
    assert.equal(parsePhotoKey('pixabay:1'), undefined);
    assert.equal(parsePhotoKey('own:'), undefined);
    assert.equal(parsePhotoKey('img-x'), undefined);
    assert.equal(photoHref('own:img-x', 'q=tilápia'), '/images/own%3Aimg-x?q=tilápia');
  });

  test('bank photos resize through the CDN width; local files stay as they are', () => {
    assert.match(sizedUrl('https://images.pexels.com/photos/1/p.jpeg?auto=compress&cs=tinysrgb&w=2000', 800), /[?&]w=800(&|$)/);
    assert.match(sizedUrl('https://images.unsplash.com/photo-1?ixlib=rb-4.1.0&w=2000&q=80', 800), /[?&]w=800&/);
    assert.equal(sizedUrl('/samples/seafood-processing-sample.jpg', 800), '/samples/seafood-processing-sample.jpg');
  });

  test('the preview bank and archive are consistent', () => {
    const keys = BANK_PHOTOS.map((photo) => photoKey(photo.provider, photo.providerId));
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(unsplash.length, 20);
    assert.equal(pexels.length, 16);
    for (const image of archive) {
      if (!image.origin) continue;
      assert.ok(keys.includes(photoKey(image.origin.provider, image.origin.providerId)), image.id);
      assert.equal(image.license === 'pending' || image.credit === '' || image.credit.endsWith(image.origin.provider === 'unsplash' ? '/Unsplash' : '/Pexels'), true);
    }
    const states = own.map(photoState);
    assert.ok(states.includes('pending'));
    assert.ok(states.includes('uncredited'));
    assert.ok(archive.some((image) => image.id === 'img-processing' && image.license === 'own'));
  });

  test('saving a bank photo keeps its credit, license and origin', () => {
    const photo = BANK_PHOTOS[0]!;
    const copy = archiveCopy(photo, 'img-new');
    assert.equal(copy.license, 'stock');
    assert.equal(copy.credit, `${photo.creator}/Unsplash`);
    assert.equal(copy.caption, photo.title);
    assert.deepEqual(copy.origin, { provider: 'unsplash', providerId: photo.providerId, sourceUrl: photo.sourceUrl, licenseUrl: 'https://unsplash.com/license', creator: photo.creator, creatorUrl: photo.creatorUrl });
    assert.equal(photoState(fromArchive(copy)), 'ready');
  });

  test('a page address resolves to the archive photo once a bank photo is saved', () => {
    assert.equal(resolvePhoto('own:img-processing', archive, BANK_PHOTOS)?.source, 'own');
    assert.equal(resolvePhoto('unsplash:rqhV0R0RcB8', archive, BANK_PHOTOS)?.source, 'unsplash');
    const saved = resolvePhoto('pexels:31636077', archive, BANK_PHOTOS);
    assert.equal(saved?.key, 'own:img-tilapia-cesto');
    assert.equal(resolvePhoto('own:missing', archive, BANK_PHOTOS), undefined);
    assert.equal(resolvePhoto('unsplash:missing', archive, BANK_PHOTOS), undefined);
  });

  test('rights decide the badge, the tile note and the blocked reason (REQ-2.9)', () => {
    const ready = archived({ license: 'stock' });
    const pending = archived({ license: 'pending' });
    const uncredited = archived({ credit: '  ' });
    const bank = unsplash[0]!;
    assert.deepEqual([photoState(ready), photoState(pending), photoState(uncredited), photoState(bank)], ['ready', 'pending', 'uncredited', 'bank']);
    assert.deepEqual(rightsBadge(ready), { label: 'Banco de imagens', tone: 'green' });
    assert.deepEqual(rightsBadge(pending), { label: 'Direitos a confirmar', tone: 'amber' });
    assert.deepEqual(rightsBadge(uncredited), { label: 'Sem crédito', tone: 'red' });
    assert.deepEqual(rightsBadge(bank), { label: 'Licença Unsplash', tone: 'gray' });
    assert.equal(tileNote(ready), undefined);
    assert.equal(tileNote(bank), undefined);
    assert.deepEqual(tileNote(pending), { tone: 'amber', note: 'Direitos a confirmar' });
    assert.deepEqual(tileNote(uncredited), { tone: 'red', note: 'Sem crédito' });
    assert.equal(licenseLabel(bank), 'Licença Unsplash');
    assert.equal(licenseLabel(pending), 'Direitos a confirmar');
    assert.equal(licenseLabel(own.find((photo) => photo.id === 'img-tilapia-cesto')!), 'Licença Pexels');
    assert.equal(licenseLabel(own.find((photo) => photo.id === 'img-processing')!), 'Própria');
    assert.equal(markName(bank), 'Unsplash');
    assert.equal(markName(own.find((photo) => photo.id === 'img-tilapia-cesto')!), 'Pexels');
    assert.equal(markName(ready), 'Portal do Pescado');
    assert.equal(blockedReason('ready'), undefined);
    assert.equal(blockedReason('pending'), 'Confirme os direitos para usar.');
    assert.equal(blockedReason('uncredited'), 'Informe o crédito para usar.');
  });

  test('search ignores accents and case, and every word must match', () => {
    const tilapia = archived({ caption: 'Tilápias no cesto', tags: ['tilápia', 'pescado'] });
    assert.ok(matchScore(tilapia, queryWords('TILAPIA')) > 0);
    assert.ok(matchScore(tilapia, queryWords('tilapia pescado')) > 0);
    assert.equal(matchScore(tilapia, queryWords('tilapia salmao')), 0);
    assert.equal(matchScore(tilapia, queryWords('lapia')), 0, 'a word matches from its start');
    assert.ok(matchScore(tilapia, queryWords('ana')) > 0, 'the credit counts');
    assert.ok(matchScore(tilapia, queryWords('tilápia')) > matchScore(archived({ caption: 'Tilápia' }), queryWords('tilápia')), 'a theme weighs more');
    assert.deepEqual(searchPhotos(own, 'camarao', {}, 'relevance').map((photo) => photo.id), ['img-camarao-belem']);
  });

  test('filters: orientation, color, cover size and rights; banks count as ready', () => {
    const all = [...own, ...unsplash, ...pexels];
    assert.ok(searchPhotos(all, '', { orientation: 'portrait' }, 'recent').every((photo) => photo.height > photo.width));
    assert.ok(searchPhotos(all, '', { orientation: 'square' }, 'recent').every((photo) => Math.abs(photo.width / photo.height - 1) <= 0.05));
    assert.ok(searchPhotos(all, '', { color: 'azul' }, 'recent').every((photo) => photo.color === 'azul'));
    assert.ok(searchPhotos(all, '', { cover: true }, 'recent').every((photo) => photo.width >= 2400 && photo.width > photo.height));
    assert.deepEqual(searchPhotos(all, '', { rights: 'pending' }, 'recent').map((photo) => photo.id), ['img-salmao-tanques']);
    assert.deepEqual(searchPhotos(all, '', { rights: 'uncredited' }, 'recent').map((photo) => photo.id), ['img-salmao-peixaria']);
    assert.equal(searchPhotos(unsplash, '', { rights: 'ready' }, 'recent').length, unsplash.length);
  });

  test('order: relevance while searching, most recent otherwise; "Mais usadas" by uses', () => {
    assert.equal(effectiveSort(undefined, ''), 'recent');
    assert.equal(effectiveSort(undefined, 'tilápia'), 'relevance');
    assert.equal(effectiveSort('used', 'tilápia'), 'used');
    assert.deepEqual(searchPhotos(own, '', {}, 'recent').map((photo) => photo.id), archive.map((image) => image.id));
    const used = searchPhotos(own, '', {}, 'used').map((photo) => photo.uses);
    assert.deepEqual(used, [...used].sort((a, b) => b - a));
  });

  test('"Todas" lists the archive first, then the banks alternating, each photo once', () => {
    assert.deepEqual(interleave<number | string>([1, 2, 3], ['a']), [1, 'a', 2, 3]);
    const landing = results();
    const all = photosFor('all', landing, archive);
    assert.deepEqual(all.slice(0, own.length).map((photo) => photo.source), own.map(() => 'own'));
    assert.equal(all[own.length]?.source, 'unsplash');
    assert.equal(all[own.length + 1]?.source, 'pexels');
    const keys = all.map((photo) => photo.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(!keys.includes('pexels:31636077'), 'the saved tilápia shows as the archive photo');
    assert.equal(all.length, own.length + BANK_PHOTOS.length - archive.filter((image) => image.origin).length);
    const pexelsTab = photosFor('pexels', landing, archive);
    assert.equal(pexelsTab.length, pexels.length);
    assert.equal(pexelsTab.find((photo) => photo.id === 'img-tilapia-cesto')?.source, 'own');
    const counts = sourceCounts(landing, archive);
    assert.deepEqual(counts, { all: all.length, own: own.length, unsplash: 20, pexels: 16 } satisfies Record<SourceTab, number>);
  });

  test('suggested searches: frequent themes, then the search and what comes with it', () => {
    const landing = results();
    const pool = photosFor('all', landing, archive);
    const top = suggestedSearches(pool, pool, '', 8);
    assert.equal(top.length, 8);
    assert.equal(top[0]?.label, `${top[0]?.value.charAt(0).toUpperCase()}${top[0]?.value.slice(1)}`);
    assert.ok(top.every((item, index) => item.count > 0 && item.count <= (top[index - 1]?.count ?? Infinity)), 'the themes that find the most come first');
    const shrimp = photosFor('all', results('camarão'), archive);
    const related = suggestedSearches(pool, shrimp, 'camarão', 6);
    assert.equal(related[0]?.value, 'camarão');
    assert.equal(pressedSuggestion(related, 'Camarao'), 'camarão');
    assert.equal(related[0]?.count, shrimp.length);
    assert.equal(pressedSuggestion(top, 'gaivotas e barcos'), null);
  });

  test('the mosaic puts each photo once in the shortest column, the same every time', () => {
    const items = [
      { id: 'a', width: 3, height: 2 },
      { id: 'b', width: 2, height: 3 },
      { id: 'c', width: 1, height: 1 },
      { id: 'd', width: 16, height: 9 },
      { id: 'e', width: 3, height: 2 },
      { id: 'f', width: 3, height: 4 },
    ];
    const columns = distribute(items, 4);
    assert.deepEqual(columns.map((column) => column.map((item) => item.id)), [['a', 'f'], ['b'], ['c'], ['d', 'e']]);
    assert.deepEqual(distribute(items, 4), columns);
    assert.equal(distribute(items, 2).flat().length, items.length);
    const pool = photosFor('all', results(), archive);
    const heights = distribute(pool, 4).map((column) => column.reduce((sum, photo) => sum + photo.height / photo.width, 0));
    assert.ok(Math.max(...heights) - Math.min(...heights) < 1.6, 'columns end close to each other');
  });

  test('pages of the results', () => {
    const items = Array.from({ length: 45 }, (_, index) => index);
    assert.equal(pageCount(45, 40), 2);
    assert.equal(pageCount(0, 40), 1);
    assert.deepEqual(pageSlice(items, 2, 40), [40, 41, 42, 43, 44]);
    assert.deepEqual(pageSlice(items, 9, 40), [40, 41, 42, 43, 44]);
  });

  test('similar photos share themes and never repeat the photo or its bank copy', () => {
    const pool = photosFor('all', results(), archive);
    const tilapia = own.find((photo) => photo.id === 'img-tilapia-cesto')!;
    const similar = similarPhotos(tilapia, [...pool, ...pexels], 12);
    assert.ok(similar.length > 0 && similar.length <= 12);
    assert.ok(!similar.some((photo) => photo.key === tilapia.key || photo.key === 'pexels:31636077'));
    assert.ok(similar.every((photo) => photo.tags.length > 0));
  });

  test('the address keeps the bank state without defaults', () => {
    assert.equal(serializeImageParams(DEFAULT_IMAGE_PARAMS), '');
    const params = { q: 'tilápia', source: 'own', filters: { orientation: 'portrait', color: 'azul', cover: true, rights: 'pending' }, sort: 'used', view: 'grid', page: 2 } as const;
    const search = serializeImageParams(params);
    assert.equal(search, 'q=til%C3%A1pia&fonte=acervo&orientacao=vertical&cor=azul&tamanho=capa&direitos=a-confirmar&ordem=usadas&vista=grade&pagina=2');
    assert.deepEqual(parseImageParams(new URLSearchParams(search)), params);
    assert.deepEqual(parseImageParams(new URLSearchParams('fonte=pixabay&cor=roxo&pagina=-3&ordem=x&vista=lista')), DEFAULT_IMAGE_PARAMS);
  });

  test('applied filters read as chips and dimensions as pixels', () => {
    assert.deepEqual(appliedFilters({ orientation: 'landscape', cover: true }), [
      { id: 'orientation', label: 'Orientação', value: 'Horizontal' },
      { id: 'cover', label: 'Tamanho', value: 'Para capa' },
    ]);
    assert.equal(formatPixels({ width: 6000, height: 4000 }), '6.000 × 4.000 px');
  });
});
