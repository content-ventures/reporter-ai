import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  articleAssetIds,
  articleHash,
  articleImageRights,
  articleImages,
  articlePlainText,
  articleStats,
  blockText,
  COVER_BLOCK_ID,
  figureBlock,
  normalizeArticle,
  paragraphBlock,
  quoteBlock,
  replaceTextRange,
  setCover,
} from './article.ts';
import type { ArticleBody } from './article.ts';
import {
  assetLookupOf,
  assetOriginLabel,
  creditLine,
  imageAlt,
  imageExtension,
  imageIssues,
  imageMimeOf,
  validateImageFile,
  validateImageUrl,
  withApprovedRights,
} from './asset.ts';
import { ARTICLE_CHECKS, CAROUSEL_CHECKS, runChecks } from './checks.ts';
import type { CarouselCheckContext } from './checks.ts';
import type { ImageAsset } from './asset.ts';
import { diffArticles, diffSummary, imageDiffText } from './diff.ts';
import { buildManifest, EXTERNAL_IMAGE_REASON, exportImageFiles, exportImageSources, MISSING_IMAGE_REASON, plannedExportFiles } from './manifest.ts';
import { bodyHash } from './piece.ts';
import { carouselArticleCover, decidedImageRights, usedAssetIds } from './record.ts';
import { decide } from './rules/decide.ts';
import { ARTICLE_GATE } from './decision.ts';
import { extractQuotes } from './quotes.ts';
import { canExport, defaultExportSelection } from './rules/export.ts';
import { saveVersion } from './rules/versions.ts';
import { slugify } from './text/normalize.ts';
import { approvedPackage, commitVersion, createKit, PEDRO, recordDecision } from './testing/scenario.ts';

const asset = (id: string, overrides: Partial<ImageAsset> = {}): ImageAsset => ({
  id,
  workspaceId: 'ws',
  kind: 'image',
  origin: { type: 'upload', fileName: `${id}.jpg` },
  mime: 'image/jpeg',
  width: 1600,
  height: 900,
  bytes: 2048,
  credit: 'Ana Prado/Ateliê Sul',
  rights: { authorized: true },
  createdAt: '2026-10-01T12:00:00.000Z',
  createdBy: 'p-joao',
  ...overrides,
});

const plain: ArticleBody = {
  type: 'article',
  title: 'Estúdio Norte amplia a produção',
  blocks: [paragraphBlock('p1', 'O estúdio cresceu em 2025.'), quoteBlock('q1', 'Crescemos sem perder o ofício.')],
};

const illustrated = (): ArticleBody => ({
  ...plain,
  cover: { assetId: 'img-cover', alt: 'Fachada do estúdio', caption: 'A fachada em Novo Hamburgo' },
  blocks: [
    plain.blocks[0],
    figureBlock('f1', { assetId: 'img-oficina', alt: 'Bancada', caption: '  A oficina  ' }),
    plain.blocks[1],
    figureBlock('f2', { assetId: 'img-link', caption: 'Coleção' }),
    figureBlock('f3', { assetId: 'img-cover' }),
  ],
});

describe('article images', () => {
  test('figures and the cover never count as text: stats, plain text and quotes ignore them', () => {
    const body = illustrated();
    assert.deepEqual(articleStats(body), articleStats(plain));
    assert.equal(articlePlainText(body), articlePlainText(plain));
    assert.equal(blockText(body.blocks[1]), '');
    assert.deepEqual(
      extractQuotes(body).map((quote) => quote.blockId),
      extractQuotes(plain).map((quote) => quote.blockId),
    );
    assert.equal(replaceTextRange(body, { blockId: 'f1', from: 0, to: 0 }, 'x').ok, false);
  });

  test('images enter the hash (asset, alt, caption); articles without images keep their old hash', () => {
    const body = illustrated();
    assert.notEqual(articleHash(body), articleHash(plain));
    assert.equal(articleHash({ ...plain, cover: undefined }), articleHash(plain), 'an absent cover does not change the hash');
    assert.equal(articleHash(setCover(body, undefined)) === articleHash(body), false);
    const captioned = structuredClone(body);
    (captioned.blocks[1] as { image: { caption?: string } }).image.caption = 'Outra legenda';
    assert.notEqual(articleHash(captioned), articleHash(body));
    const trimmed = structuredClone(body);
    (trimmed.blocks[1] as { image: { caption?: string } }).image.caption = 'A oficina';
    assert.equal(articleHash(trimmed), articleHash(body), 'caption whitespace is normalised');
    const normalizedFigure = normalizeArticle(body).blocks[1];
    assert.equal(normalizedFigure.type === 'figure' && normalizedFigure.image.caption, 'A oficina');
    // Provenance stays out of the hash for figures too.
    const reviewed = structuredClone(body);
    reviewed.blocks[1] = { ...reviewed.blocks[1], ai: 'reviewed' };
    assert.equal(articleHash(reviewed), articleHash(body));
  });

  test('lists every use in reading order (cover first) and the distinct assets', () => {
    const uses = articleImages(illustrated());
    assert.deepEqual(
      uses.map((use) => [use.role, use.blockId, use.image.assetId]),
      [
        ['cover', COVER_BLOCK_ID, 'img-cover'],
        ['figure', 'f1', 'img-oficina'],
        ['figure', 'f2', 'img-link'],
        ['figure', 'f3', 'img-cover'],
      ],
    );
    assert.deepEqual(articleAssetIds(illustrated()), ['img-cover', 'img-oficina', 'img-link']);
  });

  test('a cover alone is content worth a version', () => {
    const kit = createKit();
    const pack = approvedPackage(kit);
    const piece = pack.record.pieces.find((candidate) => candidate.kind === 'article');
    assert.ok(piece && piece.draft.body.type === 'article');
    const withCover = { ...piece, draft: { ...piece.draft, body: setCover(piece.draft.body, { assetId: 'img-1' }) } };
    const saved = saveVersion(withCover, pack.record.versions, kit.ctx());
    assert.ok(saved.ok, 'adding a cover is a change');
    assert.equal(saved.value.version.hash, bodyHash(withCover.draft.body));
  });
});

describe('image metadata rules', () => {
  test('accepts jpg/png/webp/gif up to 10 MB, by type or by extension', () => {
    assert.ok(validateImageFile({ name: 'foto.JPG', type: '', size: 1000 }).ok);
    assert.ok(validateImageFile({ name: 'x.bin', type: 'image/webp', size: 1000 }).ok);
    assert.equal(imageMimeOf({ type: 'image/jpg' }), 'image/jpeg');
    const tooBig = validateImageFile({ name: 'a.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 });
    assert.equal(!tooBig.ok && tooBig.refusal.code, 'too_large');
    const svg = validateImageFile({ name: 'logo.svg', type: 'image/svg+xml', size: 10 });
    assert.equal(!svg.ok && svg.refusal.code, 'unsupported_type');
    const empty = validateImageFile({ name: 'a.png', type: 'image/png', size: 0 });
    assert.equal(!empty.ok && empty.refusal.code, 'empty');
  });

  test('links must be http or https', () => {
    assert.deepEqual(validateImageUrl(' https://exemplo.com/foto.jpg '), { ok: true, value: 'https://exemplo.com/foto.jpg' });
    assert.equal(validateImageUrl('exemplo.com/foto.png').ok, true);
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAA', 'ftp://exemplo.com/a.jpg', 'mailto:a@b.com']) {
      const result = validateImageUrl(bad);
      assert.equal(!result.ok && result.refusal.code, 'invalid_url', bad);
    }
    const blank = validateImageUrl('  ');
    assert.equal(!blank.ok && blank.refusal.code, 'empty');
  });

  test('credit line, origin label, extension and issues', () => {
    assert.equal(creditLine('Ana Prado'), 'Foto: Ana Prado');
    assert.equal(creditLine('Ilustração: Bia Lins'), 'Ilustração: Bia Lins');
    assert.equal(creditLine('   '), undefined);
    assert.equal(assetOriginLabel({ type: 'url', url: 'https://cdn.exemplo.com/a.jpg' }), 'Link externo · cdn.exemplo.com');
    assert.equal(imageExtension({ mime: 'image/webp', origin: { type: 'upload', fileName: 'a.png' } }), 'webp');
    assert.equal(imageExtension({ origin: { type: 'url', url: 'https://x.com/foto.PNG?w=10' } }), 'png');
    assert.equal(imageExtension({ origin: { type: 'url', url: 'https://x.com/foto' } }), 'jpg');
    assert.deepEqual(imageIssues(undefined), ['missing_asset']);
    assert.deepEqual(imageIssues(asset('a', { credit: undefined, rights: { authorized: false } })), ['missing_credit', 'not_authorized']);
    assert.deepEqual(imageIssues(asset('a')), []);
  });

  test('slugs for file names', () => {
    assert.equal(slugify('Estúdio Norte amplia a produção!'), 'estudio-norte-amplia-a-producao');
    assert.equal(slugify('   '), '');
    assert.ok(slugify('palavra '.repeat(20)).length <= 48);
    assert.ok(!slugify('palavra '.repeat(20)).endsWith('-'));
  });
});

describe('figure-aware diff', () => {
  const assets = assetLookupOf([asset('img-a'), asset('img-b', { credit: 'Bia Lins' }), asset('img-cover')]);

  test('an added, removed or swapped image reads as "[Imagem] legenda — Foto: crédito"', () => {
    const before: ArticleBody = {
      type: 'article',
      title: 'T',
      blocks: [paragraphBlock('p1', 'Texto.'), figureBlock('f1', { assetId: 'img-a', caption: 'Oficina' }), figureBlock('f2', { assetId: 'img-a', caption: 'Sai' })],
    };
    const after: ArticleBody = {
      type: 'article',
      title: 'T',
      cover: { assetId: 'img-cover', caption: 'Fachada' },
      blocks: [paragraphBlock('p1', 'Texto.'), figureBlock('f1', { assetId: 'img-b', caption: 'Oficina' }), figureBlock('f4', { assetId: 'img-b', caption: 'Entra' })],
    };
    const blocks = diffArticles(before, after, { assets });
    const byId = Object.fromEntries(blocks.map((block) => [block.id, block]));
    assert.equal(byId.cover.change, 'added');
    assert.equal(byId.cover.blockType, 'cover');
    assert.deepEqual(byId.cover.hunks, [{ kind: 'insert', text: '[Imagem de destaque] Fachada — Foto: Ana Prado/Ateliê Sul' }]);
    assert.equal(byId.f1.change, 'modified', 'same block, other image');
    assert.equal(byId.f1.previousImage?.assetId, 'img-a');
    assert.equal(byId.f1.image?.assetId, 'img-b');
    assert.equal(byId.f1.formatOnly, undefined, 'a swapped image is not a format change');
    assert.equal(
      byId.f1.hunks.map((hunk) => (hunk.kind === 'delete' ? `-${hunk.text}` : hunk.kind === 'insert' ? `+${hunk.text}` : hunk.text)).join(''),
      '[Imagem] Oficina — Foto: -Ana Prado/Ateliê Sul+Bia Lins',
    );
    assert.equal(byId.f2.change, 'removed');
    assert.equal(byId.f4.change, 'added');
    assert.equal(byId.p1.change, 'unchanged');
    assert.deepEqual(diffSummary(blocks), { added: 2, removed: 1, modified: 1, unchanged: 2 });
  });

  test('an alt-only change is a format change; same image and caption is unchanged', () => {
    const before: ArticleBody = { type: 'article', title: '', blocks: [figureBlock('f1', { assetId: 'img-a', caption: 'Oficina' })] };
    const altered: ArticleBody = { type: 'article', title: '', blocks: [figureBlock('f1', { assetId: 'img-a', caption: 'Oficina', alt: 'Bancada' })] };
    const [same] = diffArticles(before, before, { assets });
    assert.equal(same.change, 'unchanged');
    const [alt] = diffArticles(before, altered, { assets });
    assert.equal(alt.change, 'modified');
    assert.equal(alt.formatOnly, true);
  });

  test('the older version reads its images as approved: a credit or authorisation changed since is a change', () => {
    const body: ArticleBody = { type: 'article', title: '', cover: { assetId: 'img-cover' }, blocks: [figureBlock('f1', { assetId: 'img-a', caption: 'Oficina' })] };
    const now = assetLookupOf([asset('img-a', { credit: 'Bia Lins', rights: { authorized: false } }), asset('img-cover')]);
    const approved = withApprovedRights(now, [{ assetId: 'img-a', credit: 'Ana Prado/Ateliê Sul', rights: { authorized: true } }]);
    const [cover, figure] = diffArticles(body, body, { assets: now, beforeAssets: approved });
    assert.equal(cover.change, 'unchanged');
    assert.equal(figure.change, 'modified');
    assert.equal(figure.formatOnly, undefined);
    assert.equal(
      figure.hunks.map((hunk) => (hunk.kind === 'delete' ? `-${hunk.text}` : hunk.kind === 'insert' ? `+${hunk.text}` : hunk.text)).join(''),
      '[Imagem] Oficina — Foto: -Ana Prado/Ateliê Sul+Bia Lins · uso não autorizado',
    );
    assert.equal(diffArticles(body, body, { assets: now })[1].change, 'unchanged', 'without the snapshot both read the same');
  });

  test('regenerated figures pair by asset; text without the lookup omits the credit', () => {
    const before: ArticleBody = { type: 'article', title: '', blocks: [figureBlock('f1', { assetId: 'img-a', caption: 'Velha' })] };
    const after: ArticleBody = { type: 'article', title: '', blocks: [figureBlock('x9', { assetId: 'img-a', caption: 'Nova legenda' })] };
    const blocks = diffArticles(before, after);
    assert.deepEqual(
      blocks.map((block) => [block.id, block.change]),
      [['x9', 'modified']],
    );
    assert.equal(imageDiffText({ assetId: 'img-a' }), '[Imagem]');
  });
});

describe('package images', () => {
  const store = assetLookupOf([
    asset('img-cover'),
    asset('img-oficina', { mime: 'image/png', credit: undefined, rights: { authorized: false } }),
    asset('img-link', { origin: { type: 'url', url: 'https://cdn.exemplo.com/colecao.webp' }, mime: undefined, width: undefined, height: undefined, bytes: undefined }),
  ]);

  test('one file per distinct image, named after the title (the cover "-destaque"); links and missing images stay listed, disabled', () => {
    const files = exportImageFiles(illustrated(), 'ver-1', store);
    assert.deepEqual(
      files.map((file) => [file.fileName, file.format, file.available]),
      [
        ['estudio-norte-amplia-a-producao-destaque.jpg', 'jpg', true],
        ['estudio-norte-amplia-a-producao-1.png', 'png', true],
        ['estudio-norte-amplia-a-producao-2.webp', 'webp', false],
      ],
    );
    assert.equal(files[2].unavailableReason, EXTERNAL_IMAGE_REASON);
    assert.deepEqual(
      files[0].image?.uses.map((use) => [use.role, use.blockId]),
      [
        ['cover', COVER_BLOCK_ID],
        ['figure', 'f3'],
      ],
    );
    const missing = exportImageFiles(illustrated(), 'ver-1');
    assert.ok(missing.every((file) => !file.available && file.unavailableReason === MISSING_IMAGE_REASON));
    const sources = exportImageSources(files);
    assert.equal(sources.get('img-cover')?.src, 'estudio-norte-amplia-a-producao-destaque.jpg', 'next to the .md/.html (downloads have no folders)');
    assert.equal(sources.get('img-cover')?.credit, 'Ana Prado/Ateliê Sul');
    assert.equal(sources.get('img-link')?.src, 'https://cdn.exemplo.com/colecao.webp', 'linked images point at their address');
  });

  test('the planned package and the manifest carry every image with origin, credit, rights and digest; images never block', () => {
    const kit = createKit();
    const pack = approvedPackage(kit);
    const v2 = commitVersion(pack.record, kit, 'article', { ...(pack.article.body as ArticleBody), ...illustrated(), title: (pack.article.body as ArticleBody).title });
    recordDecision(pack.record, kit, v2, 'approved');
    const carousel = pack.record.pieces.find((piece) => piece.kind === 'carousel');
    // Only the article is checked here: plan without the carousel.
    const record = { ...pack.record, production: { ...pack.record.production, plan: ['article' as const] }, pieces: pack.record.pieces.filter((piece) => piece !== carousel) };
    const checked = canExport(record, defaultExportSelection(record));
    assert.ok(checked.ok, 'images never block the package');
    const files = plannedExportFiles(record, checked.value, undefined, store);
    const images = files.filter((file) => file.kind === 'image');
    assert.equal(images.length, 3);
    const manifest = buildManifest(record, checked.value, files, kit.ctx().now, { 'img-cover': { sha256: 'a'.repeat(64), bytes: 2048 } });
    assert.equal(manifest.assets.length, 3);
    const cover = manifest.assets.find((entry) => entry.id === 'img-cover');
    assert.equal(cover?.included, true);
    assert.equal(cover?.sha256, 'a'.repeat(64));
    assert.equal(cover?.credit, 'Ana Prado/Ateliê Sul');
    assert.deepEqual(cover?.rights, { authorized: true });
    assert.deepEqual(cover?.origin, { type: 'upload', fileName: 'img-cover.jpg' });
    assert.deepEqual(cover?.usedIn.map((use) => use.role), ['cover', 'figure']);
    const link = manifest.assets.find((entry) => entry.id === 'img-link');
    assert.equal(link?.included, false);
    assert.equal(link?.url, 'https://cdn.exemplo.com/colecao.webp');
    assert.equal(link?.note, EXTERNAL_IMAGE_REASON);
    const oficina = manifest.assets.find((entry) => entry.id === 'img-oficina');
    assert.deepEqual(oficina?.rights, { authorized: false });
    assert.equal(oficina?.credit, undefined);
    const article = manifest.items.find((item) => item.kind === 'article');
    assert.deepEqual(
      article?.files.filter((fileName) => images.some((file) => file.fileName === fileName)),
      images.filter((file) => file.available).map((file) => file.fileName),
      'downloadable image files belong to the article item',
    );
  });

  test('the approval keeps credit and rights: the package and the manifest say what changed since', () => {
    const kit = createKit();
    const pack = approvedPackage(kit);
    const v2 = commitVersion(pack.record, kit, 'article', { ...(pack.article.body as ArticleBody), ...illustrated(), title: (pack.article.body as ArticleBody).title });
    const approvedStore = assetLookupOf([asset('img-cover', { credit: 'Ana Prado' }), asset('img-oficina', { rights: { authorized: false } }), asset('img-link')]);
    recordDecision(pack.record, kit, v2, 'approved', { images: articleImageRights(v2.body as ArticleBody, approvedStore) });
    assert.deepEqual(decidedImageRights(pack.record, v2)?.map((record) => record.assetId), ['img-cover', 'img-oficina', 'img-link']);
    // After the approval: the cover's credit was corrected, the figure got its authorisation.
    const files = exportImageFiles(v2.body as ArticleBody, v2.id, store, decidedImageRights(pack.record, v2));
    const cover = files.find((file) => file.image?.assetId === 'img-cover');
    assert.deepEqual(cover?.image?.approved, { assetId: 'img-cover', credit: 'Ana Prado', rights: { authorized: true } });
    assert.equal(files.find((file) => file.image?.assetId === 'img-link')?.image?.approved, undefined, 'unchanged since the approval');
    const record = { ...pack.record, production: { ...pack.record.production, plan: ['article' as const] }, pieces: pack.record.pieces.filter((piece) => piece.kind === 'article') };
    const checked = canExport(record, defaultExportSelection(record));
    assert.ok(checked.ok);
    const manifest = buildManifest(record, checked.value, plannedExportFiles(record, checked.value, undefined, store), kit.ctx().now);
    const entry = manifest.assets.find((asset) => asset.id === 'img-cover');
    assert.equal(entry?.credit, 'Ana Prado/Ateliê Sul', 'the current credit leaves');
    assert.deepEqual(entry?.approvedAs, { credit: 'Ana Prado', rights: { authorized: true } }, 'and the approved one is on record');
    // The approved lookup reads the snapshot; ids it does not hold read the store.
    const approved = withApprovedRights(store, decidedImageRights(pack.record, v2));
    assert.equal(approved('img-cover')?.credit, 'Ana Prado');
    assert.equal(approved('img-oficina')?.credit, 'Ana Prado/Ateliê Sul', 'the credit removed after the approval');
    assert.equal(approved('img-oficina')?.rights.authorized, false);
    assert.ok(files.find((file) => file.image?.assetId === 'img-oficina')?.image?.approved);
    assert.equal(withApprovedRights(store, undefined), store);
  });

  test('a decision keeps the snapshot it is given', () => {
    const kit = createKit();
    const pack = approvedPackage(kit);
    const v2 = commitVersion(pack.record, kit, 'article', { ...(pack.article.body as ArticleBody), ...illustrated() });
    const images = articleImageRights(v2.body as ArticleBody, store);
    const decided = decide(
      { ...pack.record, member: { personId: PEDRO, workspaceId: 'ws', roles: ['approver'] } },
      { gate: ARTICLE_GATE, subject: { pieceId: v2.pieceId, versionId: v2.id, number: v2.number, hash: v2.hash, kind: 'version' }, decision: 'approved', images },
      kit.ctx(PEDRO),
    );
    assert.ok(decided.ok, decided.ok ? '' : decided.refusal.message);
    assert.deepEqual(decided.value.images, images);
    assert.deepEqual(images.find((record) => record.assetId === 'img-oficina'), { assetId: 'img-oficina', rights: { authorized: false } });
  });
});

describe('images in use, alt text and the carousel cover', () => {
  test('every image a draft or a version uses (what "Liberar espaço" keeps)', () => {
    const kit = createKit();
    const pack = approvedPackage(kit);
    commitVersion(pack.record, kit, 'article', { ...(pack.article.body as ArticleBody), ...illustrated() });
    const used = usedAssetIds([pack.record]);
    assert.deepEqual([...used].sort(), ['img-cover', 'img-link', 'img-oficina']);
  });

  test('alt text is what the person typed, the same everywhere; "Texto alternativo" warns per use', () => {
    assert.equal(imageAlt({ alt: '  Fachada   do estúdio ' }), 'Fachada do estúdio');
    assert.equal(imageAlt({}), '');
    assert.equal(imageAlt(undefined), '');
    const check = (body: ArticleBody) =>
      runChecks(
        ARTICLE_CHECKS.filter((definition) => definition.id === 'article.image-alt'),
        { body, brief: { sections: [], length: 'medium' } as never, sources: [], generation: { running: false, interrupted: false } },
      )[0];
    assert.equal(check(plain)?.status, 'na');
    const missing = check(illustrated());
    assert.equal(missing?.status, 'warn');
    assert.equal(missing?.detail, '2 sem texto alternativo');
    assert.deepEqual(missing?.targets?.map((target) => target.blockId), ['f2', 'f3']);
    const described: ArticleBody = { ...plain, cover: { assetId: 'img-cover', alt: 'Fachada' } };
    assert.equal(check(described)?.status, 'pass');
  });

  test('credits that say where the image came from stand alone', () => {
    for (const credit of ['Reprodução/Instagram', 'Divulgação', 'Arquivo pessoal', 'Agência Brasil', 'Acervo Ateliê Sul']) assert.equal(creditLine(credit), credit);
    assert.equal(creditLine('Arquivista Bia'), 'Foto: Arquivista Bia', 'a word that only starts the same is a name');
  });

  test('"Imagem da capa": credit and authorisation of the article cover a layout draws', () => {
    const template = {
      id: 'tpl',
      name: 'T',
      width: 1080,
      height: 1350,
      minSlides: 1,
      maxSlides: 10,
      coverLayoutId: 'cover',
      layouts: [
        { id: 'cover', label: 'Capa', articleCover: true as const, slots: [] },
        { id: 'point', label: 'Ponto', slots: [] },
      ],
    };
    const context = (patch: Partial<CarouselCheckContext>): CarouselCheckContext => ({
      body: { type: 'carousel', templateId: 'tpl', slides: [{ id: 's1', layout: 'cover', slots: {}, sourceBlockIds: [] }] },
      template,
      inputs: [],
      generation: { running: false, interrupted: false },
      ...patch,
    });
    const check = (patch: Partial<CarouselCheckContext>) => runChecks(CAROUSEL_CHECKS.filter((definition) => definition.id === 'carousel.cover-image'), context(patch))[0];
    const lookup = assetLookupOf([asset('img-ok'), asset('img-sem', { credit: undefined, rights: { authorized: false } }), asset('img-link', { origin: { type: 'url', url: 'https://x.com/a.jpg' } })]);
    assert.equal(check({})?.status, 'na', 'no article cover');
    assert.deepEqual([check({ articleCover: { assetId: 'img-ok' }, assets: lookup })?.status, check({ articleCover: { assetId: 'img-ok' }, assets: lookup })?.detail], ['pass', 'Foto: Ana Prado/Ateliê Sul']);
    assert.deepEqual([check({ articleCover: { assetId: 'img-sem' }, assets: lookup })?.status, check({ articleCover: { assetId: 'img-sem' }, assets: lookup })?.detail], ['warn', 'Sem crédito · Uso não autorizado']);
    assert.equal(check({ articleCover: { assetId: 'img-link' }, assets: lookup })?.status, 'na', 'a linked cover is not drawn');
    const noImageLayout = context({ articleCover: { assetId: 'img-sem' }, assets: lookup, body: { type: 'carousel', templateId: 'tpl', slides: [{ id: 's1', layout: 'point', slots: {}, sourceBlockIds: [] }] } });
    assert.equal(runChecks(CAROUSEL_CHECKS.filter((definition) => definition.id === 'carousel.cover-image'), noImageLayout)[0]?.status, 'na', 'no layout draws it');
  });

  test('the carousel reads the cover of the article version it was made from', () => {
    const kit = createKit();
    const pack = approvedPackage(kit);
    const v2 = commitVersion(pack.record, kit, 'article', { ...(pack.article.body as ArticleBody), ...illustrated() });
    assert.deepEqual(carouselArticleCover(pack.record, [{ pieceId: v2.pieceId, versionId: v2.id, number: v2.number, hash: v2.hash, kind: 'version' }]), illustrated().cover);
    assert.equal(carouselArticleCover(pack.record, []), undefined);
  });
});
