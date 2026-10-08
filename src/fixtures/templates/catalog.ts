import type { CarouselFormatId, CarouselTemplate, TemplateCategory, TemplateId, TemplateMeta, TemplateStatus } from '../../domain/index.ts';
import type { SampleContent, TemplateLibraryData, TemplateRender } from '../../ports/render-template.ts';
import { boldFeed } from './designs/bold.ts';
import { dataFeed } from './designs/data.ts';
import { editorialFeed, editorialSquare } from './designs/editorial.ts';
import { magazineFeed } from './designs/magazine.ts';
import { minimalSquare } from './designs/minimal.ts';
import { photoFeed } from './designs/photo.ts';
import { quoteSquare } from './designs/quote.ts';
import { stepsFeed } from './designs/steps.ts';
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
 * checks every entry). The models below ship with the product, never "Provisório"; in the example
 * workspace Marketing already approved four of them (Editorial, Fotografia, Revista and Aspas), the
 * ones that carry the "Aprovado" badge.
 */

export type TemplateEntry = { template: CarouselTemplate; render: TemplateRender; meta: TemplateMeta; sample: SampleContent };

/** Ids kept from the first two models, so carousels saved with them still open. */
export const EDITORIAL_TEMPLATE_ID: TemplateId = 'tpl-provisorio-claro';
export const NOTURNO_TEMPLATE_ID: TemplateId = 'tpl-provisorio-escuro';
export const DEFAULT_TEMPLATE_ID: TemplateId = EDITORIAL_TEMPLATE_ID;

type EntrySpec = {
  id: TemplateId;
  name: string;
  format: CarouselFormatId;
  category: TemplateCategory;
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
    meta: { category: spec.category, format: spec.format, description: spec.description, tags: [...spec.tags], status: spec.status ?? 'base' },
    sample: spec.sample ?? SAMPLE_CONTENT,
  };
}

export const TEMPLATE_CATALOG: readonly TemplateEntry[] = [
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
  TEMPLATE_CATALOG.map((item) => [item.template.id, { meta: item.meta, sample: item.sample }]),
);

export function templateEntry(id: TemplateId): TemplateEntry | undefined {
  return TEMPLATE_CATALOG.find((item) => item.template.id === id);
}
