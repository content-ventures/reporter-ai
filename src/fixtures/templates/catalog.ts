import type { AssetId, CarouselFormatId, CarouselTemplate, TemplateCategory, TemplateFamily, TemplateId, TemplateMeta, TemplateStatus } from '../../domain/index.ts';
import type { SampleContent, TemplateLibraryData, TemplateRender } from '../../ports/render-template.ts';
import { boldFeed } from './designs/bold.ts';
import { dataFeed } from './designs/data.ts';
import { editorialFeed, editorialSquare } from './designs/editorial.ts';
import { magazineFeed } from './designs/magazine.ts';
import { minimalSquare } from './designs/minimal.ts';
import { photoFeed } from './designs/photo.ts';
import { quoteSquare } from './designs/quote.ts';
import { stepsFeed } from './designs/steps.ts';
import { seafoodFeed, seafoodSample } from './designs/seafood.ts';
import type { SeafoodVariation } from './designs/seafood.ts';
import { SEAFOOD_SAMPLE_PHOTO } from '../images.ts';
import { FEED, SQUARE } from './kit.ts';
import { SAMPLE_CONTENT } from './sample.ts';
import { structure } from './structure.ts';
import type { StructureOptions } from './structure.ts';

/**
 * Carousel template LIBRARY (F1.5, D07/D09). A template is DATA in four parts: the structure
 * (layouts, slots, limits — shared by every model, so switching keeps the texts), the render
 * data (boxes, type, colours), the library metadata (category, format, tags, status, one-liner)
 * and the sample copy of its previews. Marketing's approved models arrive as entries appended
 * here with `status: 'aprovado'`, and nothing else changes: the library lists them, the studio
 * switches between them and the RenderService draws, measures and exports them (`catalog.test.ts`
 * checks every entry). Legacy feed models stay available only to old fixture contracts; they are
 * deliberately absent from the product catalogue and its model pickers.
 */

export type TemplateEntry = { template: CarouselTemplate; render: TemplateRender; meta: TemplateMeta; sample: SampleContent; previewPhoto?: AssetId };

/** Ids kept from the first two models, so carousels saved with them still open. */
export const EDITORIAL_TEMPLATE_ID: TemplateId = 'tpl-provisorio-claro';
export const NOTURNO_TEMPLATE_ID: TemplateId = 'tpl-provisorio-escuro';
export const DEFAULT_TEMPLATE_ID: TemplateId = 'tpl-seafood-headline';

type EntrySpec = {
  id: TemplateId;
  name: string;
  format: CarouselFormatId;
  category: TemplateCategory;
  family?: TemplateFamily;
  previewPhoto?: AssetId;
  description: string;
  tags: string[];
  structure?: StructureOptions;
  render: (id: TemplateId) => TemplateRender;
  sample?: SampleContent;
  /** `aprovado`: Marketing approved it (badge "Aprovado"); default `base`. */
  status?: TemplateStatus;
};

function entry(spec: EntrySpec): TemplateEntry {
  const canvas = spec.format === 'square' ? SQUARE : FEED;
  return {
    template: structure(spec.id, spec.name, canvas, spec.structure),
    render: spec.render(spec.id),
    meta: { category: spec.category, format: spec.format, description: spec.description, tags: [...spec.tags], status: spec.status ?? 'base', ...(spec.family ? { family: spec.family } : {}) },
    sample: spec.sample ?? SAMPLE_CONTENT,
    ...(spec.previewPhoto ? { previewPhoto: spec.previewPhoto } : {}),
  };
}

const SEAFOOD_SPECS: readonly { variation: SeafoodVariation; name: string; family: TemplateFamily; category: TemplateCategory; description: string; photo: NonNullable<StructureOptions['photo']>; featured?: StructureOptions['featured'] }[] = [
  { variation: 'headline', name: 'Seafood Manchete', family: 'news', category: 'photo', description: 'Notícia com fotografia imersiva e manchete de alto impacto.', photo: ['cover', 'context'] },
  { variation: 'reportage', name: 'Seafood Reportagem', family: 'news', category: 'editorial', description: 'Reportagem com foto ampla e painel de leitura claro.', photo: ['cover', 'point'] },
  { variation: 'flow', name: 'Seafood Fluxo', family: 'explainer', category: 'list', description: 'Explicação clara com etapas numeradas e fotografia.', photo: ['cover', 'context'], featured: ['list'] },
  { variation: 'panorama', name: 'Seafood Panorama', family: 'explainer', category: 'data', description: 'Contexto e dados em contraste azul, com páginas alternadas.', photo: ['cover'], featured: ['data'] },
  { variation: 'interview', name: 'Seafood Entrevista', family: 'podcast', category: 'quote', description: 'Podcast com capa imersiva e citações em destaque amarelo.', photo: ['cover'] },
  { variation: 'quotes', name: 'Seafood Aspas', family: 'podcast', category: 'quote', description: 'Conversa em páginas claras, aspas fortes e faixa de foto.', photo: ['cover'] },
];

export const LEGACY_TEMPLATE_CATALOG: readonly TemplateEntry[] = [
  entry({
    id: EDITORIAL_TEMPLATE_ID,
    name: 'Editorial',
    format: 'feed',
    category: 'editorial',
    description: 'Fundo claro, faixa terracota e títulos fortes.',
    tags: ['claro', 'terracota', 'foto na capa'],
    status: 'aprovado',
    structure: { photo: ['cover'], coverTitleLines: 4 },
    render: (id) =>
      editorialFeed(id, {
        background: '#F7F5F2',
        ink: '#1C1C1A',
        muted: '#4A4A46',
        accent: '#B5472B',
        onAccent: '#FFFFFF',
        faint: '#E6DED6',
        scrim: '#1C1C1A',
        onImage: '#FFFFFF',
      }),
  }),
  entry({
    id: 'tpl-fotografia',
    name: 'Fotografia',
    format: 'feed',
    category: 'photo',
    description: 'Imagem de destaque em tela cheia, texto branco por cima.',
    tags: ['foto', 'escuro', 'âmbar', 'tela cheia'],
    status: 'aprovado',
    structure: { photo: ['cover', 'quote', 'closing'], coverTitleLines: 4 },
    render: (id) => photoFeed(id, { dark: '#15171A', light: '#FFFFFF', soft: '#CDD3DA', accent: '#F2B13C', scrim: '#0A0B0D' }),
  }),
  entry({
    id: 'tpl-revista',
    name: 'Revista',
    format: 'feed',
    category: 'magazine',
    description: 'Serifa sobre papel, filetes e fólio, como página impressa.',
    tags: ['serifa', 'papel', 'vermelho', 'clássico'],
    status: 'aprovado',
    structure: { coverTitleLines: 4 },
    render: (id) => magazineFeed(id, { paper: '#F3EEE4', ink: '#1D1915', muted: '#574F46', accent: '#A0181C' }),
  }),
  entry({
    id: 'tpl-manchete',
    name: 'Manchete',
    format: 'feed',
    category: 'bold',
    description: 'Amarelo e preto, títulos enormes, alto contraste.',
    tags: ['contraste', 'amarelo', 'preto', 'impacto'],
    structure: { coverTitleLines: 4 },
    render: (id) => boldFeed(id, { dark: '#0E0E0E', light: '#FFFFFF', soft: '#C9C9C9', signal: '#FFD400' }),
  }),
  entry({
    id: 'tpl-numeros',
    name: 'Números',
    format: 'feed',
    category: 'data',
    description: 'O número vira manchete, com barras em azul cobalto.',
    tags: ['dados', 'números', 'azul', 'gráfico'],
    structure: { coverTitleLines: 4, featured: ['data'] },
    render: (id) =>
      dataFeed(id, {
        page: '#F4F6FB',
        ink: '#0B1A33',
        muted: '#46536B',
        accent: '#1F4BDB',
        onAccent: '#FFFFFF',
        tint: '#DCE4FF',
        bar: '#3E66E6',
        deep: '#0B1A33',
        onDeep: '#FFFFFF',
      }),
  }),
  entry({
    id: 'tpl-passo-a-passo',
    name: 'Passo a passo',
    format: 'feed',
    category: 'list',
    description: 'Etapas numeradas e listas com marcadores grandes.',
    tags: ['lista', 'etapas', 'laranja', 'didático'],
    structure: { coverTitleLines: 4, featured: ['list'] },
    render: (id) =>
      stepsFeed(id, {
        page: '#FAF6EF',
        ink: '#1B2631',
        muted: '#4A5561',
        accent: '#B84A17',
        deep: '#1B2631',
        onDeep: '#FFFFFF',
        soft: '#C5CED8',
        glow: '#F39A5B',
        track: '#34414E',
      }),
  }),
  entry({
    id: NOTURNO_TEMPLATE_ID,
    name: 'Noturno',
    format: 'feed',
    category: 'editorial',
    description: 'Fundo escuro com destaque ciano.',
    tags: ['escuro', 'ciano', 'foto na capa'],
    structure: { photo: ['cover'], coverTitleLines: 4 },
    render: (id) =>
      editorialFeed(id, {
        background: '#14141F',
        ink: '#F4F4F8',
        muted: '#C4C4D0',
        accent: '#5CC8E0',
        onAccent: '#14141F',
        faint: '#262636',
        scrim: '#14141F',
        onImage: '#F4F4F8',
      }),
  }),
];

const SQUARE_TEMPLATE_CATALOG: readonly TemplateEntry[] = [
  entry({
    id: 'tpl-aspas',
    name: 'Aspas',
    format: 'square',
    category: 'quote',
    description: 'Aspas grandes e itálico serifado para falas marcantes.',
    tags: ['citação', 'serifa', 'verde', 'dourado'],
    status: 'aprovado',
    structure: { coverTitleLines: 4 },
    render: (id) =>
      quoteSquare(id, {
        deep: '#123129',
        light: '#F4EEE2',
        ink: '#123129',
        muted: '#4B5A53',
        accent: '#E1B65A',
        onDeep: '#F4EEE2',
        soft: '#C7D1CA',
        faint: '#DCD3C2',
      }),
  }),
  entry({
    id: 'tpl-pauta',
    name: 'Pauta',
    format: 'square',
    category: 'editorial',
    description: 'Editorial quadrado com faixa de foto e destaque petróleo.',
    tags: ['quadrado', 'areia', 'petróleo', 'foto na capa'],
    structure: { photo: ['cover'], coverTitleLines: 4 },
    render: (id) =>
      editorialSquare(id, {
        background: '#EFE8DC',
        ink: '#1F1D1A',
        muted: '#54504A',
        accent: '#0F625E',
        onAccent: '#FFFFFF',
        faint: '#DED5C6',
        scrim: '#10201F',
        onImage: '#FFFFFF',
      }),
  }),
  entry({
    id: 'tpl-minimal',
    name: 'Minimal',
    format: 'square',
    category: 'minimal',
    description: 'Branco, uma cor de texto e muito respiro.',
    tags: ['branco', 'leve', 'sem cor', 'quadrado'],
    structure: { coverTitleLines: 4 },
    render: (id) => minimalSquare(id, { page: '#FAFAF8', ink: '#121212', muted: '#646464', hairline: '#DCDCD8' }),
  }),
];

const SEAFOOD_TEMPLATE_CATALOG = SEAFOOD_SPECS.map(spec => entry({
  id: `tpl-seafood-${spec.variation}`, name: spec.name, family: spec.family,
  format: 'feed', category: spec.category, description: spec.description,
  tags: ['seafood', 'pescado', 'azul', spec.family === 'news' ? 'notícia' : spec.family === 'explainer' ? 'explica' : 'podcast'],
  structure: { photo: spec.photo, coverTitleLines: 4, ...(spec.featured ? { featured: spec.featured } : {}) },
  render: id => seafoodFeed(id, spec.variation), sample: seafoodSample(spec.variation), previewPhoto: SEAFOOD_SAMPLE_PHOTO.assetId,
}));

export const TEMPLATE_CATALOG: readonly TemplateEntry[] = [...SEAFOOD_TEMPLATE_CATALOG,...SQUARE_TEMPLATE_CATALOG];

/** Structures, in library order (the first is the default). */
export const CAROUSEL_TEMPLATES: readonly CarouselTemplate[] = TEMPLATE_CATALOG.map((item) => item.template);

export const CAROUSEL_TEMPLATE_RENDERS: Readonly<Record<TemplateId, TemplateRender>> = Object.fromEntries(
  TEMPLATE_CATALOG.map((item) => [item.template.id, item.render]),
);

export const CAROUSEL_TEMPLATE_DESCRIPTIONS: Readonly<Record<TemplateId, string>> = Object.fromEntries(
  TEMPLATE_CATALOG.map((item) => [item.template.id, item.meta.description]),
);

/** Library metadata and sample copy per template id (`LocalRenderDeps.library`). */
export const CAROUSEL_TEMPLATE_LIBRARY: Readonly<Record<TemplateId, TemplateLibraryData>> = Object.fromEntries(
  TEMPLATE_CATALOG.map((item) => [item.template.id, { meta: item.meta, sample: item.sample, ...(item.previewPhoto ? { previewPhoto: item.previewPhoto } : {}) }]),
);

export function templateEntry(id: TemplateId): TemplateEntry | undefined {
  return TEMPLATE_CATALOG.find((item) => item.template.id === id);
}
