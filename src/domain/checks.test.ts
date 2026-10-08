import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COVER_BLOCK_ID, figureBlock, markBlocksReviewed, paragraphBlock, quoteBlock } from './article.ts';
import type { ArticleBody } from './article.ts';
import { assetLookupOf } from './asset.ts';
import type { ImageAsset } from './asset.ts';
import { ARTICLE_CHECKS, CAROUSEL_CHECKS, readiness, runChecks } from './checks.ts';
import type { CheckResult } from './checks.ts';
import { slotIssues } from './carousel.ts';
import type { VersionRef } from './refs.ts';
import { createKit, sampleArticle, sampleCarousel, sampleSource, TEMPLATE } from './testing/scenario.ts';

const idle = { running: false, interrupted: false };
const byId = (results: CheckResult[]) => Object.fromEntries(results.map((result) => [result.id, result]));

describe('article readiness checks', () => {
  test('report title, length, quotes, AI review, links and generation', () => {
    const source = sampleSource(createKit());
    const body = sampleArticle(source);
    const results = byId(runChecks(ARTICLE_CHECKS, { body, brief: { sections: 3, length: 'short', revision: 1 }, sources: [source], generation: idle }));
    assert.equal(results['article.title'].status, 'pass');
    assert.equal(results['article.length'].status, 'warn');
    assert.deepEqual(results['article.length'].progress, { current: 33, total: 500 });
    assert.equal(results['article.length'].detail, '33/500 palavras');
    assert.equal(results['article.quotes'].status, 'pass');
    assert.equal(results['article.quotes'].detail, '2 de 2 conferidas');
    assert.equal(results['article.ai-reviewed'].status, 'warn');
    assert.deepEqual(results['article.ai-reviewed'].progress, { current: 0, total: 4 });
    assert.equal(results['article.ai-reviewed'].targets?.[0].blockId, 'b-intro');
    assert.equal(results['article.links'].status, 'na');
    assert.equal(results['article.generation'].status, 'pass');
    assert.ok(Object.values(results).every((result) => result.blocking === (result.id === 'article.generation')), 'only generation blocks');
  });

  test('missing quotes and broken links are warnings with jump targets', () => {
    const source = sampleSource(createKit());
    const body: ArticleBody = {
      type: 'article',
      title: '',
      blocks: [quoteBlock('q1', 'Frase que ninguém disse na entrevista.'), paragraphBlock('p1', [{ text: 'link', marks: ['link'], href: 'javascript:alert(1)' }])],
    };
    const results = byId(runChecks(ARTICLE_CHECKS, { body, brief: { sections: 3, length: 'medium', revision: 1 }, sources: [source], generation: idle }));
    assert.equal(results['article.title'].status, 'warn');
    assert.equal(results['article.quotes'].status, 'warn');
    assert.deepEqual(results['article.quotes'].targets, [{ blockId: 'q1', from: 0, to: 38 }]);
    assert.equal(results['article.links'].status, 'warn');
    assert.equal(results['article.ai-reviewed'].status, 'na');
  });

  test('a running or interrupted generation is the only blocker', () => {
    const source = sampleSource(createKit());
    const body = markBlocksReviewed(sampleArticle(source), ['b-intro', 'b-h1', 'b-p1', 'b-q1']);
    const context = { body, brief: { sections: 3, length: 'short' as const, revision: 1 }, sources: [source] };
    const running = readiness(runChecks(ARTICLE_CHECKS, { ...context, generation: { running: true, interrupted: false } }));
    assert.equal(running.ready, false);
    assert.equal(running.blockers[0].detail, 'Geração em andamento');
    const interrupted = readiness(runChecks(ARTICLE_CHECKS, { ...context, generation: { running: false, interrupted: true } }));
    assert.equal(interrupted.ready, false);
    const fine = readiness(runChecks(ARTICLE_CHECKS, { ...context, generation: idle }));
    assert.equal(fine.ready, true);
    assert.deepEqual([fine.passed, fine.total], [4, 5], 'length warns; no cover is neutral; links and images are not applicable');
  });
});

describe('image checks', () => {
  const brief = { sections: 3, length: 'short' as const, revision: 1 };
  const asset = (id: string, overrides: Partial<ImageAsset> = {}): ImageAsset => ({
    id,
    workspaceId: 'ws',
    kind: 'image',
    origin: { type: 'upload', fileName: `${id}.jpg` },
    mime: 'image/jpeg',
    credit: 'Ana Prado',
    rights: { authorized: true },
    createdAt: '2026-10-01T12:00:00.000Z',
    createdBy: 'p-joao',
    ...overrides,
  });
  const run = (body: ArticleBody, assets?: ImageAsset[]) =>
    byId(runChecks(ARTICLE_CHECKS, { body, brief, sources: [], generation: idle, ...(assets ? { assets: assetLookupOf(assets) } : {}) }));

  test('"Imagem de destaque" is optional (D04): no cover is a neutral fact outside the readiness count', () => {
    const results = run({ type: 'article', title: 'Título', blocks: [paragraphBlock('p1', 'Texto.')] });
    assert.equal(results['article.cover'].status, 'info');
    assert.equal(results['article.cover'].detail, 'Sem capa');
    assert.equal(results['article.cover'].blocking, false);
    const counted = readiness(Object.values(results));
    assert.equal(counted.total, Object.values(results).filter((result) => result.status !== 'na' && result.status !== 'info').length);
    assert.ok(Object.values(results).every((result) => result.status !== 'warn' || result.id !== 'article.cover'));
    assert.deepEqual(results['article.cover'].targets, [{ blockId: COVER_BLOCK_ID, from: 0, to: 0 }]);
    assert.equal(results['article.image-credits'].status, 'na');
    const covered = run({ type: 'article', title: 'Título', blocks: [], cover: { assetId: 'img-1' } }, [asset('img-1')]);
    assert.equal(covered['article.cover'].status, 'pass');
    const lost = run({ type: 'article', title: 'Título', blocks: [], cover: { assetId: 'img-9' } }, []);
    assert.equal(lost['article.cover'].detail, 'Imagem não encontrada neste navegador');
  });

  test('"Imagens com crédito" lists every image missing credit or authorisation, cover first', () => {
    const body: ArticleBody = {
      type: 'article',
      title: 'Título',
      cover: { assetId: 'img-cover', caption: 'Fachada' },
      blocks: [
        paragraphBlock('p1', 'Texto.'),
        figureBlock('f1', { assetId: 'img-ok', caption: 'Oficina' }),
        figureBlock('f2', { assetId: 'img-nocredit' }),
        figureBlock('f3', { assetId: 'img-unauthorized' }),
      ],
    };
    const assets = [asset('img-cover', { credit: '  ' }), asset('img-ok'), asset('img-nocredit', { credit: undefined }), asset('img-unauthorized', { rights: { authorized: false } })];
    const results = run(body, assets);
    const credits = results['article.image-credits'];
    assert.equal(credits.status, 'warn');
    assert.equal(credits.blocking, false);
    assert.equal(credits.detail, '2 sem crédito · 1 sem uso autorizado');
    assert.deepEqual(credits.progress, { current: 1, total: 4 });
    assert.deepEqual(
      credits.targets?.map((target) => target.blockId),
      [COVER_BLOCK_ID, 'f2', 'f3'],
    );
    const fixed = run(body, assets.map((entry) => ({ ...entry, credit: 'Ana Prado', rights: { authorized: true } })));
    assert.equal(fixed['article.image-credits'].status, 'pass');
    assert.equal(fixed['article.image-credits'].detail, '4 imagens conferidas');
    const ready = readiness(runChecks(ARTICLE_CHECKS, { body, brief, sources: [], generation: idle, assets: assetLookupOf(assets) }));
    assert.equal(ready.ready, true, 'images never block approval');
  });

  test('an image used twice is counted once and pointed at in both places', () => {
    const body: ArticleBody = {
      type: 'article',
      title: 'T',
      cover: { assetId: 'img-1' },
      blocks: [paragraphBlock('p1', 'Texto.'), figureBlock('f1', { assetId: 'img-1' }), figureBlock('f2', { assetId: 'img-2' })],
    };
    const credits = run(body, [asset('img-1', { credit: undefined }), asset('img-2')])['article.image-credits'];
    assert.equal(credits.detail, '1 sem crédito');
    assert.deepEqual(credits.progress, { current: 1, total: 2 });
    assert.deepEqual(
      credits.targets?.map((target) => target.blockId),
      [COVER_BLOCK_ID, 'f1'],
    );
  });

  test('without asset metadata every image reads as not found (a warning)', () => {
    const results = run({ type: 'article', title: 'T', blocks: [figureBlock('f1', { assetId: 'img-1' })] });
    assert.equal(results['article.image-credits'].detail, '1 não encontrada');
  });
});

describe('carousel readiness checks', () => {
  const parent: VersionRef = { kind: 'version', pieceId: 'piece-article', versionId: 'ver-1', number: 1, hash: 'h1' };

  test('pass for a well-formed carousel made from the approved article', () => {
    const results = byId(runChecks(CAROUSEL_CHECKS, { body: sampleCarousel(), template: TEMPLATE, inputs: [parent], latestApprovedParent: parent, generation: idle }));
    // "Imagem da capa" does not apply: the article has no cover.
    assert.ok(Object.values(results).every((result) => result.status === 'pass' || (result.id === 'carousel.cover-image' && result.status === 'na')), JSON.stringify(results));
    assert.equal(results['carousel.article-version'].detail, 'Feito a partir da v1');
  });

  test('warn on overflow, missing cover, wrong count and an outdated article version', () => {
    const body = sampleCarousel();
    body.slides = [body.slides[1], { ...body.slides[2], slots: { quote: 'x'.repeat(200) } }];
    const newer: VersionRef = { ...parent, versionId: 'ver-2', number: 2, hash: 'h2' };
    const results = byId(runChecks(CAROUSEL_CHECKS, { body, template: TEMPLATE, inputs: [parent], latestApprovedParent: newer, generation: idle }));
    assert.equal(results['carousel.cover'].status, 'warn');
    assert.equal(results['carousel.sequence'].status, 'warn');
    assert.equal(results['carousel.limits'].status, 'warn');
    assert.equal(results['carousel.limits'].detail, 'Citação excede 140 caracteres.');
    assert.deepEqual(results['carousel.limits'].progress, { current: 1, total: 2 });
    assert.equal(results['carousel.article-version'].detail, 'Feito a partir da v1; a aprovada é a v2');
    const unknown = byId(runChecks(CAROUSEL_CHECKS, { body: { ...body, templateId: 'nope' }, inputs: [], generation: idle }));
    assert.equal(unknown['carousel.template'].status, 'warn');
    assert.equal(unknown['carousel.limits'].status, 'na');
    assert.equal(unknown['carousel.article-version'].status, 'warn');
  });

  test('slot issues report missing required text and unknown layouts', () => {
    const body = sampleCarousel();
    body.slides = [{ ...body.slides[0], slots: { title: '  ' } }, { ...body.slides[1], layout: 'mystery' }];
    assert.deepEqual(
      slotIssues(body, TEMPLATE).map((issue) => [issue.slideId, issue.kind]),
      [
        ['s-1', 'missing'],
        ['s-2', 'unknown_layout'],
      ],
    );
  });
});
