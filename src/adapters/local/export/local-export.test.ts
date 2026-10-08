import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { figureBlock, headingBlock, listBlock, paragraphBlock, quoteBlock } from '../../../domain/article.ts';
import type { ArticleBody } from '../../../domain/article.ts';
import { toVersionRef } from '../../../domain/piece.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import {
  addCarouselPiece,
  baseRecord,
  commitVersion,
  createKit,
  recordDecision,
  sampleArticle,
  sampleCarousel,
  TEMPLATE,
} from '../../../domain/testing/scenario.ts';
import { TEMPLATE_RENDERS } from '../../../fixtures/templates/provisional.ts';
import { pngFile } from '../../../ports/contracts/assets.contract.ts';
import { exportContract } from '../../../ports/contracts/export.contract.ts';
import type { RenderRequest } from '../../../ports/render.ts';
import { createMemoryAssetStore } from '../assets/index.ts';
import { sha256Sync } from '../assets/sha256.ts';
import { manualClock, sequentialIds } from '../store/system.ts';
import type { SurfaceFactory } from '../render/canvas.ts';
import { createLocalRenderService } from '../render/local-render.ts';
import type { TemplateRender } from '../render/templates.ts';
import { estimateText } from '../render/text-metrics.ts';
import { articleToHtml } from './html.ts';
import { createLocalExportService, EXPORT_PARTIAL_FAILURE } from './local-export.ts';
import { articleToMarkdown } from './markdown.ts';
import type { ImageSources } from './markdown.ts';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const fakeCanvas: SurfaceFactory = () => {
  const context = {
    fillStyle: '' as unknown,
    font: '16px Inter',
    textAlign: 'left',
    textBaseline: 'top',
    fillRect() {},
    fillText() {},
    measureText(text: string) {
      return { width: estimateText(text, { size: Number(/(\d+)px/.exec(context.font)?.[1] ?? 16), weight: 400 }) };
    },
  };
  return { context, toPng: async () => PNG };
};

/** The fixtures' light template data, keyed to the domain test template. */
const RENDERS: Record<string, TemplateRender> = {
  [TEMPLATE.id]: { ...Object.values(TEMPLATE_RENDERS)[0], templateId: TEMPLATE.id },
};

function setup(options: { canvas?: boolean } = {}) {
  const kit = createKit();
  const record: ProductionRecord = baseRecord(kit);
  const render = createLocalRenderService({
    templates: [TEMPLATE],
    renders: RENDERS,
    createSurface: options.canvas === false ? () => undefined : fakeCanvas,
    fontsReady: async () => undefined,
  });
  const exports = createLocalExportService({ clock: { now: () => kit.now() }, getRecord: () => record, render });
  const approveAll = () => {
    const article = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
    recordDecision(record, kit, article, 'approved');
    addCarouselPiece(record, kit);
    const carousel = commitVersion(record, kit, 'carousel', sampleCarousel(), { origin: 'generation', inputs: [toVersionRef(article)] });
    recordDecision(record, kit, carousel, 'approved');
    return { article: toVersionRef(article), carousel: toVersionRef(carousel) };
  };
  const approveNewerArticle = () => {
    const body = sampleArticle(record.sources[0]);
    const newer = commitVersion(record, kit, 'article', { ...body, title: `${body.title} (revisado)` });
    recordDecision(record, kit, newer, 'approved');
    return toVersionRef(newer);
  };
  return { kit, record, exports, approveAll, approveNewerArticle };
}

exportContract('local export', () => {
  const sut = setup();
  return {
    exports: sut.exports,
    productionId: sut.record.production.id,
    approveAll: async () => sut.approveAll(),
    approveNewerArticle: async () => sut.approveNewerArticle(),
  };
});

const ARTICLE: ArticleBody = {
  type: 'article',
  title: 'Da garagem # à feira',
  blocks: [
    paragraphBlock('p1', [
      { text: 'O ' },
      { text: 'Ateliê Sul', marks: ['bold'] },
      { text: ' cresceu ' },
      { text: 'devagar', marks: ['italic'] },
      { text: ' e ' },
      { text: 'site', marks: ['link'], href: 'https://exemplo.com.br/loja(1)' },
      { text: ' <script>.' },
    ]),
    headingBlock('h1', '1. O começo', 2),
    quoteBlock('q1', 'A feira mudou tudo.'),
    listBlock('l1', ['Primeiro item', 'Segundo item'], true),
    paragraphBlock('p2', [{ text: 'perigoso', marks: ['link'], href: 'javascript:alert(1)' }]),
    { id: 'd1', type: 'divider' },
  ],
};

describe('article serialisers', () => {
  it('Markdown keeps structure and marks, escapes syntax and drops unsafe links', () => {
    const md = articleToMarkdown(ARTICLE);
    assert.match(md, /^# Da garagem # à feira\n/);
    assert.match(md, /O \*\*Ateliê Sul\*\* cresceu \*devagar\* e \[site\]\(https:\/\/exemplo\.com\.br\/loja%281%29\) \\<script\\>\./);
    assert.match(md, /\n## 1\\\. O começo\n/);
    assert.match(md, /\n> A feira mudou tudo\.\n/);
    assert.match(md, /\n1\. Primeiro item\n2\. Segundo item\n/);
    assert.match(md, /\nperigoso\n/);
    assert.match(md, /\n---\n$/);
  });

  it('HTML is semantic, escaped and carries no styling', () => {
    const html = articleToHtml(ARTICLE, { versionLabel: 'Artigo v2', hash: 'abc123' });
    assert.match(html, /^<!doctype html>\n<html lang="pt-BR">/);
    assert.match(html, /<h1>Da garagem # à feira<\/h1>/);
    assert.match(html, /<p>O <strong>Ateliê Sul<\/strong> cresceu <em>devagar<\/em> e <a href="https:\/\/exemplo\.com\.br\/loja\(1\)">site<\/a> &lt;script&gt;\.<\/p>/);
    assert.match(html, /<blockquote><p>A feira mudou tudo\.<\/p><\/blockquote>/);
    assert.match(html, /<ol>\n {2}<li>Primeiro item<\/li>/);
    assert.match(html, /<p>perigoso<\/p>/);
    assert.match(html, /<hr>/);
    assert.doesNotMatch(html, /<style\b|\sstyle=|\sclass=|javascript:/i);
  });
});

describe('local export service', () => {
  it('lists disabled formats with their reasons, in the Entrega order', async () => {
    const sut = setup();
    sut.approveAll();
    const plan = await sut.exports.plan({ productionId: sut.record.production.id });
    assert.ok(plan.ok);
    assert.deepEqual(
      plan.value.files.map((file) => `${file.fileName}${file.available ? '' : ' (off)'}`),
      [
        'artigo-v1.md',
        'artigo-v1.html',
        'artigo-v1.docx (off)',
        'carrossel-v1-slide-01.png',
        'carrossel-v1-slide-02.png',
        'carrossel-v1-slide-03.png',
        'carrossel-v1-slide-04.png',
        'carrossel-v1.pdf (off)',
        'carrossel-v1.json',
        'manifesto.json',
        'pacote.zip (off)',
      ],
    );
    assert.equal(plan.value.files.find((file) => file.format === 'pdf')?.unavailableReason, 'Disponível com o render final do carrossel.');
  });

  it('builds files with data links, a manifest of what was built and delivery outcomes', async () => {
    const sut = setup();
    const { article, carousel } = sut.approveAll();
    const built = await sut.exports.build({ productionId: sut.record.production.id });
    assert.ok(built.ok);
    const pkg = built.value;
    assert.equal(pkg.status, 'completed');
    const png = pkg.files.find((file) => file.format === 'png');
    assert.equal(png?.href, 'data:image/png;base64,iVBORw0KGgo=');
    const md = pkg.files.find((file) => file.format === 'md');
    assert.ok(md?.href?.startsWith('data:text/markdown;charset=utf-8;base64,') && md.text?.startsWith('# Da garagem à feira'));
    const json = JSON.parse(pkg.files.find((file) => file.fileName === 'carrossel-v1.json')?.text ?? '{}');
    assert.equal(json.schema, 'reporter.carousel/v1');
    assert.deepEqual(json.derivedFrom, [{ pieceId: article.pieceId, version: 1, hash: article.hash }]);
    const manifest = JSON.parse(pkg.files.find((file) => file.fileName === 'manifesto.json')?.text ?? '{}');
    assert.equal(manifest.schema, 'reporter.delivery/v1');
    assert.equal(manifest.sources[0].hash, sut.record.sources[0].versions[0].hash);
    const carouselEntry = manifest.items.find((item: { kind: string }) => item.kind === 'carousel');
    assert.deepEqual(carouselEntry.derivedFrom, [{ pieceId: article.pieceId, version: 1, hash: article.hash }]);
    assert.ok(carouselEntry.files.includes('carrossel-v1-slide-01.png') && carouselEntry.files.includes('carrossel-v1.json'));
    assert.ok(!carouselEntry.files.includes('carrossel-v1.pdf'), 'disabled formats are not claimed as delivered');
    assert.equal(pkg.outcomes.length, 8, 'md, html, 4 PNGs, json and manifest (disabled formats excluded)');
    assert.ok(pkg.outcomes.every((outcome) => outcome.ok));
    assert.ok(pkg.deliveryItems.every((item) => [article.versionId, carousel.versionId].includes(item.version.versionId)));
  });

  it('a failing file makes the package partial and can be retried alone', async () => {
    const sut = setup();
    sut.approveAll();
    const request = { productionId: sut.record.production.id, simulation: EXPORT_PARTIAL_FAILURE };
    const built = await sut.exports.build(request);
    assert.ok(built.ok);
    assert.equal(built.value.status, 'partial');
    const failed = built.value.files.find((file) => file.status === 'failed');
    assert.equal(failed?.fileName, 'carrossel-v1-slide-01.png');
    assert.ok(!built.value.manifest.items.some((item) => item.files.includes('carrossel-v1-slide-01.png')));
    assert.equal(built.value.outcomes.find((outcome) => !outcome.ok)?.fileName, 'carrossel-v1-slide-01.png');
    const retried = await sut.exports.buildFile({ ...request, fileName: 'carrossel-v1-slide-01.png' });
    assert.ok(retried.ok && retried.value.status === 'ready');
    const off = await sut.exports.buildFile({ ...request, fileName: 'pacote.zip' });
    assert.equal(!off.ok && off.refusal.code, 'file_unavailable');
  });

  it('without a canvas the PNG rows are disabled with the reason, the rest still builds', async () => {
    const sut = setup({ canvas: false });
    sut.approveAll();
    const built = await sut.exports.build({ productionId: sut.record.production.id });
    assert.ok(built.ok);
    const pngs = built.value.files.filter((file) => file.format === 'png');
    assert.ok(pngs.length > 0 && pngs.every((file) => !file.available && file.unavailableReason));
    assert.equal(built.value.status, 'completed');
  });
});

describe('article images in the package', () => {
  const SOURCES: ImageSources = new Map([
    ['img-cover', { src: 'da-garagem-destaque.jpg', credit: 'Ana Prado', width: 1600, height: 900 }],
    ['img-oficina', { src: 'da-garagem-1.png' }],
    ['img-link', { src: 'https://cdn.exemplo.com/a (1).webp', credit: 'Ilustração: Bia' }],
  ]);
  const ILLUSTRATED: ArticleBody = {
    type: 'article',
    title: 'Da garagem',
    cover: { assetId: 'img-cover', alt: 'Fachada', caption: 'A fachada' },
    blocks: [
      paragraphBlock('p1', 'Texto.'),
      figureBlock('f1', { assetId: 'img-oficina', alt: 'Bancada [antiga]' }),
      figureBlock('f2', { assetId: 'img-link', caption: 'Coleção' }),
      figureBlock('f3', { assetId: 'img-perdida', caption: 'Sumiu' }),
    ],
  };

  it('Markdown: the cover after the title, ![alt](file), then caption and credit', () => {
    const md = articleToMarkdown(ILLUSTRATED, SOURCES);
    assert.equal(
      md,
      [
        '# Da garagem',
        '![Fachada](da-garagem-destaque.jpg)',
        '*A fachada* — Foto: Ana Prado',
        'Texto.',
        '![Bancada \\[antiga\\]](da-garagem-1.png)',
        '![](https://cdn.exemplo.com/a%20%281%29.webp)',
        '*Coleção* — Ilustração: Bia',
        '',
      ].join('\n\n').replace(/\n\n$/, '\n'),
    );
    assert.doesNotMatch(md, /Sumiu/, 'an image missing from this browser is left out');
  });

  it('HTML: the cover first (data-role="cover"), <figure><img><figcaption>legenda — <cite>Foto: crédito</cite></figcaption></figure>, no styling', () => {
    const html = articleToHtml(ILLUSTRATED, { versionLabel: 'Artigo v1', hash: 'h' }, SOURCES);
    assert.match(
      html,
      /<article>\n<figure data-role="cover">\n<img src="da-garagem-destaque\.jpg" alt="Fachada" width="1600" height="900">\n<figcaption>A fachada — <cite>Foto: Ana Prado<\/cite><\/figcaption>\n<\/figure>\n<h1>Da garagem<\/h1>\n<p>Texto\.<\/p>/,
    );
    assert.match(html, /<figure>\n<img src="da-garagem-1\.png" alt="Bancada \[antiga\]">\n<\/figure>/);
    assert.match(html, /<img src="https:\/\/cdn\.exemplo\.com\/a \(1\)\.webp" alt="">\n<figcaption>Coleção — <cite>Ilustração: Bia<\/cite><\/figcaption>/);
    assert.doesNotMatch(html, /Sumiu|<style\b|\sstyle=|\sclass=/);
  });

  async function illustratedSetup() {
    const sut = setup();
    const assets = createMemoryAssetStore({ clock: manualClock('2026-10-07T12:00:00.000Z'), ids: sequentialIds(), workspaceId: 'ws', actorId: () => 'p-joao' });
    const meta = { productionId: sut.record.production.id, authorized: true };
    const coverFile = pngFile(1600, 900, 500);
    const cover = await assets.put({ type: 'upload', file: coverFile, fileName: 'fachada.png' }, { ...meta, credit: 'Ana Prado' });
    const figure = await assets.put({ type: 'upload', file: pngFile(800, 600), fileName: 'oficina.png' }, { ...meta, authorized: false });
    const link = await assets.put({ type: 'url', url: 'https://cdn.exemplo.com/colecao.webp' }, { ...meta, credit: 'Bia Lins' });
    assert.ok(cover.ok && figure.ok && link.ok);
    const requests: RenderRequest[] = [];
    const render = createLocalRenderService({ templates: [TEMPLATE], renders: RENDERS, createSurface: fakeCanvas, fontsReady: async () => undefined });
    const spy = { ...render, render: (request: RenderRequest) => (requests.push(request), render.render(request)) };
    const exports = createLocalExportService({ clock: { now: () => sut.kit.now() }, getRecord: () => sut.record, render: spy, assets });
    const base = sampleArticle(sut.record.sources[0]);
    const body: ArticleBody = {
      ...base,
      cover: { assetId: cover.value.id, alt: 'Fachada', caption: 'A fachada' },
      blocks: [...base.blocks, figureBlock('f1', { assetId: figure.value.id, caption: 'Oficina' }), figureBlock('f2', { assetId: link.value.id })],
    };
    const article = commitVersion(sut.record, sut.kit, 'article', body, { origin: 'edit' });
    recordDecision(sut.record, sut.kit, article, 'approved');
    addCarouselPiece(sut.record, sut.kit);
    const carousel = commitVersion(sut.record, sut.kit, 'carousel', sampleCarousel(), { origin: 'generation', inputs: [toVersionRef(article)] });
    recordDecision(sut.record, sut.kit, carousel, 'approved');
    return { sut, exports, requests, coverFile, ids: { cover: cover.value.id, figure: figure.value.id, link: link.value.id } };
  }

  it('ships the stored bytes as <slug>-destaque.<ext> and <slug>-<n>.<ext>, links as "Link externo", and the manifest with digests', async () => {
    const { sut, exports, requests, coverFile, ids } = await illustratedSetup();
    const plan = await exports.plan({ productionId: sut.record.production.id });
    assert.ok(plan.ok);
    const names = plan.value.files.map((file) => `${file.fileName}${file.available ? '' : ' (off)'}`);
    assert.deepEqual(names.slice(0, 6), [
      'artigo-v1.md',
      'artigo-v1.html',
      'artigo-v1.docx (off)',
      'da-garagem-a-feira-a-virada-do-atelie-sul-destaque.png',
      'da-garagem-a-feira-a-virada-do-atelie-sul-1.png',
      'da-garagem-a-feira-a-virada-do-atelie-sul-2.webp (off)',
    ]);
    const external = plan.value.files.find((file) => file.image?.assetId === ids.link);
    assert.equal(external?.image?.asset?.origin.type, 'url');
    assert.match(external?.unavailableReason ?? '', /^Link externo/);

    const built = await exports.build({ productionId: sut.record.production.id });
    assert.ok(built.ok);
    const pkg = built.value;
    assert.equal(pkg.status, 'completed', 'a linked image never fails the package');
    const coverRow = pkg.files.find((file) => file.image?.assetId === ids.cover);
    assert.equal(coverRow?.status, 'ready');
    assert.equal(coverRow?.mimeType, 'image/png');
    assert.equal(coverRow?.bytes, coverFile.size);
    assert.ok(coverRow?.href?.startsWith('blob:'), 'the stored file, by its object URL');
    const md = pkg.files.find((file) => file.format === 'md')?.text ?? '';
    assert.match(md, /^# Da garagem à feira: a virada do Ateliê Sul\n\n!\[Fachada\]\(da-garagem-a-feira-a-virada-do-atelie-sul-destaque\.png\)\n\n\*A fachada\* — Foto: Ana Prado\n/);
    assert.match(md, /!\[\]\(https:\/\/cdn\.exemplo\.com\/colecao\.webp\)\n\nFoto: Bia Lins/);
    const html = pkg.files.find((file) => file.format === 'html')?.text ?? '';
    assert.match(html, /<figure>\n<img src="da-garagem-a-feira-a-virada-do-atelie-sul-1\.png" alt="" width="800" height="600">\n<figcaption>Oficina<\/figcaption>\n<\/figure>/);

    const manifest = JSON.parse(pkg.files.find((file) => file.fileName === 'manifesto.json')?.text ?? '{}');
    assert.equal(manifest.assets.length, 3);
    const coverEntry = manifest.assets.find((entry: { id: string }) => entry.id === ids.cover);
    assert.equal(coverEntry.sha256, sha256Sync(new Uint8Array(await coverFile.arrayBuffer())));
    assert.equal(coverEntry.fileName, 'da-garagem-a-feira-a-virada-do-atelie-sul-destaque.png');
    assert.equal(coverEntry.credit, 'Ana Prado');
    assert.deepEqual(coverEntry.origin, { type: 'upload', fileName: 'fachada.png' });
    assert.deepEqual(coverEntry.usedIn.map((use: { role: string }) => use.role), ['cover']);
    const figureEntry = manifest.assets.find((entry: { id: string }) => entry.id === ids.figure);
    assert.deepEqual(figureEntry.rights, { authorized: false });
    const linkEntry = manifest.assets.find((entry: { id: string }) => entry.id === ids.link);
    assert.equal(linkEntry.included, false);
    assert.equal(linkEntry.url, 'https://cdn.exemplo.com/colecao.webp');
    const articleItem = manifest.items.find((item: { kind: string }) => item.kind === 'article');
    assert.ok(articleItem.files.includes('da-garagem-a-feira-a-virada-do-atelie-sul-destaque.png') && !articleItem.files.includes('da-garagem-a-feira-a-virada-do-atelie-sul-2.webp'));
    assert.ok(pkg.deliveryItems.some((item) => item.fileName === 'da-garagem-a-feira-a-virada-do-atelie-sul-destaque.png' && item.format === 'png'));

    assert.ok(requests.length > 0 && requests.every((request) => request.articleCover === ids.cover), 'slides receive the cover of the article they came from');
    const slide = await exports.buildFile({ productionId: sut.record.production.id, fileName: 'da-garagem-a-feira-a-virada-do-atelie-sul-1.png' });
    assert.ok(slide.ok && slide.value.status === 'ready');
  });

  it('an image missing from this browser fails its row only, with the reason', async () => {
    const { sut, ids } = await illustratedSetup();
    const empty = createMemoryAssetStore({ clock: manualClock('2026-10-07T12:00:00.000Z'), ids: sequentialIds(), workspaceId: 'ws', actorId: () => 'p-joao' });
    const render = createLocalRenderService({ templates: [TEMPLATE], renders: RENDERS, createSurface: fakeCanvas, fontsReady: async () => undefined });
    const exports = createLocalExportService({ clock: { now: () => sut.kit.now() }, getRecord: () => sut.record, render, assets: empty });
    const plan = await exports.plan({ productionId: sut.record.production.id });
    assert.ok(plan.ok, 'images never block the package');
    const row = plan.value.files.find((file) => file.image?.assetId === ids.cover);
    assert.equal(row?.available, false);
    assert.equal(row?.unavailableReason, 'Imagem não encontrada neste navegador.');
  });
});
