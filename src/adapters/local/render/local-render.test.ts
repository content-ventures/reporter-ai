import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CarouselBody } from '../../../domain/carousel.ts';
import { PROVISIONAL_TEMPLATES, TEMPLATE_RENDERS } from '../../../fixtures/templates/provisional.ts';
import { pngFile } from '../../../ports/contracts/assets.contract.ts';
import { createMemoryAssetStore } from '../assets/index.ts';
import { manualClock, sequentialIds } from '../store/system.ts';
import { coverFit } from './canvas.ts';
import type { Canvas2D, CoverImage, SurfaceFactory } from './canvas.ts';
import { assetCoverLoader, COVER_REASONS } from './cover-image.ts';
import { base64, dataUrl, utf8 } from './encoding.ts';
import { createLocalRenderService } from './local-render.ts';
import { displayText } from './slide-layout.ts';
import { ellipsize, estimateText, wrapLines } from './text-metrics.ts';

const TEMPLATE = PROVISIONAL_TEMPLATES[0];

function body(slots: Partial<Record<string, Record<string, string>>> = {}): CarouselBody {
  return {
    type: 'carousel',
    templateId: TEMPLATE.id,
    slides: [
      { id: 's1', layout: 'cover', slots: slots.cover ?? { kicker: 'Entrevista', title: 'Da garagem a onze países' }, sourceBlockIds: [] },
      { id: 's2', layout: 'quote', slots: slots.quote ?? { quote: 'A feira mudou tudo.', attribution: 'Marina Lopes' }, sourceBlockIds: [] },
      { id: 's3', layout: 'closing', slots: slots.closing ?? { title: 'O próximo passo', cta: 'Leia a matéria completa' }, sourceBlockIds: [] },
    ],
  };
}

type Call = { op: string; args: unknown[]; font?: string; fill?: unknown };

/** Recording canvas: measures with the estimator, returns a tiny PNG signature. */
function fakeSurfaces(calls: Call[], sizes: [number, number][] = []): SurfaceFactory {
  return (width, height) => {
    sizes.push([width, height]);
    const context: Canvas2D = {
      fillStyle: '',
      font: '',
      textAlign: 'left',
      textBaseline: 'top',
      fillRect(...args) {
        calls.push({ op: 'fillRect', args, fill: this.fillStyle });
      },
      fillText(...args) {
        calls.push({ op: 'fillText', args, font: this.font, fill: this.fillStyle });
      },
      measureText(text) {
        const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 16);
        const weight = Number(/(\d{3}) /.exec(this.font)?.[1] ?? 400);
        return { width: estimateText(text, { size, weight }) };
      },
    };
    return { context, toPng: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) };
  };
}

describe('text metrics', () => {
  it('estimates wider text for heavier weights and wraps greedily', () => {
    const regular = estimateText('Da garagem a onze países', { size: 40, weight: 400 });
    assert.ok(estimateText('Da garagem a onze países', { size: 40, weight: 700 }) > regular);
    const lines = wrapLines('um dois três quatro cinco seis', 100, (text) => text.length * 10);
    assert.ok(lines.every((line) => line.length * 10 <= 100));
    assert.equal(lines.join(' '), 'um dois três quatro cinco seis');
    assert.deepEqual(wrapLines('abcdefghij', 40, (text) => text.length * 10), ['abcd', 'efgh', 'ij']);
    assert.equal(ellipsize('uma linha comprida', 80, (text) => text.length * 10), 'uma lin…');
  });

  it('decorates quotes and attributions, never the stored text', () => {
    const quote = TEMPLATE.layouts.find((layout) => layout.id === 'quote')?.slots ?? [];
    assert.equal(displayText(quote[0], 'A feira mudou tudo.'), '“A feira mudou tudo.”');
    assert.equal(displayText(quote[1], 'Marina Lopes'), '— Marina Lopes');
  });
});

describe('local render service', () => {
  it('plugs the fixtures template data as is and lists templates as provisional', () => {
    const service = createLocalRenderService({ templates: PROVISIONAL_TEMPLATES, renders: TEMPLATE_RENDERS, createSurface: () => undefined });
    const templates = service.templates();
    assert.equal(templates.length, PROVISIONAL_TEMPLATES.length);
    assert.ok(templates.every((template) => template.provisional && template.description.length > 0));
  });

  it('reports the approximate fit per slot, with the overflow message the studio shows', () => {
    const service = createLocalRenderService({ templates: PROVISIONAL_TEMPLATES, renders: TEMPLATE_RENDERS, createSurface: () => undefined });
    const long = 'Da garagem com duas máquinas usadas à fábrica que exporta para onze países sem perder o ofício nem a paciência';
    const fits = service.measure(body({ cover: { title: long } }));
    assert.ok(fits.ok);
    const title = fits.value.find((fit) => fit.slideId === 's1' && fit.slotId === 'title');
    assert.ok(title && title.approximate && title.overflow);
    assert.equal(title.message, `≈ Título excede ${title.maxLines} linhas`);
    assert.ok(fits.value.filter((fit) => fit.slideId !== 's1').every((fit) => !fit.overflow));
    const unknown = service.measure({ ...body(), templateId: 'nao-existe' });
    assert.equal(!unknown.ok && unknown.refusal.code, 'unknown_template');
  });

  it('without a canvas it still measures and says why there is no image', async () => {
    const service = createLocalRenderService({ templates: PROVISIONAL_TEMPLATES, renders: TEMPLATE_RENDERS, createSurface: () => undefined });
    assert.deepEqual(service.capabilities().raster, false);
    const rendered = await service.render({ body: body() });
    assert.ok(rendered.ok);
    assert.equal(rendered.value.slides.length, 3);
    assert.ok(rendered.value.slides.every((slide) => !slide.image && slide.unavailableReason && slide.fits.length > 0));
  });

  it('draws background, accent, slot lines and counter, and returns a PNG data URL', async () => {
    const calls: Call[] = [];
    const sizes: [number, number][] = [];
    const service = createLocalRenderService({ templates: PROVISIONAL_TEMPLATES, renders: TEMPLATE_RENDERS, createSurface: fakeSurfaces(calls, sizes), fontsReady: async () => undefined });
    assert.equal(service.capabilities().raster, true);
    const rendered = await service.render({ body: body(), slideIds: ['s2'], scale: 0.25 });
    assert.ok(rendered.ok);
    const [slide] = rendered.value.slides;
    assert.equal(slide.slideId, 's2');
    assert.equal(slide.index, 1);
    assert.deepEqual([slide.width, slide.height], [270, 338]);
    assert.ok(slide.image?.dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo'));
    const layout = TEMPLATE_RENDERS[TEMPLATE.id].layouts.quote;
    assert.deepEqual(calls[0], { op: 'fillRect', args: [0, 0, 270, 338], fill: layout.background });
    const texts = calls.filter((call) => call.op === 'fillText').map((call) => call.args[0]);
    assert.ok(texts.some((text) => String(text).startsWith('“A feira')), 'quote drawn with quotation marks');
    assert.ok(texts.includes('— Marina Lopes'));
    assert.equal(texts[texts.length - 1], '2/3', 'slide counter');
    assert.ok(calls.some((call) => call.op === 'fillText' && /italic/.test(call.font ?? '')), 'template italics honoured');
  });

  it('draws and measures with the face the page loaded for the template typeface, loading each face first', async () => {
    const calls: Call[] = [];
    const requested: string[][] = [];
    const typefaces = { Inter: '"interV3", "interV3 Fallback"' };
    const service = createLocalRenderService({
      templates: PROVISIONAL_TEMPLATES,
      renders: TEMPLATE_RENDERS,
      createSurface: fakeSurfaces(calls),
      typefaces,
      fontsReady: async (fonts) => {
        requested.push([...fonts]);
      },
    });
    const rendered = await service.render({ body: body() });
    assert.ok(rendered.ok);
    const fonts = calls.filter((call) => call.op === 'fillText').map((call) => call.font ?? '');
    assert.ok(fonts.length > 0 && fonts.every((font) => font.includes('"interV3", "interV3 Fallback"')), 'every text, counter included, uses the loaded face');
    assert.ok(fonts.every((font) => !/px Inter,/.test(font)), 'never the bare template name');
    const faces = requested.at(-1) ?? [];
    assert.ok(faces.some((font) => font.startsWith('italic 500 16px "interV3"')), 'the quote italic is loaded before drawing');
    assert.ok(faces.some((font) => font.startsWith('700 16px "interV3"')));
  });

  it('ellipsises an overflowing slot instead of drawing past its box', async () => {
    const calls: Call[] = [];
    const service = createLocalRenderService({ templates: PROVISIONAL_TEMPLATES, renders: TEMPLATE_RENDERS, createSurface: fakeSurfaces(calls), fontsReady: async () => undefined });
    const long = 'palavra '.repeat(80).trim();
    const rendered = await service.render({ body: body({ cover: { title: long } }), slideIds: ['s1'] });
    assert.ok(rendered.ok && rendered.value.slides[0].overflow);
    const title = rendered.value.slides[0].fits.find((fit) => fit.slotId === 'title');
    const drawn = calls.filter((call) => call.op === 'fillText' && String(call.args[0]).startsWith('palavra'));
    assert.equal(drawn.length, title?.maxLines);
    assert.ok(String(drawn[drawn.length - 1].args[0]).endsWith('…'));
  });

  it('refuses unknown slides and leaves layouts without visual data unrasterised', async () => {
    const service = createLocalRenderService({ templates: PROVISIONAL_TEMPLATES, renders: {}, createSurface: fakeSurfaces([]), fontsReady: async () => undefined });
    const missing = await service.render({ body: body(), slideIds: ['zz'] });
    assert.equal(!missing.ok && missing.refusal.code, 'unknown_slide');
    const plain = await service.render({ body: body() });
    assert.ok(plain.ok && plain.value.slides.every((slide) => !slide.image && slide.unavailableReason === 'Modelo sem dados visuais para este layout.'));
  });
});

type DrawCall = Call & { alpha?: number };

/** Recording canvas that also draws images and honours globalAlpha (as a browser canvas does). */
function imageSurfaces(calls: DrawCall[]): SurfaceFactory {
  return (width, height) => {
    const base = fakeSurfaces(calls)(width, height);
    if (!base) return undefined;
    const context: Canvas2D = base.context;
    context.globalAlpha = 1;
    const fillRect = context.fillRect.bind(context);
    context.fillRect = (...args) => {
      fillRect(...args);
      (calls[calls.length - 1] as DrawCall).alpha = context.globalAlpha;
    };
    context.drawImage = (...args) => {
      calls.push({ op: 'drawImage', args });
    };
    return base;
  };
}

describe('article cover on the cover slide', () => {
  const PHOTO: CoverImage = { source: 'bitmap', width: 2000, height: 1000 };

  it('cover-fit fills the box, centred and cropped', () => {
    assert.deepEqual(coverFit({ width: 2000, height: 1000 }, { width: 1080, height: 600 }), { sx: 100, sy: 0, sw: 1800, sh: 1000 });
    assert.deepEqual(coverFit({ width: 1000, height: 2000 }, { width: 1080, height: 600 }), { sx: 0, sy: (2000 - 555.5555555555555) / 2, sw: 1000, sh: 555.5555555555555 });
  });

  it('draws the cover under the call with the template scrim and on-image colours; fit is unchanged', async () => {
    const calls: DrawCall[] = [];
    const service = createLocalRenderService({
      templates: PROVISIONAL_TEMPLATES,
      renders: TEMPLATE_RENDERS,
      createSurface: imageSurfaces(calls),
      fontsReady: async () => undefined,
      loadCover: async (assetId) => (assetId === 'img-capa' ? { ok: true, value: PHOTO } : { ok: false, refusal: { code: 'missing', message: COVER_REASONS.missing } }),
      coverCredit: (assetId) => (assetId === 'img-capa' ? 'Foto: Ana Prado' : undefined),
    });
    const rendered = await service.render({ body: body(), articleCover: 'img-capa' });
    assert.ok(rendered.ok);
    const [cover, quote] = rendered.value.slides;
    assert.deepEqual(cover.background, { source: 'article-cover', drawn: true });
    assert.equal(quote.background, undefined, 'only layouts that ask for it');
    const layout = TEMPLATE_RENDERS[TEMPLATE.id].layouts.cover;
    const image = layout.image;
    assert.ok(image);
    const draw = calls.find((call) => call.op === 'drawImage');
    assert.deepEqual(draw?.args, ['bitmap', 100, 0, 1800, 1000, 0, 0, 1080, 600]);
    const drawIndex = calls.indexOf(draw as DrawCall);
    const scrim = calls[drawIndex + 1];
    assert.equal(scrim.fill, image.scrim[0].color);
    assert.equal(scrim.alpha, image.scrim[0].opacity);
    const kicker = calls.find((call) => call.op === 'fillText' && call.args[0] === 'Entrevista');
    assert.equal(kicker?.fill, image.slotColors?.kicker);
    assert.ok(calls.indexOf(kicker as DrawCall) > drawIndex, 'text over the image');
    const credit = calls.find((call) => call.op === 'fillText' && call.args[0] === 'Foto: Ana Prado');
    assert.ok(credit, 'the photo leaves with its credit');
    assert.equal(credit?.fill, image.credit?.color);
    assert.deepEqual(credit?.args.slice(1), [image.credit?.x, image.credit?.y]);
    assert.ok(calls.indexOf(credit as DrawCall) > drawIndex);
    const plain = await service.render({ body: body() });
    assert.ok(plain.ok);
    assert.deepEqual(plain.value.slides.map((slide) => slide.fits), rendered.value.slides.map((slide) => slide.fits), 'text fit never depends on the image');
    assert.deepEqual(plain.value.slides[0].background, { source: 'article-cover', drawn: false, reason: 'O artigo não tem imagem de destaque.' });
  });

  it('a linked or missing cover keeps the template colours and says why', async () => {
    const assets = createMemoryAssetStore({ clock: manualClock('2026-10-07T12:00:00.000Z'), ids: sequentialIds(), workspaceId: 'ws', actorId: () => 'p-joao' });
    const link = await assets.put({ type: 'url', url: 'https://exemplo.com/capa.jpg' }, { productionId: 'p', authorized: true });
    const upload = await assets.put({ type: 'upload', file: pngFile(1200, 800), fileName: 'capa.png' }, { productionId: 'p', authorized: true });
    assert.ok(link.ok && upload.ok);
    const decoded: Blob[] = [];
    const loadCover = assetCoverLoader(assets, async (blob) => {
      decoded.push(blob);
      return PHOTO;
    });
    const calls: DrawCall[] = [];
    const service = createLocalRenderService({ templates: PROVISIONAL_TEMPLATES, renders: TEMPLATE_RENDERS, createSurface: imageSurfaces(calls), fontsReady: async () => undefined, loadCover });
    const linked = await service.render({ body: body(), slideIds: ['s1'], articleCover: link.value.id });
    assert.ok(linked.ok);
    assert.deepEqual(linked.value.slides[0].background, { source: 'article-cover', drawn: false, reason: COVER_REASONS.external });
    assert.ok(!calls.some((call) => call.op === 'drawImage'));
    const missing = await service.render({ body: body(), slideIds: ['s1'], articleCover: 'img-nada' });
    assert.ok(missing.ok && missing.value.slides[0].background?.reason === COVER_REASONS.missing);
    const stored = await service.render({ body: body(), slideIds: ['s1'], articleCover: upload.value.id });
    assert.ok(stored.ok && stored.value.slides[0].background?.drawn === true);
    await service.render({ body: body(), slideIds: ['s1'], articleCover: upload.value.id });
    assert.equal(decoded.length, 1, 'decoded once per asset');
  });

  it('a canvas without drawImage keeps the colours (Node, old browsers)', async () => {
    const service = createLocalRenderService({
      templates: PROVISIONAL_TEMPLATES,
      renders: TEMPLATE_RENDERS,
      createSurface: fakeSurfaces([]),
      fontsReady: async () => undefined,
      loadCover: async () => ({ ok: true, value: PHOTO }),
    });
    const rendered = await service.render({ body: body(), slideIds: ['s1'], articleCover: 'img-capa' });
    assert.ok(rendered.ok && rendered.value.slides[0].image);
    assert.deepEqual(rendered.value.slides[0].background, { source: 'article-cover', drawn: false, reason: COVER_REASONS.unreadable });
  });
});

describe('encoding', () => {
  it('base64 matches the platform encoder for every padding case', () => {
    for (const text of ['', 'a', 'ab', 'abc', 'Citação “ótima” — ç', 'x'.repeat(1000)]) {
      assert.equal(base64(utf8(text)), Buffer.from(text, 'utf8').toString('base64'));
    }
    assert.equal(dataUrl('text/plain', utf8('oi')), 'data:text/plain;base64,b2k=');
  });
});
