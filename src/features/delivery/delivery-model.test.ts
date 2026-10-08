import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXTERNAL_IMAGE_REASON } from '../../domain/index.ts';
import type { ExportImage, ImageAsset } from '../../domain/index.ts';
import type { DeliveryItemView, PackageFile, RunView } from '../../ports/index.ts';
import {
  blockingPiece,
  downloadedOutcomes,
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
  pendingFailures,
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
  it('groups files by approved version, then the package-wide files', () => {
    const groups = groupFiles(FILES, [item('article', 'v-a4', 4), item('carousel', 'v-c2', 2)]);
    assert.deepEqual(
      groups.map((group) => [group.label, group.files.map((entry) => entry.fileName)]),
      [
        ['Artigo v4', ['artigo-v4.md', 'artigo-v4.html', 'artigo-v4.docx']],
        ['Carrossel v2', ['carrossel-v2-slide-01.png', 'carrossel-v2-slide-02.png']],
        ['Pacote', ['manifesto.json', 'pacote.zip']],
      ],
    );
  });

  it('offers one download choice per kind and format, disabled formats with their reason', () => {
    const choices = formatChoices(FILES);
    const slides = choices.find((choice) => choice.label === 'Slides · PNG');
    assert.equal(slides?.files.length, 2);
    const zip = choices.find((choice) => choice.id === 'package:zip');
    assert.equal(zip?.available, false);
    assert.equal(zip?.reason, 'Disponível com a exportação no servidor.');
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

    it('stays with the article version it belongs to', () => {
      const [article] = groupFiles([ARTICLE, ...IMAGES, MANIFEST], [item('article', 'v-a4', 4)]);
      assert.deepEqual(article?.files.map((entry) => entry.fileName), ['artigo-v4.md', 'feira-1.jpg', 'feira-2.jpg', 'feira-3.jpg']);
    });

    it('describes each image by use, credit, rights and origin', () => {
      assert.equal(imageCaption(COVER), 'Destaque · Foto: Ana Prado · Arquivo enviado · img-1.jpg');
      assert.equal(imageCaption(FIGURE), 'No texto · Sem crédito · Uso não autorizado · Arquivo enviado · img-2.jpg');
      assert.equal(imageUseLabel({ uses: [{ role: 'cover', blockId: 'cover' }, { role: 'figure', blockId: 'f9' }] }), 'Destaque e no texto');
      assert.equal(linkedImageAddress(LINK), 'exemplo.com/fotos/praca.jpg');
      assert.equal(linkedImageAddress(COVER), undefined);
    });

    it('offers the stored images as one download choice; linked ones never leave', () => {
      const choices = formatChoices([ARTICLE, ...IMAGES]);
      const images = choices.find((choice) => choice.id === 'image');
      assert.equal(images?.label, 'Imagens do artigo');
      assert.equal(images?.available, true);
      assert.deepEqual(images?.files.map((entry) => entry.fileName), ['feira-1.jpg', 'feira-2.jpg']);
      assert.equal(choices.filter((choice) => choice.id.startsWith('image')).length, 1);
      const onlyLinks = formatChoices([LINK]).find((choice) => choice.id === 'image');
      assert.equal(onlyLinks?.available, false);
      assert.equal(onlyLinks?.reason, EXTERNAL_IMAGE_REASON);
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
