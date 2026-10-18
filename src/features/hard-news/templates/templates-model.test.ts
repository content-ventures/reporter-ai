import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatById } from '../../../domain/index.ts';
import type { CarouselFormat, StageView } from '../../../domain/index.ts';
import { TEMPLATE_CATALOG } from '../../../fixtures/templates/catalog.ts';
import { parseLibraryParams } from '../../library/library-model.ts';
import {
  carouselTargets,
  familyShelves,
  formatOptions,
  galleryItems,
  kindTabs,
  layoutLimits,
  libraryHref,
  modelFacts,
  modelHref,
  otherModels,
  pickPages,
  slotLimit,
  spreadLayouts,
  type ModelTemplate,
} from './templates-model.ts';

const MODELS: ModelTemplate[] = TEMPLATE_CATALOG.map((entry) => ({
  ...entry.template,
  ...entry.meta,
  formatInfo: formatById(entry.meta.format) as CarouselFormat,
}));

function model(id: string): ModelTemplate {
  const found = MODELS.find((entry) => entry.id === id);
  assert.ok(found, id);
  return found;
}

describe('spreadLayouts', () => {
  it('shows the cover, the signature page and the quote of every catalog model', () => {
    const spreads = Object.fromEntries(MODELS.map((entry) => [entry.id, spreadLayouts(entry).join(' ')]));
    assert.deepEqual(spreads, {
      'tpl-seafood-headline': 'cover context quote',
      'tpl-seafood-reportage': 'cover point quote',
      'tpl-seafood-flow': 'cover list quote',
      'tpl-seafood-panorama': 'cover data quote',
      'tpl-seafood-interview': 'cover point quote',
      'tpl-seafood-quotes': 'cover point quote',
      'tpl-aspas': 'cover point quote',
      'tpl-pauta': 'cover point quote',
      'tpl-minimal': 'cover point quote',
    });
  });

  it('keeps only the cover on a phone and fills with the next pages when few exist', () => {
    assert.deepEqual(spreadLayouts(model('tpl-seafood-flow'), 1), ['cover']);
    const short = { coverLayoutId: 'cover', layouts: [{ id: 'cover', label: 'Capa', slots: [] }, { id: 'closing', label: 'Conclusão', slots: [] }] };
    assert.deepEqual(spreadLayouts(short), ['cover', 'closing']);
  });

  it('picks the rendered pages in the spread order, skipping a page not drawn', () => {
    const slides = ['cover', 'context', 'point', 'data', 'list', 'quote', 'closing'].map((layout, index) => ({ layout, index }));
    assert.deepEqual(pickPages(slides, ['cover', 'list', 'quote']).map((slide) => slide.index), [0, 4, 5]);
    assert.deepEqual(pickPages(slides.slice(0, 2), ['cover', 'list', 'quote']).map((slide) => slide.layout), ['cover']);
  });
});

describe('familyShelves', () => {
  it('puts the Feed models on the three family shelves, each with its use line', () => {
    const shelves = familyShelves(MODELS, { format: 'feed', query: '' });
    assert.deepEqual(shelves.map((shelf) => [shelf.title, shelf.meta, shelf.templates.length]), [
      ['Notícia', 'Manchetes e reportagens do setor', 2],
      ['Explica', 'Processos, etapas e dados contextualizados', 2],
      ['Podcast', 'Conversas e citações verificadas', 2],
    ]);
    assert.equal(shelves[0].label, 'Modelos de Notícia');
  });

  it('shows the Quadrado models as one shelf without a heading', () => {
    const [shelf, ...rest] = familyShelves(MODELS, { format: 'square', query: '' });
    assert.equal(rest.length, 0);
    assert.equal(shelf.title, undefined);
    assert.equal(shelf.label, 'Modelos');
    assert.deepEqual(shelf.templates.map((entry) => entry.id), ['tpl-aspas', 'tpl-pauta', 'tpl-minimal']);
  });

  it('hides a shelf with no match and names models without a family "Outros" beside others', () => {
    assert.deepEqual(familyShelves(MODELS, { format: 'feed', query: 'fluxo' }).map((shelf) => shelf.title), ['Explica']);
    const loose = { ...model('tpl-aspas'), id: 'tpl-solto', format: 'feed' as const, formatInfo: formatById('feed') as CarouselFormat };
    const shelves = familyShelves([...MODELS, loose], { format: 'feed', query: '' });
    assert.deepEqual(shelves.map((shelf) => shelf.title), ['Notícia', 'Explica', 'Podcast', 'Outros']);
    assert.equal(familyShelves(MODELS, { format: 'feed', query: 'zzz' }).length, 0);
  });
});

describe('tabs and format', () => {
  it('counts the carousels across formats and keeps static posts for later', () => {
    assert.deepEqual(kindTabs(MODELS, ''), [
      { value: 'carousel', label: 'Carrosséis', count: 9, disabled: false },
      { value: 'static', label: 'Estáticos', count: 'Em breve', disabled: true },
    ]);
    assert.equal(kindTabs(MODELS, 'aspas')[0].count, 2);
  });

  it('lists Stories as a format that cannot be chosen yet', () => {
    assert.deepEqual(formatOptions(), [
      { value: 'feed', label: 'Feed 4:5' },
      { value: 'square', label: 'Quadrado 1:1' },
      { value: 'stories', label: 'Stories 9:16', disabled: true, disabledReason: 'Em breve' },
    ]);
  });
});

describe('addresses', () => {
  it('opens a model with the format and search it came from, and goes back to them', () => {
    const href = modelHref({ format: 'square', query: 'aspas' }, 'tpl-aspas');
    assert.equal(href, '/library/templates?format=square&q=aspas&model=tpl-aspas');
    assert.deepEqual(parseLibraryParams(new URL(href, 'http://local').searchParams), { format: 'square', query: 'aspas', model: 'tpl-aspas' });
    assert.equal(libraryHref({ format: 'square', query: 'aspas' }), '/library/templates?format=square&q=aspas');
    assert.equal(libraryHref({ format: null, query: '' }), '/library/templates');
    assert.deepEqual(parseLibraryParams(new URL(modelHref({ format: null, query: '' }, 'tpl-seafood-flow'), 'http://local').searchParams), { format: null, query: '', model: 'tpl-seafood-flow' });
  });
});

describe('carouselTargets', () => {
  const stage = (patch: Partial<StageView> = {}): StageView => ({ id: 'carousel', label: 'Carrossel', kind: 'piece', pieceKind: 'carousel', state: 'upcoming', status: 'not_started', selectable: true, ...patch });
  const article: StageView = { id: 'approval', label: 'Aprovação', kind: 'gate', pieceKind: 'article', state: 'done', status: 'approved', selectable: true };
  const item = (id: string, carousel: StageView | null, archived = false) => ({ id, archived, stages: carousel ? [article, carousel] : [article] });

  it('keeps productions whose carousel opens and has not started', () => {
    const items = [
      item('ready', stage()),
      item('archived', stage(), true),
      item('locked', stage({ selectable: false, status: 'locked' })),
      item('blocked', stage({ state: 'blocked' })),
      item('started', stage({ status: 'draft', state: 'current' })),
      item('no-carousel', null),
    ];
    assert.deepEqual(carouselTargets(items).map((entry) => entry.id), ['ready']);
  });
});

describe('the model page', () => {
  it('names each rendered page by its layout, in order, without a source for a page not drawn', () => {
    const flow = model('tpl-seafood-flow');
    const items = galleryItems(
      [
        { layout: 'cover', width: 810, height: 1013, image: { mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA', bytes: 1 } },
        { layout: 'list', width: 810, height: 1013 },
      ],
      flow,
    );
    assert.deepEqual(items, [
      { id: 'cover', src: 'data:image/png;base64,AA', alt: 'Capa no modelo Seafood Fluxo', ratio: '4/5', label: 'Capa', meta: 'Prévia · 810 × 1013 px · PNG' },
      { id: 'list', alt: 'Lista no modelo Seafood Fluxo', ratio: '4/5', label: 'Lista', meta: 'Prévia · 810 × 1013 px · PNG' },
    ]);
    assert.equal('src' in items[1], false);
  });

  it('writes each text limit in characters and lines, and the photo of a page over the image', () => {
    assert.equal(slotLimit({ maxChars: 70, maxLines: 3 }), '70 caracteres · 3 linhas');
    assert.equal(slotLimit({ maxChars: 7, maxLines: 1 }), '7 caracteres · 1 linha');
    assert.equal(slotLimit({ maxChars: 1 }), '1 caractere');
    const cover = model('tpl-seafood-headline').layouts.find((layout) => layout.id === 'cover');
    assert.ok(cover);
    assert.deepEqual(layoutLimits(cover), [
      { label: 'Chamada', value: '32 caracteres · 1 linha' },
      { label: 'Título', value: '70 caracteres · 4 linhas' },
      { label: 'Foto', value: 'Imagem de destaque' },
    ]);
    const data = model('tpl-aspas').layouts.find((layout) => layout.id === 'data');
    assert.ok(data);
    assert.equal(layoutLimits(data).some((row) => row.label === 'Foto'), false);
  });

  it('describes the model in its ficha', () => {
    assert.deepEqual(modelFacts(model('tpl-seafood-flow')), [
      { label: 'Família', value: 'Explica' },
      { label: 'Estilo', value: 'Passo a passo' },
      { label: 'Formato', value: 'Feed 4:5 · 1080 × 1350 px' },
      { label: 'Slides', value: '3 a 10' },
      { label: 'Imagem de destaque', value: 'Capa e Contexto' },
      { label: 'Estrutura', value: 'Capa · Contexto · Ponto principal · Citação · Conclusão', hint: 'Com uma lista no artigo, gera um slide de Lista.' },
    ]);
    const facts = modelFacts(model('tpl-minimal'));
    assert.equal(facts.some((row) => row.label === 'Família'), false);
    assert.equal(facts.find((row) => row.label === 'Imagem de destaque')?.value, 'Não usa');
  });

  it('offers the other models of the same format, the same family first', () => {
    assert.deepEqual(otherModels(MODELS, model('tpl-seafood-panorama')).map((entry) => entry.id), [
      'tpl-seafood-flow',
      'tpl-seafood-headline',
      'tpl-seafood-reportage',
      'tpl-seafood-interview',
      'tpl-seafood-quotes',
    ]);
    assert.deepEqual(otherModels(MODELS, model('tpl-pauta')).map((entry) => entry.id), ['tpl-aspas', 'tpl-minimal']);
  });
});
