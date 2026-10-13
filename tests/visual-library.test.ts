import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLibraryPhoto } from '../src/server/visual-library.ts';
import sharp from 'sharp';
import { commonsPreview, normalizeOpenverse, normalizePexels, normalizeUnsplash, normalizePixabay, searchStock, stockDetails, stockProviders, downloadStock, trackStockSelection } from '../src/server/stock-images.ts';
import { bannerSvg, escapeXml, renderBanner, wrapBannerText } from '../src/server/banner-render.ts';
import { BANNER_FORMATS, bannerContentKey, initialBanner } from '../src/domain/visual-library.ts';

test('composition equality survives PostgreSQL JSONB property reordering without hiding changes', () => {
  const content = { ...initialBanner(),title: 'Pescado brasileiro' };
  const reordered = Object.fromEntries(Object.entries(content).reverse()) as typeof content;
  assert.equal(bannerContentKey(content),bannerContentKey(reordered));
  assert.notEqual(bannerContentKey(content),bannerContentKey({ ...reordered,title: 'Outra pauta' }));
});

const photo = { id: '804574f3-ff41-405b-87c3-ade2ef0221db',title: 'Synthetic fish market',creator: 'Test photographer',
  foreign_landing_url: 'https://commons.wikimedia.org/w/index.php?curid=1',url: 'https://upload.wikimedia.org/wikipedia/commons/6/6d/test.jpg',
  thumbnail: 'https://api.openverse.org/v1/images/804574f3-ff41-405b-87c3-ade2ef0221db/thumb/',license: 'by',license_version: '4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',source: 'wikimedia',mature: false,width: 1280,height: 960,filetype: 'jpg' };
test('commercially editable source retains author, licence and canonical origin', () => {
  const image = normalizeOpenverse(photo);
  assert.equal(image.previewUrl,'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6d/test.jpg/500px-test.jpg');
  assert.equal(image.license,'CC BY 4.0');assert.match(image.attribution,/Test photographer/);assert.equal(image.sourceUrl,photo.foreign_landing_url);
  for (const patch of [{ license: 'by-nc' },{ license: 'by-nd' },{ license: 'by-sa' },{ creator: '' },{ mature: true },
    { url: 'https://localhost/secret' },{ url: 'http://upload.wikimedia.org/x' },{ url: 'https://upload.wikimedia.org.evil.test/x' },
    { url: 'https://user:password@upload.wikimedia.org/x' },{ filetype: 'svg' },{ width: null }]) assert.throws(() => normalizeOpenverse({ ...photo,...patch }));
});
test('Commons previews use the supported size and current fixed host without fetching originals', () => {
  assert.equal(commonsPreview('https://upload.wikimedia.org/wikipedia/commons/6/6d/Fish%2C_market.jpg'),'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6d/Fish%2C_market.jpg/500px-Fish%2C_market.jpg');
  for (const url of ['https://localhost/secret','https://upload.wikimedia.org/private.jpg','https://upload.wikimedia.org/wikipedia/commons/6/6d/test.svg','https://upload.wikimedia.org/wikipedia/commons/6/6d/test.jpg?redirect=secret']) assert.throws(() => commonsPreview(url));
});
test('Pexels metadata keeps API attribution and restricts media and landing hosts', () => {
  const value = { id: 15,width: 4000,height: 2500,url: 'https://www.pexels.com/photo/test-15/',photographer: 'Test',alt: 'Fish',src: { original: 'https://images.pexels.com/photos/15/test.jpeg',large: 'https://images.pexels.com/photos/15/test-preview.jpeg?w=940',large2x: 'https://images.pexels.com/photos/15/test-small.jpeg?w=1880' } };
  assert.equal(normalizePexels(value).attribution,'Test / Pexels');
  assert.equal(normalizePexels(value).imageUrl,value.src.original,'import must retain the original, not the 1880px derivative');
  assert.equal(normalizePexels(value).previewUrl,value.src.large);
  for (const field of ['original','large']) assert.throws(() => normalizePexels({ ...value,src: { ...value.src,[field]: 'https://127.0.0.1/image' } }));
});
test('cover search sends documented resolution/orientation filters and preserves relevance order', async () => {
  const previous = process.env.PEXELS_API_KEY;process.env.PEXELS_API_KEY = 'synthetic-test-key';
  let calls = 0;
  const makePhoto = (id: number,width: number,height: number) => ({ id,width,height,url: `https://www.pexels.com/photo/test-${id}/`,photographer: 'Test',alt: 'Fish',
    src: { original: `https://images.pexels.com/photos/${id}/test.jpeg`,large: `https://images.pexels.com/photos/${id}/test.jpeg?w=940` } });
  try {
    const fetcher: typeof fetch = async (url,options) => {
      calls++;const request = new URL(String(url));
      assert.equal(request.origin,'https://api.pexels.com');assert.equal(request.pathname,'/v1/search');
      assert.equal(request.searchParams.get('orientation'),'landscape');assert.equal(request.searchParams.get('size'),'small');
      assert.equal(request.searchParams.get('per_page'),'24');assert.equal(options?.redirect,'error');
      return Response.json({ photos: [makePhoto(10,1880,1300),makePhoto(11,4000,2500),makePhoto(12,2500,4000),makePhoto(13,2400,1000),
        makePhoto(14,3000,2000),makePhoto(15,3000,3000)],next_page: 'https://api.pexels.com/v1/search?page=2' });
    };
    const result = await searchStock('pexels','synthetic cover search',1,fetcher);
    assert.deepEqual(result.images.map(image => image.providerId),['11','14']);assert.equal(result.hasMore,true);
    assert.deepEqual(await searchStock('pexels','synthetic cover search',1,fetcher),result);assert.equal(calls,1,'identical search is cached');
  } finally { if (previous === undefined) delete process.env.PEXELS_API_KEY;else process.env.PEXELS_API_KEY = previous; }
});
test('missing Pexels key fails before networking; credentials never appear in provider projection', async () => {
  const previous = process.env.PEXELS_API_KEY;delete process.env.PEXELS_API_KEY;
  try {
    const providers = stockProviders();assert.equal(providers.find(item => item.id === 'pexels')?.configured,false);assert.equal(providers.find(item => item.id === 'openverse')?.configured,true);
    await assert.rejects(stockDetails('pexels','15',async () => { throw new Error('must not fetch'); }),/PEXELS_KEY_MISSING/);
    await assert.rejects(stockDetails('openverse','../private'),/INVALID_INPUT/);
    process.env.PEXELS_API_KEY = 'synthetic-test-key';
    assert.equal(JSON.stringify(stockProviders()).includes('synthetic-test-key'),false);
  } finally { if (previous === undefined) delete process.env.PEXELS_API_KEY;else process.env.PEXELS_API_KEY = previous; }
});
const unsplashPhoto = { id: 'LBI7cgq3pbM',width: 5000,height: 3000,description: 'Ocean',alt_description: 'Fishing boat at sea',
  urls: { raw: 'https://images.unsplash.com/photo-test?ixid=synthetic-app&ixlib=rb-4.1.0' },
  links: { html: 'https://unsplash.com/photos/LBI7cgq3pbM',download_location: 'https://api.unsplash.com/photos/LBI7cgq3pbM/download?ixid=synthetic-app' },
  user: { name: 'Test Photographer',links: { html: 'https://unsplash.com/@testphotographer' } } };
test('Unsplash normalization preserves the view identifier, canonical profile, source and licence', () => {
  const image = normalizeUnsplash(unsplashPhoto),url = new URL(image.imageUrl);
  assert.equal(image.provider,'unsplash');assert.equal(image.attribution,'Test Photographer / Unsplash');
  assert.equal(url.hostname,'images.unsplash.com');assert.equal(url.searchParams.get('ixid'),'synthetic-app');assert.equal(url.searchParams.get('w'),'3840');
  assert.equal(new URL(image.previewUrl).searchParams.get('w'),'1080');
  assert.equal(image.creatorUrl,'https://unsplash.com/@testphotographer?utm_source=reporter_ai&utm_medium=referral');
  assert.equal(new URL(image.sourceUrl).searchParams.get('utm_source'),'reporter_ai');
  for (const patch of [{ premium: true },{ plus: true },{ user: { ...unsplashPhoto.user,name: '' } },
    { urls: { raw: 'https://images.unsplash.com/photo-test' } },{ urls: { raw: 'https://images.unsplash.com/premium_photo-test?ixid=app' } },
    { urls: { raw: 'https://localhost/image?ixid=app' } },{ links: { ...unsplashPhoto.links,download_location: 'https://api.unsplash.com/users/private' } }]) assert.throws(() => normalizeUnsplash({ ...unsplashPhoto,...patch }));
});
test('Unsplash cover search is authenticated server-side, filtered, cached, and never tracks browsing as selection', async () => {
  const previous = process.env.UNSPLASH_ACCESS_KEY;process.env.UNSPLASH_ACCESS_KEY = 'synthetic-unsplash-key';
  let calls = 0;
  try {
    const fetcher: typeof fetch = async (url,options) => {
      calls++;const request = new URL(String(url));assert.equal(request.origin,'https://api.unsplash.com');assert.equal(request.pathname,'/search/photos');
      assert.equal(request.searchParams.get('orientation'),'landscape');assert.equal(request.searchParams.get('content_filter'),'high');
      assert.equal(request.searchParams.get('order_by'),'relevant');assert.equal(request.searchParams.get('per_page'),'24');
      assert.equal(new Headers(options?.headers).get('authorization'),'Client-ID synthetic-unsplash-key');assert.equal(new Headers(options?.headers).get('accept-version'),'v1');
      assert.equal(request.href.includes('synthetic-unsplash-key'),false);
      return Response.json({ results: [{ ...unsplashPhoto,width: 1880,height: 1080 },unsplashPhoto,{ ...unsplashPhoto,width: 3000,height: 5000 }],total_pages: 2 });
    };
    const result = await searchStock('unsplash','synthetic unsplash cover',1,fetcher);
    assert.equal(result.images.length,1);assert.equal(result.hasMore,true);
    assert.equal(JSON.stringify(result).includes('synthetic-unsplash-key'),false);
    await searchStock('unsplash','synthetic unsplash cover',1,fetcher);assert.equal(calls,1);
    delete process.env.UNSPLASH_ACCESS_KEY;
    await assert.rejects(searchStock('unsplash','synthetic unsplash cover',1,fetcher),/UNSPLASH_KEY_MISSING/);
  } finally { if (previous === undefined) delete process.env.UNSPLASH_ACCESS_KEY;else process.env.UNSPLASH_ACCESS_KEY = previous; }
});
test('Unsplash selections and reuses report the returned download endpoint, never an arbitrary host or a media URL', async () => {
  const previous = process.env.UNSPLASH_ACCESS_KEY;process.env.UNSPLASH_ACCESS_KEY = 'synthetic-unsplash-key';
  const image = normalizeUnsplash(unsplashPhoto);let calls = 0;
  try {
    const fetcher: typeof fetch = async (url,options) => {
      calls++;assert.equal(String(url),unsplashPhoto.links.download_location);assert.equal(options?.redirect,'error');
      assert.equal(new Headers(options?.headers).get('authorization'),'Client-ID synthetic-unsplash-key');
      return Response.json({ url: 'https://images.unsplash.com/photo-test' });
    };
    await trackStockSelection(image,fetcher);await trackStockSelection(image,fetcher);assert.equal(calls,2);
    await trackStockSelection(normalizeOpenverse(photo),fetcher);assert.equal(calls,2);
    for (const downloadUrl of ['https://localhost/private','https://api.unsplash.com/users/private','https://user:pass@api.unsplash.com/photos/LBI7cgq3pbM/download','https://api.unsplash.com/photos/LBI7cgq3pbM/download?client_id=unexpected']) await assert.rejects(trackStockSelection({ ...image,downloadUrl },fetcher),/STOCK_INVALID/);
    assert.equal(calls,2);
  } finally { if (previous === undefined) delete process.env.UNSPLASH_ACCESS_KEY;else process.env.UNSPLASH_ACCESS_KEY = previous; }
});
test('missing Unsplash access key and malformed IDs fail before networking', async () => {
  const previous = process.env.UNSPLASH_ACCESS_KEY;delete process.env.UNSPLASH_ACCESS_KEY;
  const fetcher: typeof fetch = async () => { throw new Error('must not fetch'); };
  try {
    assert.equal(stockProviders().find(item => item.id === 'unsplash')?.configured,false);
    await assert.rejects(stockDetails('unsplash',unsplashPhoto.id,fetcher),/UNSPLASH_KEY_MISSING/);
    await assert.rejects(stockDetails('unsplash','../private',fetcher),/INVALID_INPUT/);
    await assert.rejects(trackStockSelection(normalizeUnsplash(unsplashPhoto),fetcher),/UNSPLASH_KEY_MISSING/);
  } finally { if (previous === undefined) delete process.env.UNSPLASH_ACCESS_KEY;else process.env.UNSPLASH_ACCESS_KEY = previous; }
});
const pixabayPhoto = { id: 195893,type: 'photo',tags: 'fish, seafood, salmon',pageURL: 'https://pixabay.com/photos/fish-seafood-salmon-195893/',
  webformatURL: 'https://pixabay.com/get/synthetic_640.jpg',largeImageURL: 'https://pixabay.com/get/synthetic_1280.jpg',
  imageURL: 'https://pixabay.com/get/synthetic-original.jpg',imageWidth: 4000,imageHeight: 2500,user: 'SyntheticContributor',user_id: 48777 };
test('Pixabay preserves source and licence and distinguishes an original from a limited API preview', () => {
  const image = normalizePixabay(pixabayPhoto);assert.equal(image.provider,'pixabay');assert.equal(image.imageUrl,pixabayPhoto.imageURL);
  assert.equal(image.previewUrl,pixabayPhoto.webformatURL);assert.equal(image.width,4000);assert.equal(image.downloadLimited,undefined);
  const limited = normalizePixabay({ ...pixabayPhoto,imageURL: undefined });assert.equal(limited.downloadLimited,true);assert.equal(limited.imageUrl,pixabayPhoto.largeImageURL);
  assert.equal(limited.width,4000,'the original dimensions do not describe the reduced download');
  for (const patch of [{ type: 'vector' },{ type: 'illustration' },{ id: -1 },{ imageWidth: 0 },{ pageURL: 'https://pixabay.com/photos/fish-99/' },
    { pageURL: 'https://istockphoto.com/paid-image' },{ imageURL: 'https://localhost/private' },{ imageURL: 'https://pixabay.com/api/?key=secret' },
    { imageURL: 'https://pixabay.com/get/original.jpg?key=secret' },{ webformatURL: 'https://user:pass@cdn.pixabay.com/photo/image.jpg' }]) assert.throws(() => normalizePixabay({ ...pixabayPhoto,...patch }));
});
test('Pixabay search selects photographic high-resolution originals and caches without leaking credentials', async () => {
  const previous = process.env.PIXABAY_API_KEY;process.env.PIXABAY_API_KEY = 'synthetic-pixabay-key';let calls = 0;
  try {
    const fetcher: typeof fetch = async (value,options) => {
      calls++;const url = new URL(String(value));assert.equal(url.origin,'https://pixabay.com');assert.equal(url.pathname,'/api/');
      assert.equal(url.searchParams.get('key'),'synthetic-pixabay-key');assert.equal(options?.redirect,'error');
      for (const [key,value] of Object.entries({ image_type: 'photo',orientation: 'horizontal',min_width: '2400',min_height: '1350',editors_choice: 'true',order: 'popular',safesearch: 'true',per_page: '24' })) assert.equal(url.searchParams.get(key),value);
      return Response.json({ hits: [pixabayPhoto,{ ...pixabayPhoto,id: 99,type: 'vector' },{ ...pixabayPhoto,imageWidth: 1200 },{ ...pixabayPhoto,imageWidth: 2500,imageHeight: 4000 }],totalHits: 30 });
    };
    const result = await searchStock('pixabay','synthetic seafood search',1,fetcher);
    assert.equal(result.images.length,1);assert.equal(result.hasMore,true);assert.equal(JSON.stringify(result).includes('synthetic-pixabay-key'),false);
    assert.deepEqual(await searchStock('pixabay','synthetic seafood search',1,fetcher),result);assert.equal(calls,1);
    delete process.env.PIXABAY_API_KEY;await assert.rejects(searchStock('pixabay','synthetic seafood search',1,fetcher),/PIXABAY_KEY_MISSING/);
  } finally { if (previous === undefined) delete process.env.PIXABAY_API_KEY;else process.env.PIXABAY_API_KEY = previous; }
});
test('Pixabay curation has a separate cache and the last accessible page stops at 500 results', async context => {
  const previous = process.env.PIXABAY_API_KEY;process.env.PIXABAY_API_KEY = 'synthetic-pixabay-curation';
  let now = Date.now()+2000,calls = 0;context.mock.method(Date,'now',() => now);
  try {
    const fetcher: typeof fetch = async value => { calls++;const url = new URL(String(value));return Response.json({ hits: [pixabayPhoto],totalHits: url.searchParams.get('editors_choice') === 'true' ? 24 : 500 }); };
    const curated = await searchStock('pixabay','synthetic curation',1,fetcher,true);assert.equal(curated.hasMore,false);
    now += 1200;const expanded = await searchStock('pixabay','synthetic curation',1,fetcher,false);assert.equal(expanded.hasMore,true);assert.equal(calls,2);
    now += 1200;const last = await searchStock('pixabay','synthetic curation',21,fetcher,false);assert.equal(last.hasMore,false);
    now += 24*3600000+1;await searchStock('pixabay','synthetic curation',1,fetcher,false);assert.equal(calls,4,'expired search and request caches are refreshed');
  } finally { context.mock.restoreAll();if (previous === undefined) delete process.env.PIXABAY_API_KEY;else process.env.PIXABAY_API_KEY = previous; }
});
test('Pixabay details are cached for a day, validate the exact requested ID and never track a download for browsing', async () => {
  const previous = process.env.PIXABAY_API_KEY;process.env.PIXABAY_API_KEY = 'synthetic-pixabay-details';let calls = 0;
  try {
    const fetcher: typeof fetch = async (value) => { calls++;const url = new URL(String(value));assert.equal(url.pathname,'/api/');assert.equal(url.searchParams.get('id'),String(pixabayPhoto.id));return Response.json({ hits: [pixabayPhoto] }); };
    const image = await stockDetails('pixabay',String(pixabayPhoto.id),fetcher);await stockDetails('pixabay',String(pixabayPhoto.id),fetcher);assert.equal(calls,1);
    await trackStockSelection(image,async () => { throw new Error('Pixabay has no Unsplash tracking call'); });
    await assert.rejects(stockDetails('pixabay','999999',async () => Response.json({ hits: [pixabayPhoto] })),/STOCK_INVALID/);
  } finally { if (previous === undefined) delete process.env.PIXABAY_API_KEY;else process.env.PIXABAY_API_KEY = previous; }
});
test('Pixabay refuses missing keys, unsafe IDs and low-resolution downloads before networking', async () => {
  const previous = process.env.PIXABAY_API_KEY;delete process.env.PIXABAY_API_KEY;
  const fetcher: typeof fetch = async () => { throw new Error('must not fetch'); };
  try {
    assert.equal(stockProviders()[0].id,'pixabay');assert.equal(stockProviders()[0].configured,false);
    await assert.rejects(stockDetails('pixabay',String(pixabayPhoto.id),fetcher),/PIXABAY_KEY_MISSING/);
    await assert.rejects(stockDetails('pixabay','../private',fetcher),/INVALID_INPUT/);
    await assert.rejects(downloadStock(normalizePixabay({ ...pixabayPhoto,imageURL: undefined }),fetcher),/PIXABAY_ORIGINAL_REQUIRED/);
    await assert.rejects(downloadStock(normalizePixabay({ ...pixabayPhoto,imageWidth: 1280 }),fetcher),/PIXABAY_ORIGINAL_REQUIRED/);
  } finally { if (previous === undefined) delete process.env.PIXABAY_API_KEY;else process.env.PIXABAY_API_KEY = previous; }
});
test('Pixabay media requests never carry the API key and provider errors never reflect its URL', async () => {
  const image = normalizePixabay(pixabayPhoto);
  await downloadStock(image,async (value,options) => { assert.equal(String(value),pixabayPhoto.imageURL);assert.equal(options?.headers,undefined);return new Response('synthetic photo',{ headers: { 'content-type': 'image/jpeg' } }); });
  const previous = process.env.PIXABAY_API_KEY;process.env.PIXABAY_API_KEY = 'synthetic-secret';
  try { await assert.rejects(stockDetails('pixabay','88888',async value => { throw new Error(String(value)); }),error => error instanceof Error && error.message === 'STOCK_UNAVAILABLE' && !error.message.includes('synthetic-secret')); }
  finally { if (previous === undefined) delete process.env.PIXABAY_API_KEY;else process.env.PIXABAY_API_KEY = previous; }
});
test('Pixabay imports check real decoded pixels and never enlarge a reduced original', async () => {
  const image = normalizePixabay(pixabayPhoto);
  const photo = async (width: number,height: number) => sharp({ create: { width,height,channels: 3,background: '#555555' } }).jpeg().toBuffer();
  await assert.rejects(normalizeLibraryPhoto(image,await photo(1280,720)),/PIXABAY_ORIGINAL_REQUIRED/);
  const normalized = await normalizeLibraryPhoto(image,await photo(2400,1350));assert.equal(normalized.width,2400);assert.equal(normalized.height,1350);
  await assert.rejects(normalizeLibraryPhoto(image,Buffer.from('not an image')),/STOCK_INVALID/);
});
test('image imports refuse redirects, oversized bytes and HTML pretending to be a photograph', async () => {
  const image = normalizeOpenverse(photo);
  await assert.rejects(downloadStock(image,async (_url,options) => {
    assert.equal(options?.redirect,'error');return new Response('redirect',{ status: 302,headers: { location: 'http://localhost' } });
  }),/STOCK_INVALID/);
  await assert.rejects(downloadStock(image,async () => new Response('HTML',{ headers: { 'content-type': 'text/html' } })),/STOCK_INVALID/);
  await assert.rejects(downloadStock(image,async () => new Response('image',{ headers: { 'content-type': 'image/jpeg','content-length': String(11*1024**2) } })),/IMAGE_TOO_LARGE/);
  await assert.rejects(downloadStock(image,async () => new Response(new Uint8Array(10*1024**2+1),{ headers: { 'content-type': 'image/jpeg' } })),/IMAGE_TOO_LARGE/);
});
test('banner renderer emits real PNG at every declared size and escapes editorial input', async () => {
  for (const format of Object.keys(BANNER_FORMATS) as (keyof typeof BANNER_FORMATS)[]) {
    const content = { ...initialBanner(),template: 'editorial' as const,format,title: 'Pescado brasileiro em pauta',description: 'Qualidade e oportunidades no varejo.' };
    const output = await renderBanner(content),metadata = await sharp(output.png).metadata();
    assert.equal(metadata.width,BANNER_FORMATS[format].width);assert.equal(metadata.height,BANNER_FORMATS[format].height);
    assert.equal(metadata.format,'png');assert.match(output.svg,/Pescado brasileiro/);
  }
  assert.equal(escapeXml('<script>&"\''),'&lt;script&gt;&amp;&quot;&apos;');
  assert.doesNotMatch(bannerSvg({ ...initialBanner(),template: 'editorial',title: '<script> test </script>' }),/<script>/);
});
test('photographic and quote layouts require their input; nothing silently truncates copy', async () => {
  assert.throws(() => bannerSvg({ ...initialBanner(),title: 'Test' }),/BANNER_IMAGE_REQUIRED/);
  assert.throws(() => bannerSvg({ ...initialBanner(),template: 'quote',title: 'Test' }),/BANNER_QUOTE_REQUIRED/);
  assert.throws(() => wrapBannerText('W'.repeat(100),100,40),/BANNER_TEXT_OVERFLOW/);
  assert.throws(() => bannerSvg({ ...initialBanner(),template: 'editorial',title: 'Test',brand: 'W'.repeat(40) }),/BANNER_TEXT_OVERFLOW/);
  assert.throws(() => bannerSvg({ ...initialBanner(),template: 'editorial',title: 'Test',kicker: 'W'.repeat(50) }),/BANNER_TEXT_OVERFLOW/);
  const bytes = await sharp({ create: { width: 100,height: 100,channels: 3,background: '#555555' } }).jpeg().toBuffer();
  const output = await renderBanner({ ...initialBanner(),title: 'Mercado de pescado' },{ bytes,attribution: 'Test / CC0' });
  assert.match(output.svg,/data:image\/jpeg;base64,/);assert.match(output.svg,/Test \/ CC0/);
  assert.doesNotMatch(output.svg,/href="https?:/);
  const quote = bannerSvg({ ...initialBanner(),template: 'quote',title: 'Test',quote: 'Uma citação literal.',quoteCredit: 'Participante confirmado' });
  assert.match(quote,/Uma citação literal/);assert.match(quote,/Participante confirmado/);
  assert.doesNotMatch(quote,/>“<\/text>/,'decorative quotation mark must not overlap the brand header');
});
test('Pixabay banner exports have no compulsory visible credit while retaining internal source metadata', async () => {
  const bytes = await sharp({ create: { width: 100,height: 100,channels: 3,background: '#555555' } }).jpeg().toBuffer();
  const output = await renderBanner({ ...initialBanner(),title: 'Pescado brasileiro' },{ bytes,attribution: 'Contributor / Pixabay',creditRequired: false,
    sourceUrl: pixabayPhoto.pageURL,licenseUrl: 'https://pixabay.com/service/license-summary/' });
  assert.doesNotMatch(output.svg,/<text[^>]*>[^<]*(?:Contributor|Pixabay|recorte editorial)/);
  assert.match(output.svg,/<metadata>.*Contributor \/ Pixabay/);assert.match(output.svg,/license-summary/);
});
