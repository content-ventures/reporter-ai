import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assetLookupOf, COVER_BLOCK_ID, dividerBlock, figureBlock, NO_ASSETS, paragraphBlock } from '../../../domain/index.ts';
import type { ArticleBody, ImageAsset } from '../../../domain/index.ts';
import {
  creditHint,
  creditPreview,
  fieldsOf,
  imageRefOf,
  imagesToCheck,
  issueLine,
  pickerCopy,
  refusedFileMessage,
  rightsChanged,
  withSuggested,
} from './image-model.ts';
import { isBlankBody } from './studio-model.ts';

const asset = (id: string, patch: Partial<ImageAsset> = {}): ImageAsset => ({
  id,
  workspaceId: 'ws-1',
  kind: 'image',
  origin: { type: 'upload', fileName: `${id}.jpg` },
  rights: { authorized: true },
  createdAt: '2026-10-07T12:00:00.000Z',
  createdBy: 'person-joao',
  ...patch,
});

const body: ArticleBody = {
  type: 'article',
  title: 'Título',
  cover: { assetId: 'img-capa', alt: 'Capa' },
  blocks: [
    paragraphBlock('b1', 'Abertura.'),
    figureBlock('f1', { assetId: 'img-ok', caption: 'Com crédito' }),
    figureBlock('f2', { assetId: 'img-sem', alt: 'Sem crédito nem legenda' }),
    figureBlock('f3', { assetId: 'img-fora' }),
    figureBlock('f4', { assetId: 'img-sem', caption: 'Mesma imagem de novo' }),
  ],
};

const assets = assetLookupOf([
  asset('img-capa', { credit: 'Ana Prado', rights: { authorized: false } }),
  asset('img-ok', { credit: 'Bia Moraes' }),
  asset('img-sem'),
]);

describe('image model', () => {
  it('names the picker by role, mode and whether an image is being replaced', () => {
    assert.deepEqual(pickerCopy('figure', 'choose', false), { title: 'Inserir imagem', primary: 'Inserir imagem' });
    assert.deepEqual(pickerCopy('figure', 'choose', true), { title: 'Trocar imagem', primary: 'Trocar imagem' });
    assert.deepEqual(pickerCopy('cover', 'choose', false), { title: 'Imagem de destaque', primary: 'Definir como destaque' });
    assert.deepEqual(pickerCopy('cover', 'choose', true), { title: 'Trocar imagem de destaque', primary: 'Definir como destaque' });
    assert.deepEqual(pickerCopy('cover', 'edit', true), { title: 'Legenda e crédito', primary: 'Salvar alterações' });
  });

  it('previews the credit line as the caption will read it', () => {
    assert.equal(creditPreview(''), 'Na legenda: “Foto: …”');
    assert.equal(creditPreview('  Ana   Prado '), 'Na legenda: “Foto: Ana Prado”');
    assert.equal(creditPreview('Ilustração: Bia'), 'Na legenda: “Ilustração: Bia”');
  });

  it('says what an empty credit means, then how the typed one reads', () => {
    assert.equal(creditHint(''), 'Sem crédito, a checagem avisa.');
    assert.equal(creditHint('Ana Prado'), 'Na legenda: “Foto: Ana Prado”');
    assert.equal(creditHint('Reprodução/Instagram'), 'Na legenda: “Reprodução/Instagram”');
  });

  it('fills only the empty fields with what an image source knows (an archive record)', () => {
    const typed = { alt: 'Fachada', caption: '', credit: '', authorized: false };
    assert.deepEqual(withSuggested(typed, { alt: 'Outra', caption: 'Vitrine', credit: 'Acervo Ateliê Sul', authorized: true }), {
      alt: 'Fachada',
      caption: 'Vitrine',
      credit: 'Acervo Ateliê Sul',
      authorized: true,
    });
    assert.equal(withSuggested(typed, undefined), typed);
  });

  it('prefills the use (alt, caption) and, when editing, the image (credit, rights)', () => {
    assert.deepEqual(fieldsOf({ assetId: 'a', alt: 'Alt', caption: 'Legenda' }, undefined), { alt: 'Alt', caption: 'Legenda', credit: '', authorized: false });
    assert.deepEqual(fieldsOf(undefined, asset('a', { credit: 'Ana' })), { alt: '', caption: '', credit: 'Ana', authorized: true });
    assert.deepEqual(imageRefOf('a', { alt: '  ', caption: ' Legenda  nova ' }), { assetId: 'a', caption: 'Legenda nova' });
  });

  it('knows when credit or rights changed (they belong to the image, not to the use)', () => {
    const current = asset('a', { credit: 'Ana' });
    assert.equal(rightsChanged(current, { credit: ' Ana ', authorized: true }), false);
    assert.equal(rightsChanged(current, { credit: 'Bia', authorized: true }), true);
    assert.equal(rightsChanged(current, { credit: 'Ana', authorized: false }), true);
  });

  it('explains a refused file with the store rule', () => {
    assert.equal(refusedFileMessage({ name: 'nota.txt', type: 'text/plain', size: 10 }), 'Envie uma imagem JPG, PNG, WebP ou GIF.');
    assert.match(refusedFileMessage({ name: 'grande.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 }), /10 MB/);
    assert.equal(refusedFileMessage({ name: 'vazio.png', type: 'image/png', size: 0 }), 'O arquivo está vazio.');
  });

  it('lists every use of an image to check, in reading order, labelled for Checagem', () => {
    const list = imagesToCheck(body, assets);
    assert.deepEqual(
      list.map((entry) => [entry.blockId, entry.role, entry.label, entry.issues]),
      [
        [COVER_BLOCK_ID, 'cover', 'Imagem de destaque', ['not_authorized']],
        ['f2', 'figure', 'Sem crédito nem legenda', ['missing_credit']],
        ['f3', 'figure', 'Imagem 3', ['missing_asset']],
        ['f4', 'figure', 'Mesma imagem de novo', ['missing_credit']],
      ],
    );
    assert.equal(list[2]?.asset, undefined);
    assert.equal(list[1]?.asset?.id, 'img-sem');
    assert.equal(issueLine(['missing_credit', 'not_authorized']), 'Sem crédito · Uso não autorizado');
  });

  it('lists nothing for an article without images or with every image ready', () => {
    assert.deepEqual(imagesToCheck({ type: 'article', title: '', blocks: [paragraphBlock('b1', 'Texto')] }, NO_ASSETS), []);
    assert.deepEqual(imagesToCheck({ type: 'article', title: '', blocks: [figureBlock('f1', { assetId: 'img-ok' })] }, assets), []);
  });

  it('treats a figure as content and a cover alone as a blank text', () => {
    assert.equal(isBlankBody({ blocks: [] }), true);
    assert.equal(isBlankBody({ blocks: [paragraphBlock('b1', '  '), dividerBlock('d1')] }), true);
    assert.equal(isBlankBody({ blocks: [paragraphBlock('b1', ''), figureBlock('f1', { assetId: 'a' })] }), false);
    assert.equal(isBlankBody({ ...body, blocks: [paragraphBlock('b1', '')] }), true);
  });
});
