import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXTERNAL_IMAGE_REASON } from '../../domain/index.ts';
import type { ExportImage, ImageAsset } from '../../domain/index.ts';
import type { DeliveryItemView, PackageFile, RunView } from '../../ports/index.ts';
import {
  blockedCopy,
  blockingPiece,
  carouselLine,
  deliveredFiles,
  downloadedOutcomes,
  downloadToast,
  fileOutcomes,
  formatChoices,
  formatSpan,
  groupFiles,
  imageCaption,
  imageSummary,
  imageUseLabel,
  imageWarningLine,
  imageWarnings,
  linkedImageAddress,
  packageMeta,
  pendingFailures,
  pendingImagesLine,
  selectionKey,
  traceRuns,
} from './delivery-model.ts';

const file = (fileName: string, patch: Partial<PackageFile> = {}): PackageFile => ({
  fileName,
  format: 'md',
  mimeType: 'text/markdown',
  kind: 'article',
  available: true,
  ...patch,
});

const ARTICLE = file('artigo-v4.md', { versionId: 'v-a4', pieceId: 'p-a' });
const HTML = file('artigo-v4.html', { format: 'html', versionId: 'v-a4', pieceId: 'p-a' });
const DOCX = file('artigo-v4.docx', { format: 'docx', versionId: 'v-a4', available: false, unavailableReason: 'Disponível com a exportação no servidor.' });
const SLIDE_1 = file('carrossel-v2-slide-01.png', { format: 'png', kind: 'carousel', versionId: 'v-c2', slideIndex: 0 });
const SLIDE_2 = file('carrossel-v2-slide-02.png', { format: 'png', kind: 'carousel', versionId: 'v-c2', slideIndex: 1 });
const MANIFEST = file('manifesto.json', { format: 'json', kind: 'manifest' });
const ZIP = file('pacote.zip', { format: 'zip', kind: 'package', available: false, unavailableReason: 'Disponível com a exportação no servidor.' });
const FILES = [ARTICLE, HTML, DOCX, SLIDE_1, SLIDE_2, MANIFEST, ZIP];

const item = (kind: 'article' | 'carousel', versionId: string, number: number): DeliveryItemView =>
  ({
    kind,
    label: kind === 'article' ? 'Artigo' : 'Carrossel',
    version: { kind: 'version', pieceId: `p-${kind}`, versionId, number, hash: `h-${versionId}` },
    decisionId: `d-${versionId}`,
  }) as DeliveryItemView;

describe('delivery model', () => {
  it('groups the files a person opens, then the data that leaves with them; unavailable formats are not listed', () => {
    const groups = groupFiles(FILES);
    assert.deepEqual(
      groups.map((group) => [group.id, group.label, group.files.map((entry) => entry.fileName)]),
      [
        ['article', 'Artigo', ['artigo-v4.md', 'artigo-v4.html']],
        ['carousel', 'Carrossel (2 imagens)', ['carrossel-v2-slide-01.png', 'carrossel-v2-slide-02.png']],
        ['record', 'Dados do pacote', ['manifesto.json']],
      ],
    );
    assert.deepEqual(groupFiles([SLIDE_1]).map((group) => group.label), ['Carrossel (1 imagem)']);
    assert.deepEqual(groupFiles([DOCX, ZIP]), []);
  });

  it('keeps the carousel data before the manifest, and every file that leaves keeps a row to download from', () => {
    const data = file('carrossel-v2.json', { format: 'json', mimeType: 'application/json', kind: 'carousel', versionId: 'v-c2' });
    const groups = groupFiles([MANIFEST, ARTICLE, data, SLIDE_1]);
    assert.deepEqual(groups.at(-1)?.files.map((entry) => entry.fileName), ['carrossel-v2.json', 'manifesto.json']);
    const listed = new Set(groups.flatMap((group) => group.files.map((entry) => entry.fileName)));
    assert.deepEqual(
      fileOutcomes([MANIFEST, ARTICLE, data, SLIDE_1], {}).filter((outcome) => !listed.has(outcome.fileName)),
      [],
    );
  });

  it('offers one "Baixar só" choice per format the package has available', () => {
    const choices = formatChoices(FILES);
    assert.deepEqual(
      choices.map((choice) => [choice.id, choice.label, choice.files.length]),
      [
        ['article:md', 'Artigo em Markdown (.md)', 1],
        ['article:html', 'Artigo em HTML (.html)', 1],
        ['carousel:png', 'Slides em imagem (.png)', 2],
      ],
    );
    const pdf = file('carrossel-v2.pdf', { format: 'pdf', mimeType: 'application/pdf', kind: 'carousel', versionId: 'v-c2' });
    assert.equal(formatChoices([...FILES, pdf]).find((choice) => choice.id === 'carousel:pdf')?.label, 'Carrossel em PDF (.pdf)');
    assert.deepEqual(formatChoices([DOCX, ZIP, MANIFEST]), []);
  });

  it('records every deliverable file: ready ones ok, failed ones with the error, never zip or disabled formats', () => {
    const outcomes = fileOutcomes(FILES, {
      'artigo-v4.md': { state: 'ready', href: 'data:', bytes: 10 },
      'artigo-v4.html': { state: 'ready', href: 'data:', bytes: 10 },
      'carrossel-v2-slide-01.png': { state: 'failed', error: { code: 'simulated_failure', message: 'Falha simulada.' } },
      'carrossel-v2-slide-02.png': { state: 'ready', href: 'data:', bytes: 10 },
      'manifesto.json': { state: 'ready', href: 'data:', bytes: 10 },
    });
    assert.deepEqual(
      outcomes.map((outcome) => [outcome.fileName, outcome.ok]),
      [
        ['artigo-v4.md', true],
        ['artigo-v4.html', true],
        ['carrossel-v2-slide-01.png', false],
        ['carrossel-v2-slide-02.png', true],
        ['manifesto.json', true],
      ],
    );
    assert.equal(outcomes[2]?.error?.code, 'simulated_failure');
    assert.equal(outcomes[0]?.versionId, 'v-a4');
  });

  it('records as delivered only the files the browser was handed (a missing link is a failure)', () => {
    const outcomes = fileOutcomes(FILES, {
      'artigo-v4.md': { state: 'ready', href: 'data:', bytes: 10 },
      'artigo-v4.html': { state: 'ready', href: 'data:', bytes: 10 },
      'carrossel-v2-slide-01.png': { state: 'ready', href: 'data:', bytes: 10 },
      'carrossel-v2-slide-02.png': { state: 'ready', href: 'data:', bytes: 10 },
      'manifesto.json': { state: 'ready', href: 'data:', bytes: 10 },
    });
    const saved = ['artigo-v4.md', 'artigo-v4.html', 'carrossel-v2-slide-01.png', 'manifesto.json'];
    const left = downloadedOutcomes(outcomes, saved);
    assert.deepEqual(
      left.filter((outcome) => !outcome.ok).map((outcome) => [outcome.fileName, outcome.error?.code]),
      [['carrossel-v2-slide-02.png', 'not_downloaded']],
    );
    assert.equal(downloadedOutcomes(outcomes, outcomes.map((outcome) => outcome.fileName)).every((outcome) => outcome.ok), true);
  });

  it('keeps a file pending only while its last attempt failed', () => {
    const failed = pendingFailures([
      { at: '1', status: 'succeeded', items: ['a', 'b'] },
      { at: '1', status: 'failed', items: ['c'] },
    ]);
    assert.deepEqual([...failed], ['c']);
    const retried = pendingFailures([
      { at: '1', status: 'failed', items: ['c'] },
      { at: '2', status: 'succeeded', items: ['c'] },
    ]);
    assert.equal(retried.size, 0);
  });

  it('keys a package by its exact versions, whatever their order', () => {
    const a = { kind: 'version' as const, pieceId: 'p1', versionId: 'v1', number: 1, hash: 'h1' };
    const b = { kind: 'version' as const, pieceId: 'p2', versionId: 'v2', number: 2, hash: 'h2' };
    assert.equal(selectionKey('prod', [a, b]), selectionKey('prod', [b, a]));
    assert.notEqual(selectionKey('prod', [a, b]), selectionKey('prod', [a, { ...b, hash: 'h3' }]));
  });

  it('formats stage spans in minutes, hours or days', () => {
    const short = (ms: number) => `${Math.round(ms / 60_000)} min`;
    assert.equal(formatSpan(12 * 60_000, short), '12 min');
    assert.equal(formatSpan(5 * 3_600_000 + 20 * 60_000, short), '5 h 20 min');
    assert.equal(formatSpan(3 * 86_400_000 + 4 * 3_600_000, short), '3 dias 4 h');
  });

  it('points at the first planned piece still without approval', () => {
    const pieces = [
      { kind: 'article' as const, approvedVersion: {} },
      { kind: 'carousel' as const, approvedVersion: undefined },
    ];
    assert.equal(blockingPiece(pieces, ['article', 'carousel'])?.kind, 'carousel');
    assert.equal(blockingPiece(pieces.slice(0, 1), ['article']), undefined);
  });

  it('traces each exported piece to the run that made it, or its latest generation', () => {
    const run = (id: string, patch: Partial<RunView>): RunView =>
      ({ id, kind: 'article.generate', status: 'completed', createdAt: '2026-09-20T10:00:00.000Z', ...patch }) as RunView;
    const article = item('article', 'v-a2', 2);
    const carousel = item('carousel', 'v-c2', 2);
    const older = run('r-a0', { pieceId: 'p-article', endedAt: '2026-09-20T10:00:00.000Z' });
    const v1 = run('r-a1', { pieceId: 'p-article', endedAt: '2026-09-21T10:00:00.000Z', output: { kind: 'version', pieceId: 'p-article', versionId: 'v-a1', number: 1, hash: 'h' } });
    const section = run('r-s1', { kind: 'article.section', pieceId: 'p-article', parentRunId: 'r-a1', endedAt: '2026-09-22T10:00:00.000Z' });
    const slides = run('r-c2', { kind: 'carousel.generate', pieceId: 'p-carousel', output: { kind: 'version', pieceId: 'p-carousel', versionId: 'v-c2', number: 2, hash: 'h' } });
    assert.deepEqual(
      traceRuns([article, carousel], [slides], [older, v1, section, slides]).map((entry) => entry.id),
      ['r-a1', 'r-c2'],
    );
  });

  it('says what the screen says (COPY §8)', () => {
    assert.deepEqual(blockedCopy('carousel'), { title: 'A entrega abre quando tudo estiver aprovado', description: 'Falta aprovar o carrossel.', action: 'Abrir o carrossel' });
    assert.equal(blockedCopy('article').action, 'Abrir o artigo');
    assert.deepEqual(downloadToast(9, 9), { title: 'Pacote baixado · 9 arquivos', partial: false });
    assert.deepEqual(downloadToast(1, 1), { title: 'Pacote baixado · 1 arquivo', partial: false });
    assert.deepEqual(downloadToast(7, 9), { title: 'Baixamos 7 de 9 arquivos', partial: true });
    assert.equal(pendingImagesLine(0), undefined);
    assert.equal(pendingImagesLine(1), '1 imagem sem arquivo.');
    assert.equal(pendingImagesLine(2), '2 imagens sem arquivo.');
    assert.equal(carouselLine({ slides: 5, approverName: null }), '5 slides · aprovado');
    assert.equal(carouselLine({ slides: 1, approverName: 'Juliana Prates' }), '1 slide · aprovado por Juliana');
  });

  it('counts the files that left and the ones the package carries, with its size once prepared', () => {
    const attempts = [
      { at: '2026-10-08T14:00:00.000Z', status: 'succeeded' as const, items: ['a', 'b'] },
      { at: '2026-10-08T14:05:00.000Z', status: 'succeeded' as const, items: ['b', 'c'] },
    ];
    assert.equal(deliveredFiles({ attempts }), 3);
    const size = (bytes: number) => `${bytes} B`;
    assert.equal(packageMeta(FILES, 0, size), '5 arquivos');
    assert.equal(packageMeta(FILES, 489, size), '5 arquivos · 489 B');
  });

  describe('article images', () => {
    const asset = (id: string, patch: Partial<ImageAsset> = {}): ImageAsset => ({
      id,
      workspaceId: 'ws',
      kind: 'image',
      origin: { type: 'upload', fileName: `${id}.jpg` },
      mime: 'image/jpeg',
      rights: { authorized: true },
      createdAt: '2026-10-07T10:00:00.000Z',
      createdBy: 'person-joao',
      ...patch,
    });
    const imageFile = (n: number, image: ExportImage, patch: Partial<PackageFile> = {}): PackageFile =>
      file(`feira-${n}.jpg`, { format: 'jpg', mimeType: 'image/jpeg', kind: 'image', versionId: 'v-a4', image, ...patch });
    const COVER = imageFile(1, {
      assetId: 'img-1',
      uses: [{ role: 'cover', blockId: 'cover', caption: 'Abertura' }],
      asset: asset('img-1', { credit: 'Ana Prado', rights: { authorized: true, note: 'só no site' } }),
    });
    const FIGURE = imageFile(2, {
      assetId: 'img-2',
      uses: [{ role: 'figure', blockId: 'f1' }],
      asset: asset('img-2', { rights: { authorized: false } }),
    });
    const LINK = imageFile(
      3,
      { assetId: 'img-3', uses: [{ role: 'figure', blockId: 'f2' }], asset: asset('img-3', { origin: { type: 'url', url: 'https://exemplo.com/fotos/praca.jpg' }, credit: 'Divulgação: Feira' }) },
      { available: false, unavailableReason: EXTERNAL_IMAGE_REASON },
    );
    const IMAGES = [COVER, FIGURE, LINK];

    it('follows the article texts; a linked image stays listed, with why it does not leave', () => {
      const [article] = groupFiles([IMAGES[0]!, ARTICLE, ...IMAGES.slice(1), MANIFEST]);
      assert.deepEqual(article?.files.map((entry) => entry.fileName), ['artigo-v4.md', 'feira-1.jpg', 'feira-2.jpg', 'feira-3.jpg']);
      assert.equal(article?.files.at(-1)?.unavailableReason, EXTERNAL_IMAGE_REASON);
    });

    it('describes each image by use, credit, rights and origin', () => {
      assert.equal(imageCaption(COVER), 'Destaque · Foto: Ana Prado · Arquivo enviado · img-1.jpg');
      assert.equal(imageCaption(FIGURE), 'No texto · Sem crédito · Uso não autorizado · Arquivo enviado · img-2.jpg');
      assert.equal(imageUseLabel({ uses: [{ role: 'cover', blockId: 'cover' }, { role: 'figure', blockId: 'f9' }] }), 'Destaque e no texto');
      assert.equal(linkedImageAddress(LINK), 'exemplo.com/fotos/praca.jpg');
      assert.equal(linkedImageAddress(COVER), undefined);
    });

    it('never offers an image, least of all a linked one, in "Baixar só"', () => {
      const choices = formatChoices([ARTICLE, ...IMAGES]);
      assert.deepEqual(choices.map((choice) => choice.id), ['article:md']);
      assert.equal(choices.some((choice) => choice.files.some((entry) => entry.kind === 'image')), false);
    });

    it('never records a linked image as a delivered file', () => {
      const outcomes = fileOutcomes(IMAGES, { 'feira-1.jpg': { state: 'ready', href: 'blob:1', bytes: 10 } });
      assert.deepEqual(
        outcomes.map((outcome) => [outcome.fileName, outcome.ok]),
        [
          ['feira-1.jpg', true],
          ['feira-2.jpg', false],
        ],
      );
    });

    it('summarises the images for Rastreabilidade and says what they miss before they leave', () => {
      const missing = imageFile(4, { assetId: 'img-4', uses: [{ role: 'figure', blockId: 'f3' }] }, { available: false, unavailableReason: 'Imagem não encontrada neste navegador.' });
      const changed = imageFile(5, {
        assetId: 'img-5',
        uses: [{ role: 'figure', blockId: 'f4' }],
        asset: asset('img-5', { credit: 'Bia' }),
        approved: { assetId: 'img-5', rights: { authorized: true } },
      });
      assert.equal(imageSummary([MANIFEST, ...IMAGES, missing]), '4 imagens · 1 link externo');
      assert.equal(imageSummary([MANIFEST]), undefined);
      assert.deepEqual(imageWarnings([...IMAGES, missing, changed, COVER]), { unauthorized: 1, uncredited: 1, changed: 1, missing: 1 });
      assert.equal(
        imageWarningLine(imageWarnings([...IMAGES, missing, changed])),
        '1 imagem sem uso autorizado · 1 sem crédito · 1 alterada depois da aprovação · 1 fora deste navegador',
      );
      assert.equal(imageWarningLine(imageWarnings([COVER])), undefined);
      assert.match(imageCaption(changed), /Mudou depois da aprovação/);
    });
  });
});
